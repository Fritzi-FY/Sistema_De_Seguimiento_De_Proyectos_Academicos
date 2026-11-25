import { describe, it, expect, beforeEach } from 'vitest';
import { GenerateProjectAISummaryUseCase } from './generate-project-ai-summary.use-case.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';
import { InMemoryTaskRepository } from '../../infrastructure/adapters/repositories/in-memory-task.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../infrastructure/adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import {
  FakeAIProvider,
  InMemoryAIQuotaAdapter,
  AI_ASSISTANT_DISCLAIMER,
  AIInvalidResponseError,
  AIProviderUnavailableError,
  AIRateLimitError,
  type Project,
  type AIQuotaReleaseOutcome,
} from '@is488/shared';

describe('GenerateProjectAISummaryUseCase', () => {
  let projectRepository: InMemoryProjectRepository;
  let boardRepository: InMemoryBoardRepository;
  let taskRepository: InMemoryTaskRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let teacherScope: InMemoryTeacherProjectScopeAdapter;
  let fakeAIProvider: FakeAIProvider;
  let fakeQuota: InMemoryAIQuotaAdapter;
  let useCase: GenerateProjectAISummaryUseCase;

  const fixedNow = 1773800000000; // Fixed timestamp for tests
  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = 'user-creator';
  const collaboratorId = 'user-collaborator';
  const inactiveMemberId = 'user-inactive';
  const assignedTeacherId = 'teacher-assigned';
  const unassignedTeacherId = 'teacher-unassigned';
  const outsiderId = 'user-outsider';

  const sampleProject: Project = {
    id: projectId,
    title: 'Sistema de Seguimiento IS488',
    description: 'Plataforma para proyectos académicos de ingeniería',
    courseCode: 'IS488',
    status: 'active',
    startDate: '2026-03-01T00:00:00.000Z',
    targetDate: '2026-07-15T00:00:00.000Z',
    creatorId,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    projectRepository = new InMemoryProjectRepository();
    const storage = new InMemoryKanbanProjectStorage();
    boardRepository = new InMemoryBoardRepository(storage);
    taskRepository = new InMemoryTaskRepository(storage);
    membershipRepository = new InMemoryMembershipRepository();

    teacherScope = new InMemoryTeacherProjectScopeAdapter(
      new Map([[assignedTeacherId, [projectId]]]),
    );

    fakeAIProvider = new FakeAIProvider({
      defaultResponse: JSON.stringify({
        progressSummary: 'El proyecto avanza según cronograma.',
        riskSignals: ['Una tarea crítica sin asignar.'],
        nextSteps: ['Asignar responsable de pruebas.'],
      }),
    });

    fakeQuota = new InMemoryAIQuotaAdapter({
      clock: () => fixedNow,
    });

    useCase = new GenerateProjectAISummaryUseCase(
      projectRepository,
      boardRepository,
      taskRepository,
      membershipRepository,
      teacherScope,
      fakeAIProvider,
      fakeQuota,
      () => fixedNow,
    );

    // Guardar proyecto
    await projectRepository.save(sampleProject);

    // Inicializar tablero por defecto con columnas
    await boardRepository.findOrCreateDefaultBoard(projectId);

    // Registrar miembro activo
    await membershipRepository.addMember({
      projectId,
      userId: collaboratorId,
      role: 'collaborator',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    // Registrar miembro inactivo / retirado
    await membershipRepository.addMember({
      projectId,
      userId: inactiveMemberId,
      role: 'collaborator',
      status: 'removed',
      removedAt: '2026-03-10T00:00:00.000Z',
      joinedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    });
  });

  describe('Autorización y Aislamiento', () => {
    it('permite generar análisis al creador del proyecto', async () => {
      const response = await useCase.execute({
        projectId,
        userId: creatorId,
      });

      expect(response.projectId).toBe(projectId);
      expect(response.analysis.progressSummary).toBe('El proyecto avanza según cronograma.');
      expect(response.meta.disclaimer).toBe(AI_ASSISTANT_DISCLAIMER);
    });

    it('permite generar análisis a un colaborador con membresía activa', async () => {
      const response = await useCase.execute({
        projectId,
        userId: collaboratorId,
      });

      expect(response.projectId).toBe(projectId);
      expect(response.analysis.riskSignals).toEqual(['Una tarea crítica sin asignar.']);
    });

    it('permite generar análisis al docente asignado al proyecto', async () => {
      const response = await useCase.execute({
        projectId,
        userId: assignedTeacherId,
      });

      expect(response.projectId).toBe(projectId);
      expect(response.analysis.nextSteps).toEqual(['Asignar responsable de pruebas.']);
    });

    it('rechaza con 404 si el proyecto no existe', async () => {
      await expect(
        useCase.execute({
          projectId: '99999999-9999-4999-8999-999999999999',
          userId: creatorId,
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
      });
    });

    it('rechaza con 403 a un usuario ajeno sin membresía ni asignación', async () => {
      await expect(
        useCase.execute({
          projectId,
          userId: outsiderId,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rechaza con 403 a un miembro inactivo/removido', async () => {
      await expect(
        useCase.execute({
          projectId,
          userId: inactiveMemberId,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });

    it('rechaza con 403 a un docente no asignado a este proyecto', async () => {
      await expect(
        useCase.execute({
          projectId,
          userId: unassignedTeacherId,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
      });
    });
  });

  describe('Control de Cuotas y Concurrencia', () => {
    it('rechaza con 429 si hay una solicitud en vuelo para el mismo usuario y proyecto', async () => {
      // Adquirir lock previo directamente en el adapter de cuota
      await fakeQuota.checkAndAcquire(creatorId, projectId);

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toMatchObject({
        statusCode: 429,
        reason: 'IN_FLIGHT_CONFLICT',
      });
    });

    it('rechaza con 429 si el proyecto superó el límite de 5 análisis en 10 minutos', async () => {
      for (let i = 1; i <= 5; i++) {
        await fakeQuota.checkAndAcquire(`user-${i}`, projectId);
        await fakeQuota.release(`user-${i}`, projectId, 'success');
      }

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toMatchObject({
        statusCode: 429,
        reason: 'RATE_LIMIT_EXCEEDED',
      });
    });

    it('libera la cuota con "success" tras un análisis completado exitosamente', async () => {
      expect(fakeQuota.getInFlightCount()).toBe(0);

      await useCase.execute({
        projectId,
        userId: creatorId,
      });

      // El in-flight debe haberse liberado
      expect(fakeQuota.getInFlightCount()).toBe(0);

      // Y una nueva solicitud del mismo usuario debe ser permitida
      const secondAttempt = await useCase.execute({
        projectId,
        userId: creatorId,
      });
      expect(secondAttempt.projectId).toBe(projectId);
    });

    it('libera la cuota con "error" cuando el proveedor de IA falla', async () => {
      fakeAIProvider.setShouldFailUnavailable(true);

      let releaseOutcome: AIQuotaReleaseOutcome | undefined;
      const originalRelease = fakeQuota.release.bind(fakeQuota);
      fakeQuota.release = async (u, p, outcome) => {
        releaseOutcome = outcome;
        return originalRelease(u, p, outcome);
      };

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toBeInstanceOf(AIProviderUnavailableError);

      expect(releaseOutcome).toBe('error');
      expect(fakeQuota.getInFlightCount()).toBe(0);
    });

    it('libera la cuota con "timeout" cuando la solicitud es abortada por timeout', async () => {
      fakeAIProvider.setShouldTimeout(true);

      let releaseOutcome: AIQuotaReleaseOutcome | undefined;
      const originalRelease = fakeQuota.release.bind(fakeQuota);
      fakeQuota.release = async (u, p, outcome) => {
        releaseOutcome = outcome;
        return originalRelease(u, p, outcome);
      };

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toThrow('The user aborted a request.');

      expect(releaseOutcome).toBe('timeout');
      expect(fakeQuota.getInFlightCount()).toBe(0);
    });
  });

  describe('Sanitización, Acotación y Salvaguardas Éticas', () => {
    it('incluye reglas éticas estrictas en el system prompt prohibiendo calificar', async () => {
      await useCase.execute({
        projectId,
        userId: creatorId,
      });

      const lastReq = fakeAIProvider.getLastRequest();
      expect(lastReq?.systemPrompt).toContain('TERMINANTEMENTE PROHIBIDO emitir calificaciones');
      expect(lastReq?.systemPrompt).toContain('competencia exclusiva del docente');
      expect(lastReq?.systemPrompt).toContain('progressSummary');
      expect(lastReq?.systemPrompt).toContain('riskSignals');
      expect(lastReq?.systemPrompt).toContain('nextSteps');
    });

    it('no incluye tokens, credenciales ni información de otros proyectos en el user prompt', async () => {
      const board = await boardRepository.findOrCreateDefaultBoard(projectId);
      const colId = board.columns[0]?.id ?? 'col-1';
      await taskRepository.create({
        projectId,
        columnId: colId,
        title: 'Diseñar arquitectura hexagonal',
        priority: 'HIGH',
        orderIndex: 0,
        labels: ['arquitectura'],
        creatorId,
        assigneeIds: [collaboratorId],
      });

      await useCase.execute({
        projectId,
        userId: creatorId,
      });

      const userPrompt = fakeAIProvider.getLastRequest()?.userPrompt ?? '';
      expect(userPrompt).toContain(sampleProject.title);
      expect(userPrompt).toContain('Diseñar arquitectura hexagonal');
      expect(userPrompt).not.toContain('password');
      expect(userPrompt).not.toContain('secret');
      expect(userPrompt).not.toContain('Bearer');
    });

    it('acota deterministamente a un máximo de 50 tareas cuando hay más de 50', async () => {
      const board = await boardRepository.findOrCreateDefaultBoard(projectId);
      const colId = board.columns[0]?.id ?? 'col-1';

      // Crear 65 tareas
      for (let i = 1; i <= 65; i++) {
        await taskRepository.create({
          projectId,
          columnId: colId,
          title: `Tarea de prueba número ${i}`,
          priority: i % 2 === 0 ? 'HIGH' : 'LOW',
          orderIndex: i,
          labels: ['test'],
          creatorId,
          assigneeIds: [],
        });
      }

      await useCase.execute({
        projectId,
        userId: creatorId,
      });

      const userPrompt = fakeAIProvider.getLastRequest()?.userPrompt ?? '';
      expect(userPrompt).toContain('Total de tareas registradas: 65');
      expect(userPrompt).toContain('Muestra de tareas prioritarias (50)');
    });

    it('excluye tareas completadas hace más de 7 días pero conserva las completadas recientes', async () => {
      const board = await boardRepository.findOrCreateDefaultBoard(projectId);
      const doneCol =
        board.columns.find((c) => /done|completad/i.test(c.name)) ??
        board.columns[board.columns.length - 1];
      const doneColId = doneCol?.id ?? 'col-done';

      // Tarea completada hace 10 días (debe excluirse)
      const oldDoneDate = new Date(fixedNow - 10 * 24 * 60 * 60 * 1000).toISOString();
      const oldTask = await taskRepository.create({
        projectId,
        columnId: doneColId,
        title: 'Tarea completada antigua',
        priority: 'LOW',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [],
      });
      // Sobrescribir updatedAt manualmente en storage y hacer commit
      const storageAccess = (taskRepository as unknown as { storage: InMemoryKanbanProjectStorage })
        .storage;

      // Tarea completada hace 2 días (debe conservarse)
      const recentDoneDate = new Date(fixedNow - 2 * 24 * 60 * 60 * 1000).toISOString();
      const recentTask = await taskRepository.create({
        projectId,
        columnId: doneColId,
        title: 'Tarea completada reciente',
        priority: 'MEDIUM',
        orderIndex: 1,
        labels: [],
        creatorId,
        assigneeIds: [],
      });

      const snapshot = storageAccess.getSnapshot(projectId);
      const foundOld = snapshot.tasks.find((t) => t.id === oldTask.id);
      if (foundOld) foundOld.updatedAt = oldDoneDate;
      const foundRecent = snapshot.tasks.find((t) => t.id === recentTask.id);
      if (foundRecent) foundRecent.updatedAt = recentDoneDate;
      storageAccess.commitSnapshot(projectId, snapshot);

      await useCase.execute({
        projectId,
        userId: creatorId,
      });

      const userPrompt = fakeAIProvider.getLastRequest()?.userPrompt ?? '';
      expect(userPrompt).toContain('Tarea completada reciente');
      expect(userPrompt).not.toContain('Tarea completada antigua');
    });

    it('prioriza tareas urgentes y con fecha límite más próxima', async () => {
      const board = await boardRepository.findOrCreateDefaultBoard(projectId);
      const colId = board.columns[0]?.id ?? 'col-1';

      await taskRepository.create({
        projectId,
        columnId: colId,
        title: 'Tarea baja sin fecha',
        priority: 'LOW',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [],
      });

      await taskRepository.create({
        projectId,
        columnId: colId,
        title: 'Tarea urgente con fecha cercana',
        priority: 'URGENT',
        dueDate: '2026-03-25T00:00:00.000Z',
        orderIndex: 1,
        labels: [],
        creatorId,
        assigneeIds: [],
      });

      await useCase.execute({
        projectId,
        userId: creatorId,
      });

      const userPrompt = fakeAIProvider.getLastRequest()?.userPrompt ?? '';
      const urgentIndex = userPrompt.indexOf('Tarea urgente con fecha cercana');
      const lowIndex = userPrompt.indexOf('Tarea baja sin fecha');

      expect(urgentIndex).toBeGreaterThan(-1);
      expect(lowIndex).toBeGreaterThan(-1);
      expect(urgentIndex).toBeLessThan(lowIndex);
    });
  });

  describe('Validación de Respuestas del Modelo y Disclaimer', () => {
    it('inyecta incondicionalmente el disclaimer del servidor', async () => {
      fakeAIProvider.setResponse(
        JSON.stringify({
          progressSummary: 'Avance adecuado.',
          riskSignals: ['Riesgo 1'],
          nextSteps: ['Paso 1'],
        }),
      );

      const response = await useCase.execute({
        projectId,
        userId: creatorId,
      });

      expect(response.meta.disclaimer).toBe(AI_ASSISTANT_DISCLAIMER);
      expect(response.meta.disclaimer).toBe(
        'Orientación formativa generada por IA. No constituye calificación ni evaluación académica oficial.',
      );
    });

    it('soporta respuestas del modelo envueltas en markdown code fences', async () => {
      fakeAIProvider.setResponse(
        '```json\n{\n  "progressSummary": "Resumen con fences",\n  "riskSignals": [],\n  "nextSteps": ["Paso"]\n}\n```',
      );

      const response = await useCase.execute({
        projectId,
        userId: creatorId,
      });

      expect(response.analysis.progressSummary).toBe('Resumen con fences');
    });

    it('lanza AIInvalidResponseError (502) si el modelo responde texto no JSON', async () => {
      fakeAIProvider.setResponse('Hola, como modelo de lenguaje no puedo ayudarte.');

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toBeInstanceOf(AIInvalidResponseError);
    });

    it('lanza AIInvalidResponseError (502) si el JSON no cumple con la estructura requerida', async () => {
      fakeAIProvider.setResponse(
        JSON.stringify({
          // Falta progressSummary
          riskSignals: ['Riesgo'],
          nextSteps: ['Paso'],
        }),
      );

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toBeInstanceOf(AIInvalidResponseError);
    });

    it('propaga AIRateLimitError del proveedor', async () => {
      fakeAIProvider.setShouldFailRateLimit(true);

      await expect(
        useCase.execute({
          projectId,
          userId: creatorId,
        }),
      ).rejects.toBeInstanceOf(AIRateLimitError);
    });
  });
});
