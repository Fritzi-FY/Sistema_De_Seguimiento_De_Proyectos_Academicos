import {
  compareReviewNotificationPositions,
  decodeReviewNotificationCursor,
  encodeReviewNotificationCursor,
  ListReviewNotificationsQuerySchema,
  ReviewNotificationItemSchema,
  ReviewNotificationListResponseSchema,
  ReviewNotificationReadError,
  type ReviewNotificationListResponse,
  type ReviewNotificationReaderPort,
} from '@is488/shared';

export interface ListStudentReviewNotificationsQuery {
  session: { userId: string; role: string };
  query?: unknown;
}

export class ListStudentReviewNotificationsUseCase {
  constructor(private readonly reader: ReviewNotificationReaderPort) {}

  async execute(
    command: ListStudentReviewNotificationsQuery,
  ): Promise<ReviewNotificationListResponse> {
    const { userId, role } = command.session;
    if (role !== 'student' || !userId.trim())
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });

    const parsed = ListReviewNotificationsQuerySchema.safeParse(
      command.query === undefined ? {} : command.query,
    );
    if (!parsed.success) throw Object.assign(new Error('Bad Request'), { statusCode: 400 });
    const { limit, cursor } = parsed.data;
    const before = cursor === undefined ? undefined : decodeReviewNotificationCursor(cursor);

    try {
      const rows = ReviewNotificationItemSchema.array()
        .max(limit + 1)
        .parse(
          await this.reader.listAuthorizedForStudent({
            studentId: userId,
            before,
            take: limit + 1,
          }),
        );
      const identities = new Set<string>();
      for (const [index, row] of rows.entries()) {
        const previous = rows[index - 1];
        if (
          identities.has(row.id) ||
          (before && compareReviewNotificationPositions(row, before) >= 0) ||
          (previous && compareReviewNotificationPositions(previous, row) <= 0)
        )
          throw new ReviewNotificationReadError();
        identities.add(row.id);
      }
      const items = rows.slice(0, limit);
      const last = items.at(-1);
      return ReviewNotificationListResponseSchema.parse({
        items,
        nextCursor: rows.length > limit && last ? encodeReviewNotificationCursor(last) : null,
      });
    } catch {
      throw new ReviewNotificationReadError();
    }
  }
}
