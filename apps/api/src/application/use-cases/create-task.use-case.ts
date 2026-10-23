import type {
  TaskCreationPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
  TaskResponse,
  TaskPriority,
} from '@is488/shared';
import { CreateTaskSchema, TaskResponseSchema, IneligibleAssigneeError } from '@is488/shared';

export interface CreateTaskCommand {
  projectId: string;
  requesterId: string;
  columnId: string;
  title: string;
  description?: string;
  priority?: TaskPriority;
  dueDate?: string;
  labels?: string[];
  assigneeIds?: string[];
}

/**
 * Caso de uso para la creación atómica de una tarea dentro del tablero Kanban
 * de un proyecto académico.
 *
 * Cumple estrictamente con la Arquitectura Hexagonal:
 * - Depende exclusivamente de abstracciones/puertos (TaskCreationPort, ProjectRepositoryPort,
 *   MembershipRepositoryPort, SystemClockPort).
 * - Delega la persistencia indivisible de la tarea y su evento CREATED al puerto
 *   sin ejecutar dos publicaciones ni requerir compensación manual en aplicación.
 */
export class CreateTaskUseCase {
  constructor(
    private readonly taskCreationPort: TaskCreationPort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  async execute(command: CreateTaskCommand): Promise<TaskResponse> {
    // 1. Validación Zod de esquema de entrada
    const validated = CreateTaskSchema.parse({
      columnId: command.columnId,
      title: command.title,
      description: command.description,
      priority: command.priority,
      dueDate: command.dueDate,
      labels: command.labels,
      assigneeIds: command.assigneeIds,
    });

    // 2. Autorización contextual a nivel de proyecto (404 estricto para creador vs no-miembros / docentes no asignados)
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

    // 3. Validación de elegibilidad: todos los asignados deben ser miembros activos del proyecto
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

    // 4. Creación atómica de tarea y evento inmutable CREATED mediante el puerto
    const now = this.clock.isoString();
    const result = await this.taskCreationPort.executeAtomicTaskCreation({
      projectId: command.projectId,
      columnId: validated.columnId,
      title: validated.title,
      description: validated.description,
      priority: validated.priority,
      dueDate: validated.dueDate,
      labels: validated.labels,
      creatorId: command.requesterId,
      assigneeIds: validated.assigneeIds,
      timestamp: now,
    });

    return TaskResponseSchema.parse(result.task);
  }
}
