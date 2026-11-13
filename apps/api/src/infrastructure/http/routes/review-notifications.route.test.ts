import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  compareReviewNotificationPositions,
  decodeReviewNotificationCursor,
  encodeReviewNotificationCursor,
  ProjectResponseSchema,
  ReviewDetailResponseSchema,
  ReviewNotificationListResponseSchema,
  ReviewRequestSummaryResponseSchema,
  type ReviewNotificationReaderPort,
} from '@is488/shared';
import { createApp } from '../app.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { sessionFetch } from '../../auth/session-worker.js';

const student = '11111111-1111-4111-8111-111111111111';
const teacher = '33333333-3333-4333-8333-333333333333';
const peer = '22222222-2222-4222-8222-222222222222';
const actors = {
  student: { userId: student, role: 'student' },
  peer: { userId: peer, role: 'student' },
  teacher: { userId: teacher, role: 'teacher' },
  admin: { userId: student, role: 'admin' },
  changed: { userId: student, role: 'teacher' },
};
const path = '/api/review-notifications';

function fixture(reader?: ReviewNotificationReaderPort, notificationFailure = false) {
  const assignments = new Map<string, readonly string[]>();
  const emitter = {
    notifyReviewCompleted: vi.fn().mockRejectedValue(new Error('Synthetic failure')),
  };
  const app = createApp({
    nodeEnv: 'test',
    teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(assignments),
    reviewNotificationReader: reader,
    ...(notificationFailure ? { reviewNotificationPort: emitter } : {}),
    authentication: async (context, next) => {
      const session = context.req
        .header('Cookie')
        ?.replace(/^test_session=/, '') as keyof typeof actors;
      if (actors[session]) context.set('user', actors[session]);
      await next();
    },
  });
  async function send(
    url = path,
    session = 'student',
    status = 200,
    method = 'GET',
    body?: unknown,
  ) {
    const response = await app.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'test_session=' + session,
        'X-Dev-User-Id': peer,
        'X-Dev-User-Role': 'admin',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(status);
    if (url.startsWith(path)) expect(response.headers.get('Cache-Control')).toBe('no-store');
    return response.json();
  }
  async function review() {
    const project = ProjectResponseSchema.parse(
      await send('/api/projects', 'student', 201, 'POST', {
        title: 'Synthetic inbox project',
        courseCode: 'IS488',
        startDate: '2026-11-12T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
      }),
    );
    assignments.set(teacher, [...(assignments.get(teacher) ?? []), project.id]);
    const request = ReviewRequestSummaryResponseSchema.parse(
      await send(`/api/projects/${project.id}/reviews`, 'student', 201, 'POST', {
        title: 'Synthetic review',
        description: 'Synthetic review progress',
      }),
    );
    return `/api/projects/${project.id}/reviews/${request.id}`;
  }
  return { app, send, review, emitter };
}

afterEach(() => vi.restoreAllMocks());

describe('Student review notification HTTP (memory storage and synthetic session authority)', () => {
  it('returns a genuine empty page with no-store', async () => {
    expect(await fixture().send()).toEqual({ items: [], nextCursor: null });
  });

  it('returns 401 without a session even with forged development identity', async () => {
    const reader = { listAuthorizedForStudent: vi.fn().mockResolvedValue([]) };
    await fixture(reader).send(path, '', 401);
    expect(reader.listAuthorizedForStudent).not.toHaveBeenCalled();
  });

  it('sets no-store even if the injected authentication rejects before reaching the router', async () => {
    const app = createApp({
      authentication: async (context) => context.json({ error: 'Unauthorized' }, 401),
    });
    const response = await app.request(path);
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each(['teacher', 'admin', 'changed'])(
    'rejects session %s with 403 before validating a malformed cursor or reading',
    async (session) => {
      const reader = { listAuthorizedForStudent: vi.fn().mockResolvedValue([]) };
      expect(await fixture(reader).send(path + '?cursor=invalid', session, 403)).toEqual({
        error: 'Forbidden',
      });
      expect(reader.listAuthorizedForStudent).not.toHaveBeenCalled();
    },
  );

  it.each([
    'cursor=invalid',
    'cursor=',
    'cursor=' + 'a'.repeat(257),
    'limit=0',
    'limit=101',
    'limit=1.5',
    'limit=x',
    'limit=1&limit=2',
    'cursor=x&cursor=y',
    'studentId=' + peer,
    'recipientUserId=' + peer,
    'projectId=foreign',
    'unknown=value',
  ])('rejects invalid or identity-selecting query %s before reading', async (query) => {
    const reader = { listAuthorizedForStudent: vi.fn().mockResolvedValue([]) };
    expect(await fixture(reader).send(path + '?' + query, 'student', 400)).toEqual({
      error: 'Bad Request',
    });
    expect(reader.listAuthorizedForStudent).not.toHaveBeenCalled();
  });

  it('passes only the session student, parsed limit and complete position to the reader', async () => {
    const reader = { listAuthorizedForStudent: vi.fn().mockResolvedValue([]) };
    const before = { createdAt: '2026-11-12T15:20:30.123456Z', id: crypto.randomUUID() };
    await fixture(reader).send(path + '?limit=1&cursor=' + encodeReviewNotificationCursor(before));
    expect(reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
    expect(reader.listAuthorizedForStudent).toHaveBeenCalledWith({
      studentId: student,
      before,
      take: 2,
    });
  });

  it('reads the shared store, paginates history and keeps foreign cursors within the original requester scope', async () => {
    const setup = fixture();
    const url = await setup.review();
    for (const status of ['CHANGES_REQUESTED', 'CHANGES_REQUESTED', 'APPROVED']) {
      await setup.send(url + '/response', 'teacher', 200, 'POST', {
        status,
        observation: 'Synthetic response',
      });
      if (status !== 'APPROVED')
        await setup.send(url + '/re-submit', 'student', 200, 'POST', {
          description: 'Synthetic complete corrections',
        });
    }
    const detail = ReviewDetailResponseSchema.parse(await setup.send(url));
    const full = ReviewNotificationListResponseSchema.parse(await setup.send());
    expect(full.items).toHaveLength(3);
    expect(full.items.map((row) => row.status).sort()).toEqual([
      'APPROVED',
      'CHANGES_REQUESTED',
      'CHANGES_REQUESTED',
    ]);
    expect(new Set(full.items.map((row) => row.responseActionId))).toEqual(
      new Set(
        detail.actions
          .filter((action) => action.actionType === 'TEACHER_RESPONSE')
          .map((action) => action.id),
      ),
    );
    const collected: string[] = [];
    let cursor: string | undefined;
    do {
      const page = ReviewNotificationListResponseSchema.parse(
        await setup.send(path + '?limit=1' + (cursor ? '&cursor=' + cursor : '')),
      );
      collected.push(...page.items.map((row) => row.id));
      if (page.nextCursor)
        expect(decodeReviewNotificationCursor(page.nextCursor)).toEqual({
          id: page.items[0]!.id,
          createdAt: page.items[0]!.createdAt,
        });
      cursor = page.nextCursor ?? undefined;
    } while (cursor && collected.length < 5);
    expect(collected).toEqual(full.items.map((row) => row.id));
    expect(new Set(collected).size).toBe(3);
    expect(await setup.send(path, 'peer')).toEqual({ items: [], nextCursor: null });
    await setup.send(`/api/projects/${detail.projectId}/members`, 'student', 201, 'POST', {
      userId: peer,
      role: 'collaborator',
    });
    const peerReview = ReviewRequestSummaryResponseSchema.parse(
      await setup.send(`/api/projects/${detail.projectId}/reviews`, 'peer', 201, 'POST', {
        title: 'Peer review',
        description: 'Synthetic peer review progress',
      }),
    );
    await setup.send(
      `/api/projects/${detail.projectId}/reviews/${peerReview.id}/response`,
      'teacher',
      200,
      'POST',
      { status: 'APPROVED', observation: 'Synthetic peer approval' },
    );
    const foreign = ReviewNotificationListResponseSchema.parse(await setup.send(path, 'peer'));
    expect(foreign.items).toHaveLength(1);
    const position = foreign.items[0]!;
    const fromForeignCursor = ReviewNotificationListResponseSchema.parse(
      await setup.send(path + '?cursor=' + encodeReviewNotificationCursor(position)),
    );
    expect(fromForeignCursor.items).toEqual(
      full.items.filter((item) => compareReviewNotificationPositions(item, position) < 0),
    );
    expect(fromForeignCursor.items.some((item) => item.id === position.id)).toBe(false);
    expect(await setup.send(url)).toEqual(detail);
  });

  it('returns sanitized 500 with no partial page or emission on read failure', async () => {
    const reader = {
      listAuthorizedForStudent: vi.fn().mockRejectedValue(new Error('Private SQL details')),
    };
    const setup = fixture(reader, true);
    expect(await setup.send(path, 'student', 500)).toEqual({ error: 'Internal Server Error' });
    expect(reader.listAuthorizedForStudent).toHaveBeenCalledTimes(1);
    expect(setup.emitter.notifyReviewCompleted).not.toHaveBeenCalled();
  });

  it('does not repair an absent notification after best-effort failure and keeps the successful review contract', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const setup = fixture(undefined, true);
    const url = await setup.review();
    const summary = ReviewRequestSummaryResponseSchema.parse(
      await setup.send(url + '/response', 'teacher', 200, 'POST', {
        status: 'APPROVED',
        observation: 'Synthetic approval',
      }),
    );
    expect(summary).not.toHaveProperty('responseActionId');
    const before = await setup.send(url);
    expect(await setup.send()).toEqual({ items: [], nextCursor: null });
    expect(await setup.send()).toEqual({ items: [], nextCursor: null });
    expect(await setup.send(url)).toEqual(before);
    expect(setup.emitter.notifyReviewCompleted).toHaveBeenCalledTimes(1);
  });

  it.each(['X-Dev-User-Id', 'Cf-Access-Jwt-Assertion'])(
    'the real session boundary rejects forged %s before any SQL configuration or access',
    async (header) => {
      const response = await sessionFetch(
        new Request('https://localhost:8792' + path, { headers: { [header]: student } }),
        { AUTH_ORIGIN: 'https://localhost:8792', AUTH_SECRET: crypto.randomUUID().repeat(2) },
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toContain('no-store');
    },
  );
});
