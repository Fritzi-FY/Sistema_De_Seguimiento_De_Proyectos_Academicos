import {
  isAuthorizedReviewNotification,
  type InternalReviewNotificationStorePort,
  type ReviewNotificationContextPort,
  type ReviewNotificationPayload,
  type ReviewNotificationPort,
} from '@is488/shared';

export class PersistReviewNotificationUseCase implements ReviewNotificationPort {
  constructor(
    private readonly context: ReviewNotificationContextPort,
    private readonly store: InternalReviewNotificationStorePort,
  ) {}

  async notifyReviewCompleted(payload: ReviewNotificationPayload): Promise<void> {
    const snapshot = { ...payload, recipientUserIds: [...payload.recipientUserIds] };
    const context = await this.context.resolve(snapshot);
    if (!context || !isAuthorizedReviewNotification(snapshot, context)) {
      throw new Error('Review notification authorization could not be confirmed');
    }
    await this.store.persistAuthorized({
      responseActionId: snapshot.responseActionId,
      recipientUserId: context.review.requesterId,
      projectId: snapshot.projectId,
      reviewId: snapshot.reviewId,
      reviewerId: snapshot.reviewerId,
      status: snapshot.status,
    });
  }
}
