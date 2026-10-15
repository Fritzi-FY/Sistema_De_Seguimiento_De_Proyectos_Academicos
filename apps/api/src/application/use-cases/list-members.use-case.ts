import type {
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  MemberListResponse,
} from '@is488/shared';
import { MemberListResponseSchema } from '@is488/shared';

export interface ListMembersQuery {
  projectId: string;
  /** ID del usuario que solicita la lista (debe tener membresía activa). */
  requesterId: string;
}

/**
 * Caso de uso para listar los miembros activos de un proyecto.
 *
 * Política de acceso:
 * - El proyecto debe existir (404 si no).
 * - El solicitante debe tener una membresía activa en el proyecto (404 si no,
 *   siguiendo política de no revelar existencia del proyecto a usuarios sin acceso).
 *
 * El 404 por falta de membresía (en lugar de 403) se adopta intencionalmente:
 * un usuario sin membresía no debe poder inferir si el proyecto existe o no.
 * (design.md Decisión 3 — política de respuestas HTTP para acceso).
 */
export class ListMembersUseCase {
  constructor(
    private readonly projectRepository: ProjectRepositoryPort,
    private readonly membershipRepository: MembershipRepositoryPort,
  ) {}

  async execute(query: ListMembersQuery): Promise<MemberListResponse> {
    // 1. Verificar que el proyecto existe
    const project = await this.projectRepository.findById(query.projectId);
    if (!project) {
      throw Object.assign(new Error(`Proyecto '${query.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    // 2. Verificar que el solicitante tiene membresía activa (owner o collaborator)
    //    Nota: el owner (creatorId) siempre tiene membresía activa por invariante del sistema;
    //    verificamos igualmente a través del repositorio para mantener la comprobación uniforme.
    const requesterMembership = await this.membershipRepository.findByProjectAndUser(
      query.projectId,
      query.requesterId,
    );
    if (!requesterMembership) {
      // 404 para no revelar existencia del proyecto a usuarios sin membresía
      throw Object.assign(new Error(`Proyecto '${query.projectId}' no encontrado`), {
        statusCode: 404,
      });
    }

    // 3. Obtener y retornar los miembros activos del proyecto
    const members = await this.membershipRepository.findByProject(query.projectId);
    return MemberListResponseSchema.parse(members);
  }
}
