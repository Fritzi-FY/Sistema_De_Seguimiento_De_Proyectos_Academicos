import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ReviewDetailResponseSchema,
  ReviewRequestSummaryResponseSchema,
  ProjectResponseSchema,
  MemberListResponseSchema,
} from '@is488/shared';
import { createApp } from '../app.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { InMemoryReviewRepository } from '../../adapters/repositories/in-memory-review.repository.js';
import { InMemoryMembershipRepository } from '../../adapters/repositories/in-memory-membership.repository.js';
import { NotificationTestSpy } from '../../../testing/notification-test-spy.js';
import { openApiSpec } from '../../openapi/openapi.contract.js';

const student = '11111111-1111-4111-8111-111111111111';
const peer = '22222222-2222-4222-8222-222222222222';
const teacher = '33333333-3333-4333-8333-333333333333';
const replacement = '44444444-4444-4444-8444-444444444444';
const missing = '99999999-9999-4999-8999-999999999999';
const initial = {
  title: 'Avance de proyecto',
  description: 'Descripción inicial del avance.',
  evidenceUrl: 'https://example.org/initial',
};
const changes = { status: 'CHANGES_REQUESTED', observation: 'Completar las observaciones.' };

describe('Teacher reviews HTTP', () => {
  let app: ReturnType<typeof createApp>;
  let projectId: string;
  let path: string;
  let assignments: Map<string, readonly string[]>;
  let notifications: NotificationTestSpy;
  let repository: InMemoryReviewRepository;

  async function send(
    url: string,
    method = 'GET',
    body?: unknown,
    user = student,
    role = 'student',
    expected = 200,
  ) {
    const response = await app.request(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': user,
        'X-Dev-User-Role': role,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(expected);
    if (url.includes('/reviews')) expect(response.headers.get('Cache-Control')).toBe('no-store');
    return response.json();
  }
  async function create() {
    return ReviewRequestSummaryResponseSchema.parse(
      await send(path, 'POST', initial, student, 'student', 201),
    );
  }
  async function useTeacherSession(userId: string) {
    const memberships = new InMemoryMembershipRepository();
    await memberships.addMember({
      projectId,
      userId,
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-11-09T00:00:00.000Z',
      updatedAt: '2026-11-09T00:00:00.000Z',
      removedAt: null,
    });
    expect(await memberships.findByProjectAndUser(projectId, userId)).not.toBeNull();
    app = createApp({
      nodeEnv: 'test',
      membershipRepository: memberships,
      reviewRepository: repository,
      teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(assignments),
      reviewNotificationPort: notifications,
      authentication: async (context, next) => {
        context.set('user', { userId, role: 'teacher' });
        await next();
      },
    });
  }
  beforeEach(async () => {
    assignments = new Map();
    notifications = new NotificationTestSpy();
    repository = new InMemoryReviewRepository();
    app = createApp({
      nodeEnv: 'test',
      teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(assignments),
      reviewRepository: repository,
      reviewNotificationPort: notifications,
    });
    const project = await send(
      '/api/projects',
      'POST',
      {
        title: 'Proyecto de revisiones',
        courseCode: 'IS488',
        startDate: '2026-11-09T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
      },
      student,
      'student',
      201,
    );
    projectId = ProjectResponseSchema.parse(project).id;
    path = `/api/projects/${projectId}/reviews`;
    assignments.set(teacher, [projectId]);
    await send(
      `/api/projects/${projectId}/members`,
      'POST',
      { userId: peer, role: 'collaborator' },
      student,
      'student',
      201,
    );
  });

  it('executes two correction cycles and approval with six ordered events and session actors', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    for (const cycle of [1, 2]) {
      await send(url + '/response', 'POST', changes, teacher, 'teacher');
      await send(url + '/re-submit', 'POST', {
        description: 'Ajustes del ciclo ' + cycle,
        evidenceUrl: 'https://example.org/cycle/' + cycle,
      });
    }
    await send(
      url + '/response',
      'POST',
      { status: 'APPROVED', observation: 'Aprobación final.' },
      teacher,
      'teacher',
    );
    const detail = ReviewDetailResponseSchema.parse(await send(url));
    expect(detail.status).toBe('APPROVED');
    expect(detail.timeline.map((event) => event.sequenceNumber)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(detail.timeline.map((event) => event.actorId)).toEqual([
      student,
      teacher,
      student,
      teacher,
      student,
      teacher,
    ]);
    expect(
      ReviewDetailResponseSchema.parse(await send(url, 'GET', undefined, teacher, 'teacher')),
    ).toEqual(detail);
    expect(notifications.calls).toHaveLength(3);
    expect(notifications.calls.every((call) => call.recipientUserIds[0] === student)).toBe(true);
  });

  it('rejects a teacher session with active project membership requesting a review without persistence', async () => {
    const review = await create();
    const before = await repository.findById(projectId, review.id);
    await useTeacherSession(teacher);
    const persist = vi.spyOn(repository, 'createRequest');
    expect(await send(path, 'POST', initial, student, 'student', 403)).toEqual({
      error: 'Forbidden',
    });
    expect(persist).not.toHaveBeenCalled();
    expect(await repository.findById(projectId, review.id)).toEqual(before);
  });

  it('rejects an active original requester whose session role became teacher without state or history changes', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    await send(url + '/response', 'POST', changes, teacher, 'teacher');
    const before = await repository.findById(projectId, review.id);
    expect(before?.status).toBe('CHANGES_REQUESTED');
    await useTeacherSession(student);
    const persist = vi.spyOn(repository, 'recordStudentResubmission');
    expect(
      await send(
        url + '/re-submit',
        'POST',
        { description: 'Ajustes completos que deben rechazarse.' },
        student,
        'student',
        403,
      ),
    ).toEqual({ error: 'Forbidden' });
    expect(persist).not.toHaveBeenCalled();
    expect(await repository.findById(projectId, review.id)).toEqual(before);
  });

  it('requires authentication on all four endpoints, including error cache headers', async () => {
    const review = await create();
    for (const [suffix, method] of [
      ['', 'POST'],
      ['/' + review.id, 'GET'],
      ['/' + review.id + '/response', 'POST'],
      ['/' + review.id + '/re-submit', 'POST'],
    ]) {
      const response = await app.request(path + suffix, { method });
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('rejects invalid IDs, malformed JSON, invalid payloads and injected identity or sequence', async () => {
    await send('/api/projects/invalid/reviews', 'POST', initial, student, 'student', 400);
    for (const body of [
      { ...initial, requesterId: teacher },
      { ...initial, sequenceNumber: 9 },
      { ...initial, title: 'x' },
      { ...initial, evidenceUrl: 'invalid' },
      {},
    ])
      await send(path, 'POST', body, student, 'student', 400);
    const malformed = await app.request(path, {
      method: 'POST',
      headers: { 'X-Dev-User-Id': student },
      body: '{',
    });
    expect(malformed.status).toBe(400);
    const review = await create();
    await send(
      path + '/' + review.id + '/response',
      'POST',
      { ...changes, reviewerId: teacher },
      teacher,
      'teacher',
      400,
    );
    await send(
      path + '/' + review.id + '/response',
      'POST',
      { status: 'PENDING', observation: 'Inválido.' },
      teacher,
      'teacher',
      400,
    );
    await send(
      path + '/' + review.id + '/re-submit',
      'POST',
      { description: 'x' },
      student,
      'student',
      400,
    );
    await send(path + '/invalid', 'GET', undefined, student, 'student', 400);
  });

  it('uses trusted session identity and role despite spoofed development headers', async () => {
    app = createApp({
      nodeEnv: 'test',
      authentication: async (context, next) => {
        context.set('user', { userId: student, role: 'student' });
        await next();
      },
      teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(assignments),
      reviewRepository: repository,
    });
    const project = await send(
      '/api/projects',
      'POST',
      {
        title: 'Proyecto sesión confiable',
        courseCode: 'IS488',
        startDate: '2026-11-09T00:00:00.000Z',
        targetDate: '2026-12-01T00:00:00.000Z',
      },
      student,
      'student',
      201,
    );
    projectId = ProjectResponseSchema.parse(project).id;
    path = `/api/projects/${projectId}/reviews`;
    assignments.set(teacher, [projectId]);
    const review = await create();
    await send(path + '/' + review.id + '/response', 'POST', changes, teacher, 'teacher', 403);
  });

  it('rejects non-teacher responses and hides other members, strangers and cross-project IDs', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    await send(url + '/response', 'POST', changes, student, 'student', 403);
    for (const user of [peer, missing]) {
      await send(url, 'GET', undefined, user, 'student', 404);
      await send(
        url + '/re-submit',
        'POST',
        { description: 'Ajustes no autorizados.' },
        user,
        'student',
        404,
      );
    }
    await send(path, 'POST', initial, missing, 'student', 404);
    await send(url + '/response', 'POST', changes, replacement, 'teacher', 404);
    for (const suffix of ['', '/response', '/re-submit'])
      await send(
        `/api/projects/${missing}/reviews/${review.id}${suffix}`,
        suffix ? 'POST' : 'GET',
        suffix === '/response'
          ? changes
          : suffix
            ? { description: 'Ajustes de otro proyecto.' }
            : undefined,
        suffix === '/response' ? teacher : student,
        suffix === '/response' ? 'teacher' : 'student',
        404,
      );
    const collaboratorReview = ReviewRequestSummaryResponseSchema.parse(
      await send(path, 'POST', initial, peer, 'student', 201),
    );
    await send(path + '/' + collaboratorReview.id, 'GET', undefined, student, 'student', 404);
  });

  it('enforces live teacher reassignment and requester membership revocation', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    await send(url + '/response', 'POST', changes, teacher, 'teacher');
    assignments.delete(teacher);
    assignments.set(replacement, [projectId]);
    await send(url, 'GET', undefined, teacher, 'teacher', 404);
    await send(url + '/response', 'POST', changes, teacher, 'teacher', 404);
    await send(url + '/re-submit', 'POST', { description: 'Ajustes completos para revisión.' });
    await send(url + '/response', 'POST', changes, replacement, 'teacher');
    const detail = ReviewDetailResponseSchema.parse(
      await send(url, 'GET', undefined, replacement, 'teacher'),
    );
    expect(detail.actions.map((action) => action.actorId)).toEqual([teacher, student, replacement]);
    const peerReview = ReviewRequestSummaryResponseSchema.parse(
      await send(path, 'POST', initial, peer, 'student', 201),
    );
    await send(path + '/' + peerReview.id + '/response', 'POST', changes, replacement, 'teacher');
    const members = MemberListResponseSchema.parse(
      await send(`/api/projects/${projectId}/members`),
    );
    const peerMembership = members.find((member) => member.userId === peer)!;
    await send(
      `/api/projects/${projectId}/members/${peer}?membershipId=${peerMembership.id}`,
      'DELETE',
      undefined,
      student,
      'student',
      200,
    );
    await send(path + '/' + peerReview.id, 'GET', undefined, peer, 'student', 404);
    await send(
      path + '/' + peerReview.id + '/re-submit',
      'POST',
      { description: 'Ajustes tras retiro.' },
      peer,
      'student',
      404,
    );
    await send(path, 'POST', initial, peer, 'student', 404);
  });

  it('returns conflicts for stale transitions and concurrent resubmissions without duplicate events', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    await send(
      url + '/re-submit',
      'POST',
      { description: 'Ajustes antes de observaciones.' },
      student,
      'student',
      409,
    );
    await send(url + '/response', 'POST', changes, teacher, 'teacher');
    await send(url + '/response', 'POST', changes, teacher, 'teacher', 409);
    const replies = await Promise.all(
      [1, 2].map(() =>
        app.request(url + '/re-submit', {
          method: 'POST',
          headers: { 'X-Dev-User-Id': student, 'Content-Type': 'application/json' },
          body: JSON.stringify({ description: 'Ajustes concurrentes completos.' }),
        }),
      ),
    );
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409]);
    await send(
      url + '/response',
      'POST',
      { status: 'APPROVED', observation: 'Aprobación definitiva.' },
      teacher,
      'teacher',
    );
    await send(
      url + '/re-submit',
      'POST',
      { description: 'Ajustes posteriores a aprobación.' },
      student,
      'student',
      409,
    );
    expect(
      ReviewDetailResponseSchema.parse(await send(url)).timeline.map(
        (event) => event.sequenceNumber,
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it('sanitizes persistence failures and preserves successful responses after notification failure', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    const fault = vi
      .spyOn(repository, 'recordTeacherResponse')
      .mockRejectedValueOnce(new Error('secret SQL detail'));
    expect(await send(url + '/response', 'POST', changes, teacher, 'teacher', 500)).toEqual({
      error: 'Internal Server Error',
    });
    expect(notifications.calls).toHaveLength(0);
    fault.mockRestore();
    notifications.configureToThrow();
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await send(url + '/response', 'POST', changes, teacher, 'teacher');
      expect(ReviewDetailResponseSchema.parse(await send(url)).status).toBe('CHANGES_REQUESTED');
      expect(diagnostic).toHaveBeenCalled();
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(changes.observation);
    } finally {
      diagnostic.mockRestore();
    }
  });

  it('documents all four paths, status codes, cache policy and strict request schemas', () => {
    const paths = openApiSpec.paths;
    for (const [url, value] of Object.entries(paths).filter(([url]) => url.includes('/reviews'))) {
      expect(url).toContain('{projectId}');
      const operation = Object.values(value)[0]!;
      expect(operation.responses).toHaveProperty('401');
      expect(operation.responses).toHaveProperty('404');
      expect(operation.responses).toHaveProperty('500');
    }
    expect(openApiSpec.components.schemas.CreateReviewRequest.additionalProperties).toBe(false);
    expect(openApiSpec.components.schemas.RespondReviewRequest.additionalProperties).toBe(false);
    expect(openApiSpec.components.schemas.ResubmitReviewRequest.additionalProperties).toBe(false);
  });
});
