import type { ReviewNotificationPayload } from './review-notification.port.js';
import type { TeacherReviewAction, TeacherReviewRequest } from './review-repository.port.js';

export interface ReviewNotificationContext {
  review: TeacherReviewRequest;
  action: TeacherReviewAction;
  requesterHasActiveMembership: boolean;
  requesterCanQueryReview: boolean;
}

export interface ReviewNotificationContextPort {
  resolve(payload: ReviewNotificationPayload): Promise<ReviewNotificationContext | null>;
}

export interface InternalReviewNotificationInput {
  responseActionId: string;
  recipientUserId: string;
  projectId: string;
  reviewId: string;
  reviewerId: string;
  status: 'APPROVED' | 'CHANGES_REQUESTED';
}

export interface InternalReviewNotificationStorePort {
  persistAuthorized(input: InternalReviewNotificationInput): Promise<void>;
}

export class ReviewNotificationStorageError extends Error {
  constructor(readonly outcome: 'rolled_back' | 'unknown') {
    super('Internal notification storage was not confirmed');
    this.name = 'ReviewNotificationStorageError';
  }
}

export function isAuthorizedReviewNotification(
  payload: ReviewNotificationPayload,
  context: ReviewNotificationContext,
): boolean {
  const { review, action } = context;
  return (
    payload.recipientUserIds.length === 1 &&
    payload.recipientUserIds[0] === review.requesterId &&
    context.requesterHasActiveMembership &&
    context.requesterCanQueryReview &&
    payload.projectId === review.projectId &&
    payload.reviewId === review.id &&
    payload.responseActionId === action.id &&
    action.reviewRequestId === review.id &&
    action.actionType === 'TEACHER_RESPONSE' &&
    action.actorRole === 'teacher' &&
    action.actorId === payload.reviewerId &&
    action.status === payload.status &&
    (payload.status === 'APPROVED' || payload.status === 'CHANGES_REQUESTED')
  );
}
