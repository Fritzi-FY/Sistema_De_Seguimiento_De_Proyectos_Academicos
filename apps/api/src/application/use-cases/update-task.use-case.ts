import type {
  TaskUpdatePort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
  TaskResponse,
  TaskPriority,
  TaskActivityEvent,
} from '@is488/shared';
import { UpdateTaskSchema, TaskResponseSchema, IneligibleAssigneeError } from '@is488/shared';

export interface UpdateTaskCommand {
  projectId: string;
  taskId: string;
  requesterId: string;
  title?: string;
  description?: string;
  columnId?: string;
  priority?: TaskPriority;
  dueDate?: string | null;
  labels?: string[];
  assigneeIds?: string[];
}

export interface UpdateTaskResult {
  task: TaskResponse;
  activity: TaskActivityEvent | null;
}

/**
 * Caso de uso para la actualización atómica de campos editables de una tarea
 * en el tablero Kanban de un proyecto académico.
 *
 * Cumple rigurosamente con la Arquitectura Hexagonal:
 * - Depende exclusivamente de abstracciones/puertos (TaskUpdatePort, ProjectRepositoryPort,
 *   MembershipRepositoryPort, SystemClockPort).
 * - Delega la persistencia indivisible de la tarea y su evento UPDATED al puerto
 *   sin ejecutar dos publicaciones ni requerir compensación manual en aplicación.
 *
 * Reglas de negocio y seguridad:
 * - Autorización contextual con 404 estricto para no-miembros y docentes no asignados.
 * - Impide modificar identidad (id), proyecto (projectId), creador (creatorId) y
 *   campos de movimiento (columnId, orderIndex) mediante esta operación (400 Bad Request).
 * - Valida elegibilidad activa de todos los asignados (400 IneligibleAssigneeError).
 * - Semántica de actualización parcial y vaciado conforme al contrato Zod/OpenSpec.
 */
export class UpdateTaskUseCase {
  constructor(
    private readonly taskUpdatePort: TaskUpdatePort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  async execute(command: UpdateTaskCommand): Promise<UpdateTaskResult> {
    const rawCommand = command as unknown as Record<string, unknown>;

    // 1. Prohibir estrictamente alterar identidad, creador, orden o proyecto
    if ('id' in rawCommand && rawCommand.id !== command.taskId) {
      throw Object.assign(
        new Error('No se permite modificar el identificador inmutable de la tarea'),
        { statusCode: 400 },
      );
    }
    if ('creatorId' in rawCommand && typeof rawCommand.creatorId === 'string') {
      throw Object.assign(new Error('No se permite modificar el creador de la tarea'), {
        statusCode: 400,
      });
    }
    if ('orderIndex' in rawCommand && rawCommand.orderIndex !== undefined) {
      throw Object.assign(
        new Error(
          'No se permite modificar el orden de la tarea mediante actualización; use MoveTask',
        ),
        { statusCode: 400 },
      );
    }
    if (
      ('targetProjectId' in rawCommand && rawCommand.targetProjectId !== undefined) ||
      ('newProjectId' in rawCommand && rawCommand.newProjectId !== undefined)
    ) {
      throw Object.assign(
        new Error('No se permite transferir la tarea a otro proyecto mediante actualización'),
        { statusCode: 400 },
      );
    }

    // 2. Prohibir modificar campos de movimiento (columnId)
    if (command.columnId !== undefined) {
      throw Object.assign(
        new Error(
          'No se permite modificar la columna ni mover la tarea mediante la actualización; use MoveTask',
        ),
        { statusCode: 400 },
      );
    }

    // 3. Construir objeto de actualización omitiendo claves undefined para que Zod refine detecte payload vacío
    const rawUpdate: Record<string, unknown> = {};
    if (command.title !== undefined) rawUpdate.title = command.title;
    if (command.description !== undefined) rawUpdate.description = command.description;
    if (command.priority !== undefined) rawUpdate.priority = command.priority;
    if (command.dueDate !== undefined) rawUpdate.dueDate = command.dueDate;
    if (command.labels !== undefined) rawUpdate.labels = command.labels;
    if (command.assigneeIds !== undefined) rawUpdate.assigneeIds = command.assigneeIds;

    const validated = UpdateTaskSchema.parse(rawUpdate);

    // 4. Autorización contextual a nivel de proyecto (404 estricto para no-miembros y docentes no asignados)
    const project = await this.projectRepository.findById(command.projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${command.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    const isCreator = project.creatorId === command.requesterId;
    let isActiveMember = false;
    if (!isCreator) {
      const membership = await this.membershipRepository.findByProjectAndUser(
        command.projectId,
        command.requesterId,
      );
      isActiveMember = membership !== null && membership.status === 'active';
    }

    if (!isCreator && !isActiveMember) {
      throw Object.assign(new Error(`Proyecto '${command.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    // 5. Validación de elegibilidad de asignados: deben poseer membresía activa en el proyecto
    if (validated.assigneeIds !== undefined) {
      for (const assigneeId of validated.assigneeIds) {
        const membership = await this.membershipRepository.findByProjectAndUser(
          command.projectId,
          assigneeId,
        );
        if (!membership || membership.status !== 'active') {
          throw Object.assign(new IneligibleAssigneeError(assigneeId, command.projectId), {
            statusCode: 400,
          });
        }
      }
    }

    // 6. Actualización atómica en el almacenamiento bajo exclusión mutua
    const now = this.clock.isoString();
    const result = await this.taskUpdatePort.executeAtomicTaskUpdate({
      taskId: command.taskId,
      projectId: command.projectId,
      actorId: command.requesterId,
      patch: {
        title: validated.title,
        description: validated.description,
        priority: validated.priority,
        dueDate: validated.dueDate,
        labels: validated.labels,
        assigneeIds: validated.assigneeIds,
      },
      timestamp: now,
    });

    return {
      task: TaskResponseSchema.parse(result.task),
      activity: result.activity,
    };
  }
}
