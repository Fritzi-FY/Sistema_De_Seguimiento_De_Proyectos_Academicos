import type {
  TaskMovePort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
  TaskResponse,
  TaskActivityEvent,
} from '@is488/shared';
import { MoveTaskSchema, TaskResponseSchema } from '@is488/shared';

export interface MoveTaskCommand {
  projectId: string;
  taskId: string;
  destinationColumnId: string;
  destinationIndex: number;
  requestingUserId: string;
}

export interface MoveTaskResult {
  task: TaskResponse;
  activity: TaskActivityEvent | null;
}

/**
 * Caso de uso para el movimiento atómico de una tarea dentro del tablero Kanban
 * de un proyecto académico.
 *
 * Cumple estrictamente con la Arquitectura Hexagonal:
 * - Depende exclusivamente de abstracciones/puertos (TaskMovePort, ProjectRepositoryPort,
 *   MembershipRepositoryPort, SystemClockPort).
 * - Delega la persistencia indivisible del movimiento y su evento MOVED al puerto
 *   sin ejecutar dos publicaciones ni requerir compensación manual en aplicación.
 * - Revalida todas las invariantes críticas antes de invocar el puerto.
 *
 * Comportamiento de índice fuera de rango:
 * - Si destinationIndex > longitud de la columna destino, se clampea al final.
 *   No se rechaza con error; el puerto garantiza índices contiguos.
 *
 * Comportamiento idempotente:
 * - Si la tarea ya está en la misma columna y misma posición efectiva,
 *   se retorna la tarea sin modificar datos ni emitir evento MOVED.
 */
export class MoveTaskUseCase {
  constructor(
    private readonly taskMovePort: TaskMovePort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  async execute(command: MoveTaskCommand): Promise<MoveTaskResult> {
    // 1. Validación Zod del esquema de entrada
    const validated = MoveTaskSchema.parse({
      destinationColumnId: command.destinationColumnId,
      destinationIndex: command.destinationIndex,
    });

    // 2. Autorización contextual a nivel de proyecto
    //    (404 estricto para aislamiento horizontal: no-miembros y docentes no asignados)
    const project = await this.projectRepository.findById(command.projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${command.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    const isCreator = project.creatorId === command.requestingUserId;
    let isActiveMember = false;
    if (!isCreator) {
      const membership = await this.membershipRepository.findByProjectAndUser(
        command.projectId,
        command.requestingUserId,
      );
      isActiveMember = membership !== null && membership.status === 'active';
    }

    if (!isCreator && !isActiveMember) {
      throw Object.assign(new Error(`Proyecto '${command.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    // 3. Ejecución atómica: movimiento + evento MOVED dentro de exclusión mutua única.
    //    El puerto revalida existencia de tarea y pertenencia de columna destino al proyecto
    //    dentro del lock (evita TOCTOU). No se requiere rollback manual.
    const now = this.clock.isoString();
    const result = await this.taskMovePort.executeAtomicTaskMove({
      taskId: command.taskId,
      projectId: command.projectId,
      destinationColumnId: validated.destinationColumnId,
      destinationIndex: validated.destinationIndex,
      actorId: command.requestingUserId,
      timestamp: now,
    });

    return {
      task: TaskResponseSchema.parse(result.task),
      activity: result.activity,
    };
  }
}
