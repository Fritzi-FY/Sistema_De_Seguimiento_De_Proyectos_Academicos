import type {
  ReviewRepositoryPort,
  TeacherReviewRequest,
  TeacherReviewAction,
  ReviewStatus,
  ReviewActorRole,
  ReviewActionType,
} from '@is488/shared';
import { assertValidReviewTransition, InvalidReviewTransitionError } from '@is488/shared';
import { currentSqlSession, PersistenceTransactionError, type SqlSession } from './session.js';

const isUuid = (id: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

interface ReviewRequestRow {
  id: string;
  project_id: string;
  requester_id: string;
  title: string;
  description: string;
  evidence_url: string | null;
  status: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ReviewActionRow {
  id: string;
  review_request_id: string;
  sequence_number: number | string;
  actor_id: string;
  actor_role: string;
  action_type: string;
  status: string;
  comment: string;
  evidence_url: string | null;
  created_at: Date | string;
}

function mapRequest(row: ReviewRequestRow): TeacherReviewRequest {
  const createdAtIso =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();
  const updatedAtIso =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();

  const req: TeacherReviewRequest = {
    id: row.id,
    projectId: row.project_id,
    requesterId: row.requester_id,
    title: row.title,
    description: row.description,
    status: row.status as ReviewStatus,
    createdAt: createdAtIso,
    updatedAt: updatedAtIso,
  };

  if (row.evidence_url !== null && row.evidence_url !== undefined) {
    req.evidenceUrl = row.evidence_url;
  }

  return req;
}

function mapAction(row: ReviewActionRow): TeacherReviewAction {
  const createdAtIso =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();

  const act: TeacherReviewAction = {
    id: row.id,
    reviewRequestId: row.review_request_id,
    sequenceNumber: Number(row.sequence_number),
    actorId: row.actor_id,
    actorRole: row.actor_role as ReviewActorRole,
    actionType: row.action_type as ReviewActionType,
    status: row.status as ReviewStatus,
    comment: row.comment,
    createdAt: createdAtIso,
  };

  if (row.evidence_url !== null && row.evidence_url !== undefined) {
    act.evidenceUrl = row.evidence_url;
  }

  return act;
}

export type ReviewFaultStage = 'before_action' | 'during_action' | 'after_action';

/**
 * Adaptador de persistencia relacional PostgreSQL para revisiones docentes.
 * Implementa ReviewRepositoryPort con transacciones atómicas (SqlSession.transaction),
 * bloqueo pesimista de fila (FOR UPDATE) y consultas parametrizadas aisladas
 * estrictamente por el par compuesto (projectId, reviewId).
 */
export class PostgresqlReviewRepository implements ReviewRepositoryPort {
  constructor(
    private readonly session: () => SqlSession = currentSqlSession,
    private readonly fault?: (stage: ReviewFaultStage) => Promise<void>,
  ) {}

  /**
   * Registra una nueva solicitud de revisión a nivel de proyecto con estado PENDING.
   * La descripción original y el enlace a evidencia se conservan intactos.
   */
  async createRequest(data: {
    projectId: string;
    requesterId: string;
    title: string;
    description: string;
    evidenceUrl?: string;
  }): Promise<TeacherReviewRequest> {
    if (!isUuid(data.projectId)) {
      throw Object.assign(
        new Error(`Identificador de proyecto '${data.projectId}' no es un UUID válido`),
        {
          statusCode: 400,
        },
      );
    }

    const session = this.session();
    const id = crypto.randomUUID();

    const result = await session.query<ReviewRequestRow>(
      `INSERT INTO public.teacher_review_requests (
        id, project_id, requester_id, title, description, evidence_url, status
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
      RETURNING id, project_id, requester_id, title, description, evidence_url, status, created_at, updated_at`,
      [
        id,
        data.projectId,
        data.requesterId,
        data.title,
        data.description,
        data.evidenceUrl ?? null,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error(
        'Fallo inesperado al insertar la solicitud de revisión: no se devolvieron filas',
      );
    }

    return mapRequest(row);
  }

  /**
   * Consulta una solicitud de revisión junto con todas sus acciones asociadas
   * desde una única vista atómica y consistente de PostgreSQL (single-query snapshot).
   * Al ejecutarse en una sola sentencia SQL con subconsulta agregada, PostgreSQL
   * garantiza un único snapshot MVCC, imposibilitando inconsistencias temporales
   * entre la solicitud y sus acciones.
   * Comprueba conjuntamente projectId y reviewId para garantizar aislamiento estricto.
   * Las acciones se ordenan deterministamente por sequence_number ASC.
   * Devuelve representaciones y copias independientes para evitar mutaciones externas.
   */
  async findById(
    projectId: string,
    reviewId: string,
  ): Promise<(TeacherReviewRequest & { actions: TeacherReviewAction[] }) | null> {
    if (!isUuid(projectId) || !isUuid(reviewId)) return null;

    const session = this.session();
    return session.transaction(async () => {
      const result = await session.query<
        ReviewRequestRow & { actions: ReviewActionRow[] | string }
      >(
        `SELECT
          r.id,
          r.project_id,
          r.requester_id,
          r.title,
          r.description,
          r.evidence_url,
          r.status,
          r.created_at,
          r.updated_at,
          COALESCE(
            (
              SELECT json_agg(
                json_build_object(
                  'id', a.id,
                  'review_request_id', a.review_request_id,
                  'sequence_number', a.sequence_number,
                  'actor_id', a.actor_id,
                  'actor_role', a.actor_role,
                  'action_type', a.action_type,
                  'status', a.status,
                  'comment', a.comment,
                  'evidence_url', a.evidence_url,
                  'created_at', a.created_at
                ) ORDER BY a.sequence_number ASC
              )
              FROM public.teacher_review_actions a
              WHERE a.review_request_id = r.id
            ),
            '[]'::json
          ) AS actions
         FROM public.teacher_review_requests r
         WHERE r.id = $1 AND r.project_id = $2`,
        [reviewId, projectId],
      );

      const row = result.rows[0];
      if (!row) return null;

      const rawActions =
        typeof row.actions === 'string'
          ? (JSON.parse(row.actions) as ReviewActionRow[])
          : row.actions;

      return {
        ...mapRequest(row),
        actions: Array.isArray(rawActions) ? rawActions.map(mapAction) : [],
      };
    });
  }

  /**
   * Registra atómicamente la respuesta docente y transiciona el estado de la solicitud.
   * Adquiere bloqueo pesimista FOR UPDATE sobre la fila de la solicitud y verifica
   * el estado actual después de adquirir el bloqueo para serializar operaciones concurrentes.
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
    if (!isUuid(projectId) || !isUuid(reviewId)) {
      throw Object.assign(
        new Error(`Revisión '${reviewId}' no encontrada en el proyecto '${projectId}'`),
        { statusCode: 404 },
      );
    }

    const session = this.session();
    let domainError: unknown;

    try {
      return await session.transaction(async () => {
        try {
          // Bloqueo pesimista de la fila de la solicitud
          const lockResult = await session.query<ReviewRequestRow>(
            `SELECT id, project_id, requester_id, title, description, evidence_url, status, created_at, updated_at
             FROM public.teacher_review_requests
             WHERE id = $1 AND project_id = $2
             FOR UPDATE`,
            [reviewId, projectId],
          );

          const currentRequestRow = lockResult.rows[0];
          if (!currentRequestRow) {
            throw Object.assign(
              new Error(`Revisión '${reviewId}' no encontrada en el proyecto '${projectId}'`),
              { statusCode: 404 },
            );
          }

          const currentStatus = currentRequestRow.status as ReviewStatus;

          // Verificación de estado tras adquirir el bloqueo
          if (currentStatus !== 'PENDING') {
            throw Object.assign(
              new InvalidReviewTransitionError(
                currentStatus,
                data.status,
                'TEACHER_RESPONSE',
                'teacher',
                `Estado actual '${currentStatus}' no permite responder la revisión. Se esperaba 'PENDING'.`,
              ),
              { statusCode: 409 },
            );
          }

          assertValidReviewTransition(currentStatus, data.status, 'TEACHER_RESPONSE', 'teacher');

          // Asignación de secuencia monotónica
          const seqResult = await session.query<{ next_seq: string | number }>(
            `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
             FROM public.teacher_review_actions
             WHERE review_request_id = $1`,
            [reviewId],
          );
          const nextSeq = Number(seqResult.rows[0]?.next_seq ?? 1);

          if (this.fault) {
            await this.fault('during_action');
          }

          // Inserción de la acción inmutable
          const actionId = crypto.randomUUID();
          await session.query(
            `INSERT INTO public.teacher_review_actions (
              id, review_request_id, sequence_number, actor_id, actor_role,
              action_type, status, comment, evidence_url, created_at
            ) VALUES ($1, $2, $3, $4, 'teacher', 'TEACHER_RESPONSE', $5, $6, null, clock_timestamp())`,
            [actionId, reviewId, nextSeq, data.reviewerId, data.status, data.observation],
          );

          // Actualización de estado en la solicitud
          const updateResult = await session.query<ReviewRequestRow>(
            `UPDATE public.teacher_review_requests
             SET status = $1, updated_at = clock_timestamp()
             WHERE id = $2 AND project_id = $3
             RETURNING id, project_id, requester_id, title, description, evidence_url, status, created_at, updated_at`,
            [data.status, reviewId, projectId],
          );

          const updatedRow = updateResult.rows[0];
          if (!updatedRow) {
            throw new Error(
              'Fallo inesperado al actualizar la solicitud de revisión: no se devolvieron filas',
            );
          }

          return mapRequest(updatedRow);
        } catch (error) {
          domainError = error;
          throw error;
        }
      });
    } catch (error) {
      if (
        error instanceof PersistenceTransactionError &&
        error.outcome === 'rolled_back' &&
        domainError !== undefined
      ) {
        throw domainError;
      }
      throw error;
    }
  }

  /**
   * Registra atómicamente la re-solicitud estudiantil tras CHANGES_REQUESTED.
   * Adquiere bloqueo pesimista FOR UPDATE sobre la fila de la solicitud y verifica
   * que el estado sea CHANGES_REQUESTED tras adquirir el bloqueo para serializar concurrencia.
   * Si otra operación concurrente ya modificó el estado, rechaza con HTTP 409 Conflict.
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
    if (!isUuid(projectId) || !isUuid(reviewId)) {
      throw Object.assign(
        new Error(`Revisión '${reviewId}' no encontrada en el proyecto '${projectId}'`),
        { statusCode: 404 },
      );
    }

    const session = this.session();
    let domainError: unknown;

    try {
      return await session.transaction(async () => {
        try {
          // Bloqueo pesimista de la fila de la solicitud
          const lockResult = await session.query<ReviewRequestRow>(
            `SELECT id, project_id, requester_id, title, description, evidence_url, status, created_at, updated_at
             FROM public.teacher_review_requests
             WHERE id = $1 AND project_id = $2
             FOR UPDATE`,
            [reviewId, projectId],
          );

          const currentRequestRow = lockResult.rows[0];
          if (!currentRequestRow) {
            throw Object.assign(
              new Error(`Revisión '${reviewId}' no encontrada en el proyecto '${projectId}'`),
              { statusCode: 404 },
            );
          }

          const currentStatus = currentRequestRow.status as ReviewStatus;

          // Verificación de estado tras adquirir el bloqueo: debe ser CHANGES_REQUESTED
          if (currentStatus !== 'CHANGES_REQUESTED') {
            throw Object.assign(
              new Error(
                `Estado actual '${currentStatus}' no permite re-solicitar evaluación. Se esperaba 'CHANGES_REQUESTED'.`,
              ),
              { statusCode: 409 },
            );
          }

          assertValidReviewTransition(currentStatus, 'PENDING', 'STUDENT_RESUBMISSION', 'student');

          // Asignación de secuencia monotónica
          const seqResult = await session.query<{ next_seq: string | number }>(
            `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
             FROM public.teacher_review_actions
             WHERE review_request_id = $1`,
            [reviewId],
          );
          const nextSeq = Number(seqResult.rows[0]?.next_seq ?? 1);

          if (this.fault) {
            await this.fault('during_action');
          }

          // Inserción de la acción inmutable
          const actionId = crypto.randomUUID();
          await session.query(
            `INSERT INTO public.teacher_review_actions (
              id, review_request_id, sequence_number, actor_id, actor_role,
              action_type, status, comment, evidence_url, created_at
            ) VALUES ($1, $2, $3, $4, 'student', 'STUDENT_RESUBMISSION', 'PENDING', $5, $6, clock_timestamp())`,
            [
              actionId,
              reviewId,
              nextSeq,
              data.studentId,
              data.description,
              data.evidenceUrl ?? null,
            ],
          );

          // Actualización de estado en la solicitud a PENDING
          const updateResult = await session.query<ReviewRequestRow>(
            `UPDATE public.teacher_review_requests
             SET status = 'PENDING', updated_at = clock_timestamp()
             WHERE id = $1 AND project_id = $2
             RETURNING id, project_id, requester_id, title, description, evidence_url, status, created_at, updated_at`,
            [reviewId, projectId],
          );

          const updatedRow = updateResult.rows[0];
          if (!updatedRow) {
            throw new Error(
              'Fallo inesperado al actualizar la solicitud de revisión: no se devolvieron filas',
            );
          }

          return mapRequest(updatedRow);
        } catch (error) {
          domainError = error;
          throw error;
        }
      });
    } catch (error) {
      if (
        error instanceof PersistenceTransactionError &&
        error.outcome === 'rolled_back' &&
        domainError !== undefined
      ) {
        throw domainError;
      }
      throw error;
    }
  }
}
