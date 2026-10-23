import type {
  BoardRepositoryPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  BoardResponse,
} from '@is488/shared';
import { BoardResponseSchema } from '@is488/shared';

export interface GetProjectBoardQuery {
  projectId: string;
  requesterId: string;
}

export class GetProjectBoardUseCase {
  constructor(
    private readonly boardRepository: BoardRepositoryPort,
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  async execute(query: GetProjectBoardQuery): Promise<BoardResponse> {
    const project = await this.projectRepository.findById(query.projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${query.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    const isCreator = project.creatorId === query.requesterId;
    let isActiveMember = false;
    if (!isCreator) {
      const membership = await this.membershipRepository.findByProjectAndUser(
        query.projectId,
        query.requesterId,
      );
      isActiveMember = membership !== null && membership.status === 'active';
    }

    if (!isCreator && !isActiveMember) {
      throw Object.assign(new Error(`Proyecto '${query.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    const board = await this.boardRepository.findOrCreateDefaultBoard(query.projectId);
    return BoardResponseSchema.parse(board);
  }
}
