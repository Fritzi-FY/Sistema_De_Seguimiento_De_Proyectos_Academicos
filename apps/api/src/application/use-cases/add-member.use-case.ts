import type {
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
  MembershipResponse,
} from '@is488/shared';
import { MembershipResponseSchema, DuplicateMembershipError } from '@is488/shared';

export interface AddMemberCommand {
  projectId: string;
  /** ID del usuario que realiza la solicitud (debe ser el creador del proyecto). */
  requesterId: string;
  /** ID del usuario que se desea agregar como colaborador. */
  userId: string;
}

/**
 * Caso de uso para agregar un colaborador a un proyecto existente.
 *
 * Reglas de autorización:
 * - Solo el creador del proyecto (creatorId) puede agregar miembros (403 si no).
 * - El proyecto debe existir (404 si no).
 * - El usuario a agregar no debe tener una membresía activa en el proyecto (409 si tiene).
 * - El rol asignado es siempre 'collaborator'; el rol 'owner' no se expone en este caso de uso.
 */
export class AddMemberUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  async execute(command: AddMemberCommand): Promise<MembershipResponse> {
    // 1. Verificar que el proyecto existe
    const project = await this.projectRepository.findById(command.projectId);
    if (!project) {
      const error = new Error(`Proyecto '${command.projectId}' no encontrado`);
      throw Object.assign(error, { statusCode: 404 });
    }

    // 2. Verificar que el solicitante es el creador del proyecto
    if (project.creatorId !== command.requesterId) {
      const error = new Error('Solo el creador del proyecto puede agregar integrantes');
      throw Object.assign(error, { statusCode: 403 });
    }

    // 3. Persistir membresía con role: 'collaborator' y status: 'active'
    const now = this.clock.isoString();
    let membership;
    try {
      membership = await this.membershipRepository.addMember({
        projectId: command.projectId,
        userId: command.userId,
        role: 'collaborator',
        status: 'active',
        removedAt: null,
        joinedAt: now,
        updatedAt: now,
      });
    } catch (err) {
      if (err instanceof DuplicateMembershipError) {
        throw Object.assign(err, { statusCode: 409 });
      }
      throw err;
    }

    return MembershipResponseSchema.parse(membership);
  }
}
