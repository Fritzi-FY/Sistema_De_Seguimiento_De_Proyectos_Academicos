import type {
  TeacherProjectScopePort,
  MembershipRepositoryPort,
  ReviewRepositoryPort,
  TeacherReviewRequest,
  TeacherReviewAction,
  ReviewTimelineEntry,
} from '@is488/shared';
import { deriveReviewTimeline } from '@is488/shared';

export interface GetTeacherReviewQuery {
  /** UUID del proyecto al que pertenece la revisión. */
  projectId: string;
  /** UUID de la solicitud de revisión a consultar. */
  reviewId: string;
  /** ID del usuario que solicita la consulta (obtenido del contexto autenticado). */
  userId: string;
}

export interface TeacherReviewDetail {
  request: TeacherReviewRequest;
  actions: TeacherReviewAction[];
  timeline: ReviewTimelineEntry[];
}

/**
 * Caso de uso: Consultar el detalle de una solicitud de revisión docente.
 *
 * Reglas de acceso (restrictivo):
 * - Permitido únicamente al:
 *   1. Solicitante original (review.requesterId === userId) CON membresía activa en el proyecto.
 *   2. Docente actualmente asignado al proyecto (TeacherProjectScopePort.isAssigned).
 * - Cualquier otro usuario (incluyendo colaboradores del mismo proyecto que no formularon
 *   la solicitud, o docentes no asignados) recibe 404 Not Found.
 * - Reasignación: el nuevo docente puede consultar el historial completo.
 *   El docente saliente (ya desasignado) recibe 404.
 * - El historial se deriva de forma determinista por sequenceNumber ASC mediante
 *   deriveReviewTimeline: el evento 0 (incepción) siempre tiene status PENDING.
 * - Verifica projectId y reviewId conjuntamente para impedir filtración de datos entre proyectos.
 * - Las copias devueltas por el repositorio impiden mutaciones externas.
 */
export class GetTeacherReviewUseCase {
  constructor(
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly teacherScope: TeacherProjectScopePort,
    private readonly reviewRepository: ReviewRepositoryPort,
  ) {}

  async execute(query: GetTeacherReviewQuery): Promise<TeacherReviewDetail> {
    // 1. Buscar la revisión (verifica projectId + reviewId conjuntamente) → 404 si no existe
    const found = await this.reviewRepository.findById(query.projectId, query.reviewId);
    if (!found) {
      throw Object.assign(
        new Error(`Revisión '${query.reviewId}' no encontrada en el proyecto '${query.projectId}'`),
        { statusCode: 404 },
      );
    }

    // 2. Evaluar acceso del usuario:
    //    Vía A: solicitante original con membresía activa
    //    Vía B: docente actualmente asignado
    const isRequester = found.requesterId === query.userId;
    let hasAccess = false;

    if (isRequester) {
      const membership = await this.membershipRepository.findByProjectAndUser(
        query.projectId,
        query.userId,
      );
      hasAccess = membership !== null;
    }

    if (!hasAccess) {
      // Verificar asignación docente (también cubre reasignación: solo el nuevo docente tiene acceso)
      hasAccess = await this.teacherScope.isAssigned(query.userId, query.projectId);
    }

    if (!hasAccess) {
      throw Object.assign(
        new Error(
          `Acceso denegado a la revisión '${query.reviewId}' del proyecto '${query.projectId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 3. Derivar historial determinista por sequenceNumber ASC
    const { actions, ...request } = found;
    const timeline = deriveReviewTimeline(request, actions);

    return { request, actions, timeline };
  }
}
