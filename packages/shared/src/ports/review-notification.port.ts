/**
 * Carga de datos transmitida al emitir la notificación de conclusión de revisión docente.
 */
export interface ReviewNotificationPayload {
  /** UUID del proyecto académico evaluado. */
  projectId: string;
  /** UUID de la solicitud de revisión evaluada. */
  reviewId: string;
  /** Identificador del docente evaluador. */
  reviewerId: string;
  /** Estado de dictamen emitido. Solo se notifica cuando el docente concluye una revisión. */
  status: 'APPROVED' | 'CHANGES_REQUESTED';
  /** Lista de identificadores de miembros activos del proyecto que deben ser notificados. */
  recipientUserIds: readonly string[];
}

/**
 * Puerto driven en arquitectura hexagonal para la emisión desacoplada de notificaciones de revisión.
 *
 * En EPIC-006 se valida mediante dobles de prueba (NotificationTestSpy) que la emisión contractual ocurre.
 * La entrega efectiva al usuario final conforme a configuración depende de EPIC-007 (audit-reports-notifications).
 */
export interface ReviewNotificationPort {
  notifyReviewCompleted(payload: ReviewNotificationPayload): Promise<void>;
}
