import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeReviewNotificationCursor } from '@is488/shared';
import {
  getReviewNotifications,
  ReviewNotificationFetchError,
} from './review-notification.service.js';

const item = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  reviewId: '33333333-3333-4333-8333-333333333333',
  responseActionId: '44444444-4444-4444-8444-444444444444',
  status: 'CHANGES_REQUESTED',
  createdAt: '2026-11-13T12:00:00.123456Z',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Student review inbox API client', () => {
  it('uses the existing cookie client, no-store and abort signal without client identity or date reconstruction', async () => {
    vi.stubEnv('MODE', 'production');
    const cursor = encodeReviewNotificationCursor(item);
    const payload = { items: [item], nextCursor: cursor };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    expect(await getReviewNotifications({ cursor }, { signal: controller.signal })).toEqual(
      payload,
    );
    const [url, options] = fetcher.mock.calls[0]!;
    const query = new URL(url, 'https://synthetic.example.test').searchParams;
    expect(query.get('cursor')).toBe(cursor);
    expect(query.get('limit')).toBe('20');
    expect([...query.keys()]).toEqual(['limit', 'cursor']);
    expect(options).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    expect(options.headers).not.toHaveProperty('X-Dev-User-Id');
    expect(options.headers).not.toHaveProperty('X-Dev-User-Role');
  });
  it('returns real empty pages and preserves exact timestamps', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], nextCursor: null }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [item], nextCursor: null }) });
    vi.stubGlobal('fetch', fetcher);
    expect(await getReviewNotifications()).toEqual({ items: [], nextCursor: null });
    expect((await getReviewNotifications()).items[0]!.createdAt).toBe(item.createdAt);
  });
  it.each([{ limit: 0 }, { limit: 101 }, { cursor: 'invalid' }, { studentId: 'other' }])(
    'rejects invalid query %j before transport',
    async (query) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      await expect(
        getReviewNotifications(query as Parameters<typeof getReviewNotifications>[0]),
      ).rejects.toMatchObject({ status: 400 });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it.each([401, 403, 500])(
    'preserves HTTP status %i without reading or exposing the server body',
    async (status) => {
      const json = vi.fn();
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status, json }));
      await expect(getReviewNotifications()).rejects.toMatchObject({ status });
      expect(json).not.toHaveBeenCalled();
    },
  );
  it.each([
    { items: [{ ...item, observation: 'private' }], nextCursor: null },
    { items: [{ ...item, createdAt: '2026-11-13T12:00:00.123Z' }], nextCursor: null },
    { items: [item], nextCursor: 'invalid' },
    { items: [], nextCursor: encodeReviewNotificationCursor(item) },
  ])('rejects malformed or excessive data instead of exposing a partial page', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
    await expect(getReviewNotifications()).rejects.toBeInstanceOf(ReviewNotificationFetchError);
  });
  it('does not convert network failure into an empty success or retry it', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network failure'));
    vi.stubGlobal('fetch', fetcher);
    await expect(getReviewNotifications()).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
