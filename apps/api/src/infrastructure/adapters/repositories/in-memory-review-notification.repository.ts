import {
  compareReviewNotificationPositions,
  isAuthorizedReviewNotification,
  ReviewNotificationItemSchema,
  ReviewNotificationReadError,
  type InternalReviewNotificationInput,
  type InternalReviewNotificationStorePort,
  type MembershipRepositoryPort,
  type ReviewNotificationContext,
  type ReviewNotificationContextPort,
  type ReviewNotificationPayload,
  type ReviewNotificationListItem,
  type ReviewNotificationReaderPort,
  type ReviewNotificationReadQuery,
  type ReviewRepositoryPort,
  type SystemClockPort,
} from '@is488/shared';

export class InMemoryReviewNotificationRepository
  implements
    ReviewNotificationContextPort,
    InternalReviewNotificationStorePort,
    ReviewNotificationReaderPort
{
  private readonly records = new Map<
    string,
    InternalReviewNotificationInput & { id: string; createdAt: string }
  >();

  constructor(
    private readonly reviews: ReviewRepositoryPort,
    private readonly memberships: MembershipRepositoryPort,
    private readonly clock: SystemClockPort,
  ) {}

  get notifications() {
    return [...this.records.values()].map((entry) => ({ ...entry }));
  }

  async listAuthorizedForStudent(
    query: ReviewNotificationReadQuery,
  ): Promise<ReviewNotificationListItem[]> {
    try {
      const authorized: ReviewNotificationListItem[] = [];
      for (const record of this.records.values()) {
        if (record.recipientUserId !== query.studentId) continue;
        const review = await this.reviews.findById(record.projectId, record.reviewId);
        if (
          !review ||
          review.projectId !== record.projectId ||
          review.requesterId !== query.studentId
        )
          continue;
        const membership = await this.memberships.findByProjectAndUser(
          record.projectId,
          query.studentId,
        );
        if (membership?.status !== 'active') continue;
        const timestamp = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(
          record.createdAt,
        );
        if (!timestamp) throw new ReviewNotificationReadError();
        authorized.push(
          ReviewNotificationItemSchema.parse({
            id: record.id,
            projectId: record.projectId,
            reviewId: record.reviewId,
            responseActionId: record.responseActionId,
            status: record.status,
            createdAt: `${timestamp[1]}.${(timestamp[2] ?? '').padEnd(6, '0')}Z`,
          }),
        );
      }
      return authorized
        .filter((row) => !query.before || compareReviewNotificationPositions(row, query.before) < 0)
        .sort((first, second) => compareReviewNotificationPositions(second, first))
        .slice(0, query.take);
    } catch {
      throw new ReviewNotificationReadError();
    }
  }

  async resolve(payload: ReviewNotificationPayload): Promise<ReviewNotificationContext | null> {
    const review = await this.reviews.findById(payload.projectId, payload.reviewId);
    const action = review?.actions.find((entry) => entry.id === payload.responseActionId);
    if (!review || !action) return null;
    const membership = await this.memberships.findByProjectAndUser(
      review.projectId,
      review.requesterId,
    );
    const active = membership?.status === 'active';
    return {
      review,
      action,
      requesterHasActiveMembership: active,
      requesterCanQueryReview: active,
    };
  }

  async persistAuthorized(input: InternalReviewNotificationInput): Promise<void> {
    const payload = { ...input, recipientUserIds: [input.recipientUserId] };
    const context = await this.resolve(payload);
    if (!context || !isAuthorizedReviewNotification(payload, context))
      throw new Error('Review notification authorization could not be confirmed');
    const key = JSON.stringify([input.responseActionId, input.recipientUserId]);
    if (!this.records.has(key))
      this.records.set(key, {
        ...input,
        id: crypto.randomUUID(),
        createdAt: this.clock.isoString(),
      });
  }
}
