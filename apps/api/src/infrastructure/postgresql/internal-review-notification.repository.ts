import {
  ReviewNotificationStorageError,
  type InternalReviewNotificationInput,
  type InternalReviewNotificationStorePort,
  type ReviewNotificationContext,
  type ReviewNotificationContextPort,
  type ReviewNotificationPayload,
} from '@is488/shared';
import { PostgresqlReviewRepository } from './review.repository.js';
import { currentSqlSession, PersistenceTransactionError, type SqlSession } from './session.js';

export type NotificationFaultStage = 'after_authorization' | 'after_insert';

export class PostgresqlInternalReviewNotificationRepository
  implements ReviewNotificationContextPort, InternalReviewNotificationStorePort
{
  private uncertain = false;

  constructor(
    private readonly session: () => SqlSession = currentSqlSession,
    private readonly fault?: (stage: NotificationFaultStage) => Promise<void>,
  ) {}

  async resolve(payload: ReviewNotificationPayload): Promise<ReviewNotificationContext | null> {
    if (this.uncertain) throw new ReviewNotificationStorageError('unknown');
    const review = await new PostgresqlReviewRepository(this.session).findById(
      payload.projectId,
      payload.reviewId,
    );
    const action = review?.actions.find((entry) => entry.id === payload.responseActionId);
    if (!review || !action) return null;
    const membership = await this.session().query(
      `SELECT id FROM public.project_memberships
       WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
      [review.projectId, review.requesterId],
    );
    const active = membership.rows.length === 1;
    return {
      review,
      action,
      requesterHasActiveMembership: active,
      requesterCanQueryReview: active,
    };
  }

  async persistAuthorized(input: InternalReviewNotificationInput): Promise<void> {
    if (this.uncertain) throw new ReviewNotificationStorageError('unknown');
    const session = this.session();
    try {
      await session.transaction(async () => {
        const source = await session.query(
          `SELECT a.id FROM public.teacher_review_actions a
           JOIN public.teacher_review_requests r ON r.id = a.review_request_id
           JOIN public.project_memberships m ON m.project_id = r.project_id AND m.user_id = r.requester_id
           WHERE a.id = $1 AND r.id = $2 AND r.project_id = $3 AND r.requester_id = $4
             AND a.actor_id = $5 AND a.status = $6 AND a.actor_role = 'teacher'
             AND a.action_type = 'TEACHER_RESPONSE' AND a.status IN ('APPROVED','CHANGES_REQUESTED')
             AND m.status = 'active'
           FOR SHARE OF m`,
          [
            input.responseActionId,
            input.reviewId,
            input.projectId,
            input.recipientUserId,
            input.reviewerId,
            input.status,
          ],
        );
        if (source.rows.length !== 1)
          throw new Error('Notification source or recipient unauthorized');
        await this.fault?.('after_authorization');
        await session.query(
          `INSERT INTO public.internal_notifications
           (response_action_id, recipient_user_id, project_id, review_id, reviewer_id, response_status)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT ON CONSTRAINT internal_notification_response_recipient DO NOTHING`,
          [
            input.responseActionId,
            input.recipientUserId,
            input.projectId,
            input.reviewId,
            input.reviewerId,
            input.status,
          ],
        );
        await this.fault?.('after_insert');
      });
    } catch (error) {
      const outcome = error instanceof PersistenceTransactionError ? error.outcome : 'unknown';
      if (outcome === 'unknown') this.uncertain = true;
      throw new ReviewNotificationStorageError(outcome);
    }
  }
}
