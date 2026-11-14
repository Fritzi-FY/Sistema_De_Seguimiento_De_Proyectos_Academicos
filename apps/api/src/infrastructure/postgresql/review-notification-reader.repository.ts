import {
  ReviewNotificationItemSchema,
  ReviewNotificationReadError,
  type ReviewNotificationListItem,
  type ReviewNotificationReaderPort,
  type ReviewNotificationReadQuery,
} from '@is488/shared';
import { currentSqlSession, type SqlSession } from './session.js';

export class PostgresqlReviewNotificationReader implements ReviewNotificationReaderPort {
  constructor(private readonly session: () => SqlSession = currentSqlSession) {}

  async listAuthorizedForStudent(
    query: ReviewNotificationReadQuery,
  ): Promise<ReviewNotificationListItem[]> {
    try {
      const result = await this.session().query(
        `SELECT n.id, n.project_id AS "projectId", n.review_id AS "reviewId",
          n.response_action_id AS "responseActionId", n.response_status AS status,
          to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt"
         FROM public.internal_notifications n
         JOIN public.teacher_review_requests r
           ON r.id = n.review_id AND r.project_id = n.project_id
           AND r.requester_id = n.recipient_user_id
         WHERE n.recipient_user_id = $1 AND n.kind = 'TEACHER_REVIEW_COMPLETED'
           AND EXISTS (SELECT 1 FROM public.project_memberships m
             WHERE m.project_id = n.project_id AND m.user_id = $1 AND m.status = 'active')
           ${query.before ? 'AND (n.created_at, n.id) < ($2::timestamptz, $3::uuid)' : ''}
         ORDER BY n.created_at DESC, n.id DESC LIMIT $${query.before ? 4 : 2}`,
        query.before
          ? [query.studentId, query.before.createdAt, query.before.id, query.take]
          : [query.studentId, query.take],
      );
      return ReviewNotificationItemSchema.array().parse(result.rows);
    } catch {
      throw new ReviewNotificationReadError();
    }
  }
}
