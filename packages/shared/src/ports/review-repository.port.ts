/**
 * Entidades, tipos, reglas de transición y puerto del dominio para el flujo de revisión docente (IS488).
 * Núcleo de dominio puro en arquitectura hexagonal: independiente de frameworks, Zod y almacenamiento.
 */

export type ReviewStatus = 'PENDING' | 'CHANGES_REQUESTED' | 'APPROVED';

export type ReviewActionType = 'TEACHER_RESPONSE' | 'STUDENT_RESUBMISSION';

export type ReviewActorRole = 'student' | 'teacher';

/**
 * Entidad de dominio representativa de una Solicitud de Revisión Docente a nivel de proyecto.
 */
export interface TeacherReviewRequest {
  /** UUID v4 identificador de la solicitud. */
  id: string;
  /** UUID del proyecto académico. */
  projectId: string;
  /** Identificador del estudiante que formuló la solicitud. */
  requesterId: string;
  /** Título sintético de la solicitud (3 a 120 caracteres). */
  title: string;
  /** Descripción del avance realizado (10 a 2000 caracteres). */
  description: string;
  /** Enlace opcional a repositorio o evidencia externa (máx. 500 caracteres, ADR-006). */
  evidenceUrl?: string;
  /** Estado actual de la revisión en la máquina de estados. */
  status: ReviewStatus;
  /** Marca de tiempo ISO-8601 UTC de creación. */
  createdAt: string;
  /** Marca de tiempo ISO-8601 UTC de última actualización. */
  updatedAt: string;
}

/**
 * Registro inmutable de una acción dentro del ciclo de la revisión (respuesta docente o re-solicitud estudiantil).
 */
export interface TeacherReviewAction {
  /** UUID v4 de la acción. */
  id: string;
  /** UUID de la solicitud de revisión a la que pertenece. */
  reviewRequestId: string;
  /** Número de secuencia monotónico per-revisión (inicia en 1). */
  sequenceNumber: number;
  /** Identificador del usuario que ejecutó la acción. */
  actorId: string;
  /** Rol del actor en el contexto de la acción. */
  actorRole: ReviewActorRole;
  /** Tipo de acción ejecutada. */
  actionType: ReviewActionType;
  /** Estado resultante de la revisión tras la acción. */
  status: ReviewStatus;
  /** Observación del docente o descripción de ajustes del estudiante (5 a 2000 caracteres). */
  comment: string;
  /** Enlace opcional de evidencia actualizado (para re-solicitudes estudiantiles). */
  evidenceUrl?: string;
  /** Marca de tiempo ISO-8601 UTC en que se registró la acción. */
  createdAt: string;
}

/**
 * Entrada proyectada en el historial cronológico determinista de una revisión.
 */
export interface ReviewTimelineEntry {
  /** Número de secuencia (0 para la incepción inicial; 1..N para acciones subsecuentes). */
  sequenceNumber: number;
  /** Tipo de hito en la línea de tiempo. */
  actionType: 'INITIAL_REQUEST' | ReviewActionType;
  /** Identificador del actor responsable del hito. */
  actorId: string;
  /** Rol del actor responsable. */
  actorRole: ReviewActorRole;
  /** Estado asociado al hito. */
  status: ReviewStatus;
  /** Descripción del avance, observación docente o detalle de ajustes. */
  comment: string;
  /** Enlace opcional a evidencia. */
  evidenceUrl?: string;
  /** Marca de tiempo ISO-8601 UTC del hito. */
  createdAt: string;
}

/**
 * Error de dominio lanzado ante intentos de transición de estado no permitidos.
 */
export class InvalidReviewTransitionError extends Error {
  constructor(
    readonly currentStatus: ReviewStatus,
    readonly targetStatus: ReviewStatus,
    readonly actionType: ReviewActionType,
    readonly actorRole: ReviewActorRole,
    message?: string,
  ) {
    super(
      message ??
        `Transición no permitida: de '${currentStatus}' a '${targetStatus}' mediante '${actionType}' por rol '${actorRole}'.`,
    );
    this.name = 'InvalidReviewTransitionError';
  }
}

/**
 * Valida si una transición de estado de revisión es permitida por la máquina de estados del dominio.
 *
 * Reglas de transición aprobadas:
 * - PENDING ➔ CHANGES_REQUESTED: permitido únicamente para TEACHER_RESPONSE por rol 'teacher'.
 * - PENDING ➔ APPROVED: permitido únicamente para TEACHER_RESPONSE por rol 'teacher'.
 * - CHANGES_REQUESTED ➔ PENDING: permitido únicamente para STUDENT_RESUBMISSION por rol 'student'.
 * - APPROVED es terminal: no admite transiciones adicionales.
 * - Cualquier otra transición es inválida.
 */
export function canTransitionReview(
  currentStatus: ReviewStatus,
  targetStatus: ReviewStatus,
  actionType: ReviewActionType,
  actorRole: ReviewActorRole,
): boolean {
  if (actorRole === 'teacher' && actionType === 'TEACHER_RESPONSE') {
    if (currentStatus === 'PENDING') {
      return targetStatus === 'CHANGES_REQUESTED' || targetStatus === 'APPROVED';
    }
    return false;
  }

  if (actorRole === 'student' && actionType === 'STUDENT_RESUBMISSION') {
    if (currentStatus === 'CHANGES_REQUESTED') {
      return targetStatus === 'PENDING';
    }
    return false;
  }

  return false;
}

/**
 * Asegura que una transición sea válida, lanzando InvalidReviewTransitionError si no lo es.
 */
export function assertValidReviewTransition(
  currentStatus: ReviewStatus,
  targetStatus: ReviewStatus,
  actionType: ReviewActionType,
  actorRole: ReviewActorRole,
): void {
  if (!canTransitionReview(currentStatus, targetStatus, actionType, actorRole)) {
    throw new InvalidReviewTransitionError(currentStatus, targetStatus, actionType, actorRole);
  }
}

/**
 * Deriva de forma determinista el historial cronológico completo a partir de la solicitud original
 * y sus acciones persistidas, ordenando estrictamente por sequenceNumber ascendente.
 */
export function deriveReviewTimeline(
  request: TeacherReviewRequest,
  actions: readonly TeacherReviewAction[],
): ReviewTimelineEntry[] {
  const initialEntry: ReviewTimelineEntry = {
    sequenceNumber: 0,
    actionType: 'INITIAL_REQUEST',
    actorId: request.requesterId,
    actorRole: 'student',
    status: 'PENDING',
    comment: request.description,
    evidenceUrl: request.evidenceUrl,
    createdAt: request.createdAt,
  };

  const sortedActions = [...actions].sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  const actionEntries: ReviewTimelineEntry[] = sortedActions.map((action) => ({
    sequenceNumber: action.sequenceNumber,
    actionType: action.actionType,
    actorId: action.actorId,
    actorRole: action.actorRole,
    status: action.status,
    comment: action.comment,
    evidenceUrl: action.evidenceUrl,
    createdAt: action.createdAt,
  }));

  return [initialEntry, ...actionEntries];
}

/**
 * Puerto secundario (driven) para la persistencia y consulta de revisiones docentes en arquitectura hexagonal.
 */
export interface ReviewRepositoryPort {
  /**
   * Registra una nueva solicitud de revisión a nivel de proyecto con estado inicial PENDING.
   */
  createRequest(data: {
    projectId: string;
    requesterId: string;
    title: string;
    description: string;
    evidenceUrl?: string;
  }): Promise<TeacherReviewRequest>;

  /**
   * Consulta una solicitud de revisión junto con todas sus acciones asociadas.
   * Retorna null si no existe en el proyecto indicado.
   */
  findById(
    projectId: string,
    reviewId: string,
  ): Promise<(TeacherReviewRequest & { actions: TeacherReviewAction[] }) | null>;

  /**
   * Registra de forma atómica la respuesta docente y transiciona el estado de la solicitud.
   */
  recordTeacherResponse(
    projectId: string,
    reviewId: string,
    data: {
      reviewerId: string;
      status: 'CHANGES_REQUESTED' | 'APPROVED';
      observation: string;
    },
  ): Promise<TeacherReviewRequest>;

  /**
   * Registra de forma atómica la re-solicitud estudiantil y transiciona el estado de CHANGES_REQUESTED a PENDING.
   */
  recordStudentResubmission(
    projectId: string,
    reviewId: string,
    data: {
      studentId: string;
      description: string;
      evidenceUrl?: string;
    },
  ): Promise<TeacherReviewRequest>;
}
