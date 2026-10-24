import type {
  BoardRepositoryPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  BoardColumnResponse,
  ColumnCategory,
} from '@is488/shared';
import {
  UpdateBoardColumnSchema,
  BoardColumnResponseSchema,
  BoardColumnNotFoundError,
} from '@is488/shared';

export interface UpdateBoardColumnCommand {
  projectId: string;
  columnId: string;
  requesterId: string;
  name?: string;
  category?: ColumnCategory;
  color?: string;
  orderIndex?: number;
}

export class UpdateBoardColumnUseCase {
  constructor(
    private readonly boardRepository: BoardRepositoryPort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  async execute(command: UpdateBoardColumnCommand): Promise<BoardColumnResponse> {
    const rawPayload: Record<string, unknown> = {};
    if (command.name !== undefined) rawPayload.name = command.name;
    if (command.category !== undefined) rawPayload.category = command.category;
    if (command.color !== undefined) rawPayload.color = command.color;
    if (command.orderIndex !== undefined) rawPayload.orderIndex = command.orderIndex;

    const validated = UpdateBoardColumnSchema.parse(rawPayload);

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

    const board = await this.boardRepository.findByProjectId(command.projectId);
    if (!board || !board.columns.some((c) => c.id === command.columnId)) {
      throw Object.assign(new BoardColumnNotFoundError(command.columnId), {
        statusCode: 404,
      });
    }

    const updated = await this.boardRepository.updateColumn(command.columnId, validated);
    return BoardColumnResponseSchema.parse(updated);
  }
}
