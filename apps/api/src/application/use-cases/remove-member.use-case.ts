import type {
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
  MembershipResponse,
} from '@is488/shared';
import { MembershipResponseSchema, MembershipNotFoundError } from '@is488/shared';

export interface RemoveMemberCommand {
  projectId: string;
  /** ID del usuario que realiza la solicitud (debe ser el creador del proyecto). */
  requesterId: string;
  /** ID del usuario a retirar. */
  targetUserId: string;
  membershipId: string;
}

/**
 * Caso de uso para retirar a un colaborador de un proyecto.
 *
 * Orden de verificaciones (según Decisión 3 en design.md):
 * 1. Verificar que el proyecto existe (404 si no).
 * 2. Verificar que el solicitante es el creador del proyecto (403 si no).
 * 3. Verificar que la membresía activa del targetUserId existe (404 si no).
 * 4. Rechazar si targetUserId === project.creatorId (422: no se puede retirar al owner).
 *
 * El orden (2) emite un 403 después de confirmar existencia del proyecto. Un solicitante
 * que recibe 403 sabe que el proyecto existe — política acordada explícitamente en P3:
 * el 403 se usa cuando "el recurso existe y el usuario lo conoce" (design.md Decisión 3).
 */
export class RemoveMemberUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  async execute(command: RemoveMemberCommand): Promise<MembershipResponse> {
    // 1. Verificar que el proyecto existe
    const project = await this.projectRepository.findById(command.projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${command.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    // 2. Verificar que el solicitante es el creador
    if (project.creatorId !== command.requesterId) {
      throw Object.assign(new Error('Solo el creador del proyecto puede retirar integrantes'), {
        statusCode: 403,
      });
    }

    // 3. Verificar que la membresía activa del target existe
    const targetMembership = await this.membershipRepository.findByProjectAndUser(
      command.projectId,
      command.targetUserId,
    );
    if (!targetMembership || targetMembership.id !== command.membershipId) {
      throw Object.assign(
        new Error(`El usuario '${command.targetUserId}' no tiene membresía activa en el proyecto`),
        { statusCode: 404 },
      );
    }

    // 4. Rechazar si el target es el propietario (owner no puede ser retirado)
    if (command.targetUserId === project.creatorId) {
      throw Object.assign(
        new Error('El propietario del proyecto no puede ser retirado como miembro'),
        { statusCode: 422 },
      );
    }

    try {
      const persisted = await this.membershipRepository.removeMember({
        membershipId: command.membershipId,
        projectId: command.projectId,
        userId: command.targetUserId,
        removedAt: this.clock.isoString(),
      });
      return MembershipResponseSchema.parse(persisted);
    } catch (error) {
      if (error instanceof MembershipNotFoundError) throw Object.assign(error, { statusCode: 404 });
      throw error;
    }
  }
}
