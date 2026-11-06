import type {
  MembershipRepositoryPort,
  ReviewRepositoryPort,
  TeacherReviewRequest,
} from '@is488/shared';

export interface ResubmitTeacherReviewCommand {
  /** UUID del proyecto al que pertenece la revisión. */
  projectId: string;
  /** UUID de la solicitud de revisión a re-someter. */
  reviewId: string;
  /** ID del estudiante que re-solicita (obtenido del contexto autenticado). */
  studentId: string;
  /** Descripción de los ajustes realizados (10–2000 caracteres). */
  description: string;
  /** Enlace opcional actualizado de evidencia (máx. 500 caracteres, ADR-006). */
  evidenceUrl?: string;
}

/**
 * Caso de uso: El solicitante activo re-solicita evaluación tras CHANGES_REQUESTED.
 *
 * Reglas de autorización:
 * - Solo el solicitante original (review.requesterId === studentId) puede re-solicitar.
 *   Cualquier otro usuario recibe 404 Not Found.
 * - El solicitante debe mantener membresía activa en el proyecto.
 *   Si fue retirado → 404 Not Found.
 * - La revisión debe existir en el proyecto indicado (projectId + reviewId juntos) → 404.
 * - La re-solicitud se opera sobre la misma revisión; no crea una nueva.
 * - El estado actual debe ser CHANGES_REQUESTED → 409 Conflict si ya fue cambiado
 *   (protección ante concurrencia: otra operación pudo haber cambiado el estado).
 * - Estado (PENDING), acción (STUDENT_RESUBMISSION) y sequenceNumber se actualizan
 *   atómicamente en el repositorio.
 * - Los campos de identidad, fecha y secuencia son determinados por el servidor.
 */
export class ResubmitTeacherReviewUseCase {
  constructor(
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly reviewRepository: ReviewRepositoryPort,
  ) {}

  async execute(command: ResubmitTeacherReviewCommand): Promise<TeacherReviewRequest> {
    // 1. Verificar que la revisión existe en el proyecto (projectId + reviewId conjuntos)
    const found = await this.reviewRepository.findById(command.projectId, command.reviewId);
    if (!found) {
      throw Object.assign(
        new Error(
          `Revisión '${command.reviewId}' no encontrada en el proyecto '${command.projectId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 2. Verificar que el solicitante es el creador original de la revisión
    if (found.requesterId !== command.studentId) {
      throw Object.assign(
        new Error(
          `Solo el solicitante original puede re-someter la revisión '${command.reviewId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 3. Verificar membresía activa del solicitante en el proyecto
    const membership = await this.membershipRepository.findByProjectAndUser(
      command.projectId,
      command.studentId,
    );
    if (!membership) {
      throw Object.assign(
        new Error(
          `El usuario '${command.studentId}' no tiene membresía activa en el proyecto '${command.projectId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 4. Registrar re-solicitud atómica en repositorio.
    //    El repo lanza 409 si el estado ya no es CHANGES_REQUESTED (control de concurrencia).
    return this.reviewRepository.recordStudentResubmission(command.projectId, command.reviewId, {
      studentId: command.studentId,
      description: command.description,
      evidenceUrl: command.evidenceUrl,
    });
  }
}
