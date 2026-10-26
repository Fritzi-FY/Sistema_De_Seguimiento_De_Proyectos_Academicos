import type {
  TaskListPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  PaginatedTasksResponse,
  TaskPriority,
} from '@is488/shared';
import {
  ListTasksQuerySchema,
  PaginatedTasksResponseSchema,
  TaskResponseSchema,
} from '@is488/shared';

/**
 * Comando de entrada para ListTasksUseCase.
 * Los filtros y parametros de paginacion son opcionales y se validan con ListTasksQuerySchema.
 */
export interface ListTasksCommand {
  projectId: string;
  requesterId: string;
  page?: number | string;
  limit?: number | string;
  columnId?: string;
  priority?: string;
  assigneeId?: string;
  label?: string;
  search?: string;
}

/**
 * Caso de uso para el listado paginado y filtrado de tareas de un proyecto Kanban.
 *
 * Cumple con la Arquitectura Hexagonal:
 * - Depende exclusivamente de puertos (TaskListPort, ProjectRepositoryPort, MembershipRepositoryPort).
 * - Sin acceso directo al storage; sin mutaciones ni publicacion de eventos.
 *
 * Reglas de negocio y seguridad:
 * - Autorizacion contextual con 404 estricto para no-miembros y docentes no asignados.
 * - Validacion de parametros de consulta con ListTasksQuerySchema (Zod).
 * - Aislamiento horizontal: solo devuelve tareas del proyecto autorizado.
 * - Ningun campo de la respuesta puede revelar la existencia de otros proyectos.
 */
export class ListTasksUseCase {
  constructor(
    private readonly taskListPort: TaskListPort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  async execute(command: ListTasksCommand): Promise<PaginatedTasksResponse> {
    // 1. Validacion de parametros de consulta
    const validated = ListTasksQuerySchema.parse({
      page: command.page,
      limit: command.limit,
      columnId: command.columnId,
      priority: command.priority,
      assigneeId: command.assigneeId,
      label: command.label,
      search: command.search,
    });

    // 2. Autorizacion contextual (404 estricto para no-miembros y docentes no asignados)
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

    // 3. Listado a traves del puerto (sin mutacion)
    const result = await this.taskListPort.listProjectTasks({
      projectId: command.projectId,
      page: validated.page,
      limit: validated.limit,
      filter: {
        columnId: validated.columnId,
        priority: validated.priority as TaskPriority | undefined,
        assigneeId: validated.assigneeId,
        label: validated.label,
        search: validated.search,
      },
    });

    // 4. Validacion de respuesta contra contrato canonico
    return PaginatedTasksResponseSchema.parse({
      items: result.items.map((t) => TaskResponseSchema.parse(t)),
      totalItems: result.totalItems,
      page: result.page,
      limit: result.limit,
      totalPages: result.totalPages,
    });
  }
}
