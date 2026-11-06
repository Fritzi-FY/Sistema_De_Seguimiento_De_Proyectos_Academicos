import type {
  ReviewRepositoryPort,
  TeacherReviewRequest,
  TeacherReviewAction,
} from '@is488/shared';
import { assertValidReviewTransition } from '@is488/shared';

/**
 * Adaptador en memoria para la persistencia de revisiones docentes.
 * Implementa ReviewRepositoryPort con serialización de acceso concurrente
 * por revisión mediante encadenamiento de promesas (promise-chain lock).
 *
 * ADVERTENCIA DE PERSISTENCIA VOLÁTIL:
 * Este almacén es estrictamente volátil, diseñado exclusivamente para
 * desarrollo local y pruebas automatizadas (ADR-001, ADR-003).
 *
 * COPIAS DEFENSIVAS:
 * Todos los métodos devuelven copias planas de los objetos almacenados
 * para impedir mutaciones externas del almacenamiento interno.
 *
 * ATOMICIDAD EN MEMORIA:
 * Las mutaciones de estado y de acciones se ejecutan sincrónicamente dentro
 * del bloque protegido por el lock de la revisión, garantizando que no
 * existan estados intermedios visibles desde otras operaciones concurrentes.
 */
export class InMemoryReviewRepository implements ReviewRepositoryPort {
  /** Almacén principal: reviewId → TeacherReviewRequest */
  private readonly requests = new Map<string, TeacherReviewRequest>();

  /** Almacén de acciones: reviewId → TeacherReviewAction[] (ordenadas por sequenceNumber ASC) */
  private readonly actions = new Map<string, TeacherReviewAction[]>();

  /**
   * Cadenas de promesas por reviewId para serializar operaciones concurrentes.
   * El valor almacenado siempre resuelve (nunca rechaza) para no bloquear
   * operaciones posteriores ante fallos previos.
   */
  private readonly locks = new Map<string, Promise<unknown>>();

  /**
   * Serializa la ejecución de `fn` para el `reviewId` dado.
   * Si una operación anterior falla, la siguiente se ejecuta igualmente.
   */
  private withLock<T>(reviewId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(reviewId) ?? Promise.resolve();
    const operation = previous.then(fn);
    // Almacenar versión que nunca rechaza para no bloquear operaciones posteriores
    this.locks.set(
      reviewId,
      operation.catch(() => undefined),
    );
    return operation;
  }

  /**
   * Registra una nueva solicitud de revisión con estado inicial PENDING.
   * Genera id, createdAt y updatedAt en el servidor.
   */
  async createRequest(data: {
    projectId: string;
    requesterId: string;
    title: string;
    description: string;
    evidenceUrl?: string;
  }): Promise<TeacherReviewRequest> {
    const now = new Date().toISOString();
    const request: TeacherReviewRequest = {
      id: crypto.randomUUID(),
      projectId: data.projectId,
      requesterId: data.requesterId,
      title: data.title,
      description: data.description,
      evidenceUrl: data.evidenceUrl,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    };
    this.requests.set(request.id, { ...request });
    this.actions.set(request.id, []);
    return { ...request };
  }

  /**
   * Consulta una solicitud junto con todas sus acciones.
   * Verifica conjuntamente projectId y reviewId.
   * Retorna null si no existe en el proyecto indicado.
   * Devuelve copias para impedir mutaciones externas.
   */
  async findById(
    projectId: string,
    reviewId: string,
  ): Promise<(TeacherReviewRequest & { actions: TeacherReviewAction[] }) | null> {
    const request = this.requests.get(reviewId);
    if (!request || request.projectId !== projectId) return null;
    const actions = (this.actions.get(reviewId) ?? []).map((a) => ({ ...a }));
    return { ...request, actions };
  }

  /**
   * Registra de forma atómica la respuesta docente y transiciona el estado.
   * Serializado por reviewId. Lanza 404 si la revisión no existe en el proyecto.
   * Valida la transición de dominio antes de persistir.
   */
  async recordTeacherResponse(
    projectId: string,
    reviewId: string,
    data: {
      reviewerId: string;
      status: 'CHANGES_REQUESTED' | 'APPROVED';
      observation: string;
    },
  ): Promise<TeacherReviewRequest> {
    return this.withLock(reviewId, async () => {
      const request = this.requests.get(reviewId);
      if (!request || request.projectId !== projectId) {
        throw Object.assign(
          new Error(`Revisión '${reviewId}' no encontrada en el proyecto '${projectId}'`),
          {
            statusCode: 404,
          },
        );
      }

      // Validar transición de dominio: PENDING → APPROVED | CHANGES_REQUESTED por TEACHER_RESPONSE
      assertValidReviewTransition(request.status, data.status, 'TEACHER_RESPONSE', 'teacher');

      const existingActions = this.actions.get(reviewId) ?? [];
      const sequenceNumber = existingActions.length + 1;
      const now = new Date().toISOString();

      const action: TeacherReviewAction = {
        id: crypto.randomUUID(),
        reviewRequestId: reviewId,
        sequenceNumber,
        actorId: data.reviewerId,
        actorRole: 'teacher',
        actionType: 'TEACHER_RESPONSE',
        status: data.status,
        comment: data.observation,
        createdAt: now,
      };

      // Atomicidad en memoria: ambas escrituras en el mismo tick síncrono dentro del lock
      this.actions.set(reviewId, [...existingActions, { ...action }]);
      const updated: TeacherReviewRequest = {
        ...request,
        status: data.status,
        updatedAt: now,
      };
      this.requests.set(reviewId, { ...updated });

      return { ...updated };
    });
  }

  /**
   * Registra de forma atómica la re-solicitud estudiantil y transiciona de CHANGES_REQUESTED a PENDING.
   * Serializado por reviewId. Lanza 409 si el estado actual no es CHANGES_REQUESTED.
   * Lanza 404 si la revisión no existe en el proyecto.
   */
  async recordStudentResubmission(
    projectId: string,
    reviewId: string,
    data: {
      studentId: string;
      description: string;
      evidenceUrl?: string;
    },
  ): Promise<TeacherReviewRequest> {
    return this.withLock(reviewId, async () => {
      const request = this.requests.get(reviewId);
      if (!request || request.projectId !== projectId) {
        throw Object.assign(
          new Error(`Revisión '${reviewId}' no encontrada en el proyecto '${projectId}'`),
          { statusCode: 404 },
        );
      }

      // Control de concurrencia: si el estado ya fue cambiado por otra operación concurrente → 409
      if (request.status !== 'CHANGES_REQUESTED') {
        throw Object.assign(
          new Error(
            `Estado actual '${request.status}' no permite re-solicitar evaluación. Se esperaba 'CHANGES_REQUESTED'.`,
          ),
          { statusCode: 409 },
        );
      }

      const existingActions = this.actions.get(reviewId) ?? [];
      const sequenceNumber = existingActions.length + 1;
      const now = new Date().toISOString();

      const action: TeacherReviewAction = {
        id: crypto.randomUUID(),
        reviewRequestId: reviewId,
        sequenceNumber,
        actorId: data.studentId,
        actorRole: 'student',
        actionType: 'STUDENT_RESUBMISSION',
        status: 'PENDING',
        comment: data.description,
        evidenceUrl: data.evidenceUrl,
        createdAt: now,
      };

      // Atomicidad en memoria: ambas escrituras en el mismo tick síncrono dentro del lock
      this.actions.set(reviewId, [...existingActions, { ...action }]);
      const updated: TeacherReviewRequest = {
        ...request,
        status: 'PENDING',
        updatedAt: now,
      };
      this.requests.set(reviewId, { ...updated });

      return { ...updated };
    });
  }

  /**
   * Limpia todos los registros en memoria. Utilidad para pruebas unitarias.
   */
  clear(): void {
    this.requests.clear();
    this.actions.clear();
    this.locks.clear();
  }
}
