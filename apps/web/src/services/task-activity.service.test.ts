import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTaskActivity } from './task.service.js';
const id = '11111111-1111-4111-8111-111111111111';
const event = {
  id,
  taskId: id,
  projectId: id,
  actorId: '11111111-1111-4111-8111-111111111111',
  action: 'CREATED',
  createdAt: '2026-10-25T00:00:00.000Z',
};
afterEach(() => vi.unstubAllGlobals());
describe('getTaskActivity', () => {
  it('queries existing route with auth and signal and preserves event order', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => [event] });
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController();
    expect(await getTaskActivity(id, id, undefined, { signal: controller.signal })).toEqual([
      event,
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      `/api/projects/${id}/tasks/${id}/activity`,
      expect.objectContaining({
        method: 'GET',
        signal: controller.signal,
        headers: expect.objectContaining({
          'X-Dev-User-Id': '11111111-1111-4111-8111-111111111111',
        }),
      }),
    );
  });
  it.each([
    [{ ...event, projectId: '22222222-2222-4222-8222-222222222222' }],
    [{ ...event, taskId: '22222222-2222-4222-8222-222222222222' }],
    [{ ...event, action: 'FAKE' }],
  ])('rejects wrong identity or invalid schema', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [payload] }));
    await expect(getTaskActivity(id, id)).rejects.toThrow();
  });
  it('does not turn HTTP failures into an empty history', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(getTaskActivity(id, id)).rejects.toThrow('404');
  });
  it('propagates network errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Sin red')));
    await expect(getTaskActivity(id, id)).rejects.toThrow('Sin red');
  });
});
