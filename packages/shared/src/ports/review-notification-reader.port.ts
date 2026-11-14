export interface ReviewNotificationPosition {
  createdAt: string;
  id: string;
}

export interface ReviewNotificationListItem extends ReviewNotificationPosition {
  projectId: string;
  reviewId: string;
  responseActionId: string;
  status: 'APPROVED' | 'CHANGES_REQUESTED';
}

export interface ReviewNotificationReadQuery {
  studentId: string;
  before?: ReviewNotificationPosition;
  take: number;
}

export interface ReviewNotificationReaderPort {
  listAuthorizedForStudent(
    query: ReviewNotificationReadQuery,
  ): Promise<ReviewNotificationListItem[]>;
}

export class ReviewNotificationReadError extends Error {
  readonly statusCode = 500;

  constructor() {
    super('Unable to read review notifications');
    this.name = 'ReviewNotificationReadError';
  }
}

export function compareReviewNotificationPositions(
  first: ReviewNotificationPosition,
  second: ReviewNotificationPosition,
): number {
  if (first.createdAt !== second.createdAt) return first.createdAt < second.createdAt ? -1 : 1;
  if (first.id === second.id) return 0;
  return first.id < second.id ? -1 : 1;
}
