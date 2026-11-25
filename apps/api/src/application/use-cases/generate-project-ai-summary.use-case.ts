import type {
  ProjectRepositoryPort,
  BoardRepositoryPort,
  TaskRepositoryPort,
  MembershipRepositoryPort,
  TeacherProjectScopePort,
  AIProviderPort,
  AIQuotaPort,
  AIQuotaReleaseOutcome,
  AIAnalysisFocus,
  AIAnalysisResponse,
  ProjectAICapabilitiesResponse,
  Task,
  Board,
} from '@is488/shared';
import {
  AI_ASSISTANT_DISCLAIMER,
  AIModelPayloadSchema,
  AIAnalysisResponseSchema,
  ProjectAICapabilitiesResponseSchema,
  AIInvalidResponseError,
  AITimeoutError,
} from '@is488/shared';

export interface GenerateProjectAISummaryCommand {
  projectId: string;
  userId: string;
  focus?: AIAnalysisFocus;
}

export interface ProjectAICapabilitiesQuery {
  projectId: string;
  userId: string;
}

const SYSTEM_PROMPT = `Eres el Asistente de Gestión y Planificación para Proyectos de Ingeniería de Software (IS488) de la Universidad Nacional de San Cristóbal de Huamanga.
Tu rol es estrictamente formativo y orientativo para apoyar a estudiantes y docentes en la organización operativa y seguimiento del proyecto.

REGLAS ÉTICAS Y DE SEGURIDAD OBLIGATORIAS:
1. Está TERMINANTEMENTE PROHIBIDO emitir calificaciones, asignar notas numéricas o conceptuales, o dictaminar la aprobación o reprobación académica del proyecto. Cualquier juicio evaluativo oficial es competencia exclusiva del docente del curso.
2. Si el usuario o el contexto solicitan calificar, debes reorientar tu análisis exclusivamente hacia recomendaciones operativas y metodológicas.
3. Debes responder ÚNICAMENTE en formato JSON válido, sin bloques de código markdown ni texto adicional fuera del JSON.
4. El objeto JSON debe contener EXACTAMENTE los siguientes tres campos de primer nivel:
   - "progressSummary": (string no vacío) Resumen conciso del avance del proyecto basado en las columnas y tareas.
   - "riskSignals": (array de strings) Señales de riesgo identificadas (cuellos de botella, tareas bloqueadas, fechas próximas o vencidas).
   - "nextSteps": (array de strings) Próximos pasos recomendados para el equipo de desarrollo.`;

const MAX_TASKS_CONTEXT = 50;
const MAX_PROMPT_CHARS = 10000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class GenerateProjectAISummaryUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly boardRepository: BoardRepositoryPort,
    private readonly taskRepository: TaskRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly teacherProjectScope: TeacherProjectScopePort,
    private readonly aiProvider: AIProviderPort,
    private readonly aiQuota: AIQuotaPort,
    private readonly clock: () => number = () => Date.now(),
  ) {}

  private async hasProjectAccess(
    creatorId: string,
    projectId: string,
    userId: string,
  ): Promise<boolean> {
    if (creatorId === userId) {
      return true;
    }

    const membership = await this.membershipRepository.findByProjectAndUser(projectId, userId);
    if (membership !== null && membership.status === 'active') {
      return true;
    }

    return this.teacherProjectScope.isAssigned(userId, projectId);
  }

  /**
   * Evalúa si el usuario autenticado tiene permiso efectivo para usar el asistente IA
   * reutilizando exactamente la misma política de autorización de `execute()`.
   */
  async getCapabilities(query: ProjectAICapabilitiesQuery): Promise<ProjectAICapabilitiesResponse> {
    const project = await this.projectRepository.findById(query.projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${query.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    const canUseAIAssistant = await this.hasProjectAccess(
      project.creatorId,
      query.projectId,
      query.userId,
    );

    return ProjectAICapabilitiesResponseSchema.parse({
      projectId: query.projectId,
      canUseAIAssistant,
    });
  }

  async execute(command: GenerateProjectAISummaryCommand): Promise<AIAnalysisResponse> {
    const { projectId, userId, focus = 'full' } = command;

    // 1. Comprobar existencia del proyecto
    const project = await this.projectRepository.findById(projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    // 2. Comprobar autorización del usuario (creador, miembro activo o docente asignado)
    const authorized = await this.hasProjectAccess(project.creatorId, projectId, userId);
    if (!authorized) {
      throw Object.assign(new Error(`Acceso denegado al proyecto '${projectId}'`), {
        statusCode: 403,
      });
    }

    // 3. Comprobar y adquirir cuota / guard de concurrencia
    const quotaCheck = await this.aiQuota.checkAndAcquire(userId, projectId);
    if (!quotaCheck.allowed) {
      const message =
        quotaCheck.reason === 'IN_FLIGHT_CONFLICT'
          ? 'Ya existe un análisis en curso para este usuario y proyecto. Por favor espere a que finalice.'
          : 'Se ha alcanzado el límite de 5 análisis por cada 10 minutos para este proyecto.';

      throw Object.assign(new Error(message), {
        statusCode: 429,
        reason: quotaCheck.reason,
        retryAfterSeconds: quotaCheck.retryAfterSeconds,
      });
    }

    let outcome: AIQuotaReleaseOutcome = 'error';

    try {
      // 4. Obtener tablero y tareas del proyecto
      const board = await this.boardRepository.findOrCreateDefaultBoard(projectId);
      const allTasks = await this.taskRepository.findByProjectId(projectId);

      // 5. Seleccionar y priorizar tareas deterministamente
      const selectedTasks = this.selectRelevantTasks(allTasks, board);

      // 6. Construir prompt seguro y acotado (máx. 10.000 caracteres)
      const userPrompt = this.buildUserPrompt(
        project.title,
        board,
        allTasks.length,
        selectedTasks,
        focus,
      );

      // 7. Invocar proveedor desacoplado
      const completion = await this.aiProvider.generateCompletion({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        maxTokens: 600,
        temperature: 0.3,
        responseFormat: 'json_object',
      });

      // 8. Validar estructuralmente la respuesta JSON
      const parsedSections = this.parseAndValidateModelOutput(completion.content);

      // 9. Construir respuesta final inyectando el disclaimer desde el servidor
      const response: AIAnalysisResponse = {
        projectId,
        analysis: parsedSections,
        meta: {
          model: completion.model,
          generatedAt: new Date(this.clock()).toISOString(),
          disclaimer: AI_ASSISTANT_DISCLAIMER,
        },
      };

      const validatedResponse = AIAnalysisResponseSchema.parse(response);
      outcome = 'success';
      return validatedResponse;
    } catch (error) {
      if (
        error instanceof AITimeoutError ||
        (error instanceof Error &&
          (error.name === 'AbortError' || error.message.includes('tiempo')))
      ) {
        outcome = 'timeout';
      }
      throw error;
    } finally {
      await this.aiQuota.release(userId, projectId, outcome);
    }
  }

  private selectRelevantTasks(tasks: Task[], board: Board): Task[] {
    const currentTime = this.clock();
    const completedColumnIds = new Set(
      board.columns
        .filter((col) => /completad|terminad|finaliz|done/i.test(col.name))
        .map((col) => col.id),
    );

    // Filtrar tareas completadas hace más de 7 días
    const eligibleTasks = tasks.filter((task) => {
      const isCompleted = completedColumnIds.has(task.columnId);
      if (isCompleted) {
        const taskUpdatedTime = new Date(task.updatedAt).getTime();
        if (currentTime - taskUpdatedTime > SEVEN_DAYS_MS) {
          return false;
        }
      }
      return true;
    });

    const priorityScore: Record<string, number> = {
      URGENT: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    // Ordenar deterministamente
    eligibleTasks.sort((a, b) => {
      // 1. Tareas con mayor prioridad primero
      const pDiff = (priorityScore[b.priority] ?? 0) - (priorityScore[a.priority] ?? 0);
      if (pDiff !== 0) return pDiff;

      // 2. Tareas con fecha límite más próxima primero
      if (a.dueDate && b.dueDate) {
        const dDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        if (dDiff !== 0) return dDiff;
      } else if (a.dueDate && !b.dueDate) {
        return -1;
      } else if (!a.dueDate && b.dueDate) {
        return 1;
      }

      // 3. Tareas no completadas primero
      const aDone = completedColumnIds.has(a.columnId);
      const bDone = completedColumnIds.has(b.columnId);
      if (!aDone && bDone) return -1;
      if (aDone && !bDone) return 1;

      // 4. Desempate determinista estricto por ID
      return a.id.localeCompare(b.id);
    });

    return eligibleTasks.slice(0, MAX_TASKS_CONTEXT);
  }

  private buildUserPrompt(
    projectName: string,
    board: Board,
    totalTasksCount: number,
    selectedTasks: Task[],
    focus: AIAnalysisFocus,
  ): string {
    const columnMap = new Map<string, string>();
    const columnTaskCount = new Map<string, number>();
    for (const col of board.columns) {
      columnMap.set(col.id, col.name);
      columnTaskCount.set(col.id, 0);
    }

    for (const task of selectedTasks) {
      const current = columnTaskCount.get(task.columnId) ?? 0;
      columnTaskCount.set(task.columnId, current + 1);
    }

    const columnsSummary = board.columns
      .map((col) => `"${col.name}" (${columnTaskCount.get(col.id) ?? 0} tareas en muestra)`)
      .join(', ');

    let prompt = `Proyecto: ${projectName}\n`;
    prompt += `Columnas del Tablero: ${columnsSummary}\n`;
    prompt += `Total de tareas registradas: ${totalTasksCount}\n`;
    prompt += `Enfoque solicitado: ${focus}\n\n`;
    prompt += `Muestra de tareas prioritarias (${selectedTasks.length}):\n`;

    const taskLines: string[] = [];
    for (const task of selectedTasks) {
      const colName = columnMap.get(task.columnId) ?? 'Sin columna';
      const dueInfo = task.dueDate ? ` | Límite: ${task.dueDate.slice(0, 10)}` : '';
      const labelsInfo = task.labels.length > 0 ? ` | Etiquetas: [${task.labels.join(', ')}]` : '';
      const line = `- [${colName}] "${task.title}" (Prioridad: ${task.priority}${dueInfo}${labelsInfo})`;
      taskLines.push(line);
    }

    let fullTasksText = taskLines.join('\n');
    let candidate = `${prompt}${fullTasksText}`;

    // Si supera MAX_PROMPT_CHARS, truncar líneas de tareas deterministamente desde el final
    if (candidate.length > MAX_PROMPT_CHARS) {
      while (candidate.length > MAX_PROMPT_CHARS && taskLines.length > 0) {
        taskLines.pop();
        fullTasksText = taskLines.join('\n');
        candidate = `${prompt}${fullTasksText}\n(Contexto truncado por límite de tamaño)`;
      }
    }

    return candidate;
  }

  private parseAndValidateModelOutput(content: string) {
    let rawJson: unknown;
    try {
      let trimmed = content.trim();
      if (trimmed.startsWith('```')) {
        trimmed = trimmed
          .replace(/^```(?:json)?\s*/i, '')
          .replace(/\s*```$/i, '')
          .trim();
      }
      rawJson = JSON.parse(trimmed);
    } catch {
      throw new AIInvalidResponseError('La respuesta del modelo de IA no es un JSON válido.');
    }

    const parsed = AIModelPayloadSchema.safeParse(rawJson);
    if (!parsed.success) {
      throw new AIInvalidResponseError(
        `La respuesta del modelo de IA no cumple con la estructura requerida: ${parsed.error.message}`,
      );
    }

    return {
      progressSummary: parsed.data.progressSummary,
      riskSignals: parsed.data.riskSignals,
      nextSteps: parsed.data.nextSteps,
    };
  }
}
