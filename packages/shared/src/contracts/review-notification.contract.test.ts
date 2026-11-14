import { describe, expect, it } from 'vitest';
import type { ReviewNotificationListItem } from '../ports/review-notification-reader.port.js';
import { encodeReviewNotificationCursor } from './review-notification-cursor.js';
import {
  ListReviewNotificationsQuerySchema,
  ReviewNotificationItemSchema,
  ReviewNotificationListResponseSchema,
} from './review-notification.contract.js';

const item: ReviewNotificationListItem = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  reviewId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  responseActionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'CHANGES_REQUESTED',
  createdAt: '2026-11-12T15:20:30.123456Z',
};

describe('Review notification inbox contracts', () => {
  it('defaults to 20 and accepts numeric query limits within the approved bounds', () => {
    expect(ListReviewNotificationsQuerySchema.parse({})).toEqual({ limit: 20 });
    for (const limit of [1, '1', 20, '20', 100, '100'])
      expect(ListReviewNotificationsQuerySchema.parse({ limit }).limit).toBe(Number(limit));
    const cursor = encodeReviewNotificationCursor(item);
    expect(ListReviewNotificationsQuerySchema.parse({ limit: '1', cursor })).toEqual({
      limit: 1,
      cursor,
    });
  });

  it.each([0, 101, -1, 1.5, '', 'invalid', '20.5', 'Infinity', null, true, [20], {}])(
    'rejects invalid limit %j',
    (limit) => {
      expect(ListReviewNotificationsQuerySchema.safeParse({ limit }).success).toBe(false);
    },
  );

  it.each(['studentId', 'userId', 'recipientUserId', 'projectId', 'page', 'take'])(
    'rejects extra query key %s instead of stripping an identity or scope override',
    (key) => {
      expect(ListReviewNotificationsQuerySchema.safeParse({ [key]: 'other' }).success).toBe(false);
    },
  );

  it('rejects invalid cursor contents as well as a malformed query shape', () => {
    for (const query of [null, [], 'query', { cursor: '' }, { cursor: 'e30' }, { cursor: null }])
      expect(ListReviewNotificationsQuerySchema.safeParse(query).success).toBe(false);
  });

  it('exposes exactly the six approved historical notification fields', () => {
    expect(ReviewNotificationItemSchema.parse(item)).toEqual(item);
    expect(ReviewNotificationItemSchema.parse({ ...item, status: 'APPROVED' }).status).toBe(
      'APPROVED',
    );
    for (const field of ['recipientUserId', 'observation', 'evidenceUrl', 'reviewerId', 'title'])
      expect(ReviewNotificationItemSchema.safeParse({ ...item, [field]: 'private' }).success).toBe(
        false,
      );
    for (const field of Object.keys(item)) {
      const incomplete = { ...item } as Record<string, unknown>;
      delete incomplete[field];
      expect(ReviewNotificationItemSchema.safeParse(incomplete).success).toBe(false);
    }
    expect(ReviewNotificationItemSchema.safeParse({ ...item, status: 'PENDING' }).success).toBe(
      false,
    );
    expect(
      ReviewNotificationItemSchema.safeParse({ ...item, createdAt: '2026-11-12T15:20:30.123Z' })
        .success,
    ).toBe(false);
  });

  it('validates empty/terminal pages and a cursor matching the last returned item', () => {
    expect(ReviewNotificationListResponseSchema.parse({ items: [], nextCursor: null })).toEqual({
      items: [],
      nextCursor: null,
    });
    const nextCursor = encodeReviewNotificationCursor(item);
    expect(ReviewNotificationListResponseSchema.parse({ items: [item], nextCursor })).toEqual({
      items: [item],
      nextCursor,
    });
    expect(ReviewNotificationListResponseSchema.safeParse({ items: [], nextCursor }).success).toBe(
      false,
    );
    expect(
      ReviewNotificationListResponseSchema.safeParse({
        items: [item],
        nextCursor: encodeReviewNotificationCursor({
          ...item,
          createdAt: '2026-11-12T15:20:30.123457Z',
        }),
      }).success,
    ).toBe(false);
    expect(
      ReviewNotificationListResponseSchema.safeParse({
        items: [item],
        nextCursor: encodeReviewNotificationCursor({ ...item, id: item.projectId }),
      }).success,
    ).toBe(false);
  });

  it('rejects malformed response cursors safely and bounded pages without leaking extra fields', () => {
    for (const nextCursor of ['not-base64', 'e30', '', null]) {
      const response = ReviewNotificationListResponseSchema.safeParse({ items: [], nextCursor });
      expect(response.success).toBe(nextCursor === null);
    }
    expect(ReviewNotificationListResponseSchema.safeParse({ items: [item] }).success).toBe(false);
    expect(
      ReviewNotificationListResponseSchema.safeParse({ items: [], nextCursor: null, total: 10 })
        .success,
    ).toBe(false);
    expect(
      ReviewNotificationListResponseSchema.safeParse({
        items: Array(101).fill(item),
        nextCursor: null,
      }).success,
    ).toBe(false);
  });
});
