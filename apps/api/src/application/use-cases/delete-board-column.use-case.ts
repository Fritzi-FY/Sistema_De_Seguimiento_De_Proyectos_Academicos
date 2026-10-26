import type {
  BoardColumnDeletionPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
} from '@is488/shared';
import { DeleteBoardColumnQuerySchema } from '@is488/shared';

export interface DeleteBoardColumnCommand {
  projectId: string;
  columnId: string;
  requesterId: string;
  targetColumnId?: string;
}

export interface DeleteBoardColumnResult {
  success: true;
  deletedColumnId: string;
  migratedTasksCount: number;
}

export class DeleteBoardColumnUseCase {
  constructor(
    private readonly columnDeletionPort: BoardColumnDeletionPort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  async execute(command: DeleteBoardColumnCommand): Promise<DeleteBoardColumnResult> {
    if (command.targetColumnId) {
      DeleteBoardColumnQuerySchema.parse({ targetColumnId: command.targetColumnId });
    }

    // 1. Autorizacion contextual a nivel de proyecto (404 estricto para aislamiento horizontal y denegacion docente por defecto)
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

    // 2. Delegar la verificacion de invariantes y la ejecucion atomica al puerto
    // Se ejecuta dentro de la frontera transaccional de exclusion mutua para evitar TOCTOU.
    const result = await this.columnDeletionPort.executeAtomicColumnDeletion({
      projectId: command.projectId,
      columnId: command.columnId,
      targetColumnId: command.targetColumnId,
      actorId: command.requesterId,
      reason: 'Reasignacion automatica por eliminacion de columna',
      timestamp: this.clock.isoString(),
    });

    return {
      success: true,
      deletedColumnId: result.deletedColumnId,
      migratedTasksCount: result.migratedTasksCount,
    };
  }
}
