import type {
  BoardRepositoryPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  BoardColumnResponse,
  ColumnCategory,
} from '@is488/shared';
import {
  CreateBoardColumnSchema,
  BoardColumnResponseSchema,
  MaxColumnsReachedError,
} from '@is488/shared';

export interface CreateBoardColumnCommand {
  projectId: string;
  requesterId: string;
  name: string;
  category?: ColumnCategory;
  color?: string;
}

export class CreateBoardColumnUseCase {
  constructor(
    private readonly boardRepository: BoardRepositoryPort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  async execute(command: CreateBoardColumnCommand): Promise<BoardColumnResponse> {
    const validated = CreateBoardColumnSchema.parse({
      name: command.name,
      category: command.category,
      color: command.color,
    });

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

    const board = await this.boardRepository.findOrCreateDefaultBoard(command.projectId);

    if (board.columns.length >= 10) {
      throw Object.assign(new MaxColumnsReachedError(board.id, 10), {
        statusCode: 400,
      });
    }

    const newColumn = await this.boardRepository.addColumn(board.id, {
      boardId: board.id,
      name: validated.name,
      category: validated.category,
      color: validated.color,
      orderIndex: board.columns.length,
    });

    return BoardColumnResponseSchema.parse(newColumn);
  }
}
