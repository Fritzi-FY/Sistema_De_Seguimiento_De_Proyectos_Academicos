import type {
  TeacherProjectScopePort,
  MembershipRepositoryPort,
  ReviewRepositoryPort,
  ReviewNotificationPort,
  TeacherReviewRequest,
} from '@is488/shared';

export interface RespondTeacherReviewCommand {
  /** UUID del proyecto al que pertenece la revisión. */
  projectId: string;
  /** UUID de la solicitud de revisión a responder. */
  reviewId: string;
  /** Contexto de identidad autenticado del docente (obtenido del servidor). */
  user: {
    userId: string;
    role: string;
  };
  /** Estado del dictamen emitido. */
  status: 'APPROVED' | 'CHANGES_REQUESTED';
  /** Observaciones del docente (5–2000 caracteres). */
  observation: string;
}

/**
 * Caso de uso: El docente asignado responde una solicitud de revisión.
 *
 * Reglas de autorización:
 * - El rol del usuario debe ser estrictamente 'teacher' (403 Forbidden si no).
 * - Solo el docente actualmente asignado al proyecto puede responder (TeacherProjectScopePort).
 *   Si no está asignado → 404 Not Found.
 * - El estado objetivo debe ser APPROVED o CHANGES_REQUESTED (PENDING no es una opción docente).
 * - La revisión debe existir en el proyecto indicado → 404 si no.
 * - La transición de estado se valida en la capa de dominio (assertValidReviewTransition).
 * - Estado, acción y secuencia se actualizan atómicamente en el repositorio.
 *   Si la persistencia falla, el error se propaga íntegramente y no se intenta notificar.
 *
 * Notificación y Resiliencia:
 * - Las operaciones posteriores al guardado (consulta de membresía del destinatario y envío)
 *   se ejecutan dentro de un bloque protegido.
 * - Si cualquiera de estas operaciones falla:
 *   1. El caso de uso devuelve la revisión guardada exitosamente (HTTP 200).
 *   2. Se registra un diagnóstico seguro mediante console.error (JSON estructurado)
 *      sin incluir observaciones, enlaces ni datos sensibles.
 *   3. Se evita enviar cuando no se pueda confirmar el permiso del destinatario.
 * - Los destinatarios se restringen exclusivamente al solicitante original de la revisión
 *   siempre que mantenga membresía activa (status: 'active') y permiso de consulta.
 * - Este bloque no garantiza entrega efectiva ni reintentos de notificaciones,
 *   responsabilidades diferidas a EPIC-007 (audit-reports-notifications).
 */
export class RespondTeacherReviewUseCase {
  constructor(
    private readonly teacherScope: TeacherProjectScopePort,
    private readonly membershipRepository: MembershipRepositoryPort,
    private readonly reviewRepository: ReviewRepositoryPort,
    private readonly notificationPort: ReviewNotificationPort,
  ) {}

  async execute(command: RespondTeacherReviewCommand): Promise<TeacherReviewRequest> {
    // 1. Verificar rol docente confiable desde el contexto de identidad
    if (command.user.role !== 'teacher') {
      throw Object.assign(
        new Error('Solo los usuarios con rol docente pueden responder solicitudes de revisión'),
        { statusCode: 403 },
      );
    }

    // 2. Verificar que el docente está asignado actualmente al proyecto
    const isAssigned = await this.teacherScope.isAssigned(command.user.userId, command.projectId);
    if (!isAssigned) {
      throw Object.assign(
        new Error(
          `El docente '${command.user.userId}' no está asignado al proyecto '${command.projectId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 3. Verificar que la revisión existe en el proyecto
    const found = await this.reviewRepository.findById(command.projectId, command.reviewId);
    if (!found) {
      throw Object.assign(
        new Error(
          `Revisión '${command.reviewId}' no encontrada en el proyecto '${command.projectId}'`,
        ),
        { statusCode: 404 },
      );
    }

    // 4. Registrar respuesta atómica (valida transición en el repo).
    //    Persistencia FUERA del try/catch de notificación: si falla, se propaga directamente
    //    sin intentar notificar ni capturar el error.
    const updated = await this.reviewRepository.recordTeacherResponse(
      command.projectId,
      command.reviewId,
      {
        reviewerId: command.user.userId,
        status: command.status,
        observation: command.observation,
      },
    );

    // 5. Manejo protegido de consulta de destinatario y notificación post-guardado:
    //    Si falla la consulta de membresía o el envío, se devuelve la revisión guardada,
    //    se registra diagnóstico seguro y se evita enviar si no se confirmó el permiso.
    try {
      const requesterMembership = await this.membershipRepository.findByProjectAndUser(
        command.projectId,
        found.requesterId,
      );
      if (requesterMembership && requesterMembership.status === 'active') {
        await this.notificationPort.notifyReviewCompleted({
          projectId: command.projectId,
          reviewId: command.reviewId,
          reviewerId: command.user.userId,
          status: command.status,
          recipientUserIds: [found.requesterId],
        });
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          stage: 'review-notification',
          outcome: 'failed',
          projectId: command.projectId,
          reviewId: command.reviewId,
          error: error instanceof Error ? error.name : 'UnknownError',
        }),
      );
    }

    return updated;
  }
}
