import { z } from 'zod';
import {
  decodeReviewNotificationCursor,
  ReviewNotificationCursorSchema,
  ReviewNotificationTimestampSchema,
  ReviewNotificationUuidSchema,
} from './review-notification-cursor.js';

export const ListReviewNotificationsQuerySchema = z
  .object({
    limit: z
      .union([z.number(), z.string().regex(/^\d+$/)])
      .transform((value) => Number(value))
      .pipe(z.number().int().min(1).max(100))
      .default(20),
    cursor: ReviewNotificationCursorSchema.optional(),
  })
  .strict();

export type ListReviewNotificationsQuery = z.infer<typeof ListReviewNotificationsQuerySchema>;

export const ReviewNotificationItemSchema = z
  .object({
    id: ReviewNotificationUuidSchema,
    projectId: ReviewNotificationUuidSchema,
    reviewId: ReviewNotificationUuidSchema,
    responseActionId: ReviewNotificationUuidSchema,
    status: z.enum(['APPROVED', 'CHANGES_REQUESTED']),
    createdAt: ReviewNotificationTimestampSchema,
  })
  .strict();

export const ReviewNotificationListResponseSchema = z
  .object({
    items: z.array(ReviewNotificationItemSchema).max(100),
    nextCursor: ReviewNotificationCursorSchema.nullable(),
  })
  .strict()
  .superRefine((page, context) => {
    if (page.nextCursor === null) return;
    if (!ReviewNotificationCursorSchema.safeParse(page.nextCursor).success) return;
    const last = page.items.at(-1);
    const position = decodeReviewNotificationCursor(page.nextCursor);
    if (!last || position.id !== last.id || position.createdAt !== last.createdAt)
      context.addIssue({
        code: 'custom',
        path: ['nextCursor'],
        message: 'Cursor must reference the last returned item',
      });
  });

export type ReviewNotificationListResponse = z.infer<typeof ReviewNotificationListResponseSchema>;
