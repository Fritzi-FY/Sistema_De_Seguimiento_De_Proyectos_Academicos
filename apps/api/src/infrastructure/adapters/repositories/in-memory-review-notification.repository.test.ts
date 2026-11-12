import { describe, expect, it, vi } from 'vitest';
import { InMemoryReviewNotificationRepository } from './in-memory-review-notification.repository.js';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';
import { InMemoryMembershipRepository } from './in-memory-membership.repository.js';
import { InMemoryTeacherProjectScopeAdapter } from './in-memory-teacher-project-scope.adapter.js';
import { PersistReviewNotificationUseCase } from '../../../application/use-cases/persist-review-notification.use-case.js';
import { createApp } from '../../http/app.js';

const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const student = 'student';
const teacher = 'teacher';
const now = '2026-11-11T00:00:00.000Z';

async function fixture() {
  const memberships = new InMemoryMembershipRepository();
  const member = await memberships.addMember({
    projectId,
    userId: student,
    role: 'collaborator',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
    removedAt: null,
  });
  const reviews = new InMemoryReviewRepository();
  const review = await reviews.createRequest({
    projectId,
    requesterId: student,
    title: 'Synthetic review',
    description: 'Synthetic review progress.',
  });
  const result = await reviews.recordTeacherResponse(projectId, review.id, {
    reviewerId: teacher,
    status: 'CHANGES_REQUESTED',
    observation: 'Synthetic corrections.',
  });
  const repository = new InMemoryReviewNotificationRepository(reviews, memberships, {
    now: () => new Date(now),
    isoString: () => now,
  });
  const useCase = new PersistReviewNotificationUseCase(repository, repository);
  const payload = {
    projectId,
    reviewId: review.id,
    responseActionId: result.responseActionId,
    reviewerId: teacher,
    status: 'CHANGES_REQUESTED' as const,
    recipientUserIds: [student],
  };
  return { memberships, member, reviews, review, repository, useCase, payload };
}

describe('In-memory notification equivalent (simulated storage)', () => {
  it('deduplicates the same source and recipient without mutating its identity or exposing mutable records', async () => {
    const setup = await fixture();
    await setup.useCase.notifyReviewCompleted(setup.payload);
    const before = setup.repository.notifications;
    await Promise.all([
      setup.useCase.notifyReviewCompleted(setup.payload),
      setup.useCase.notifyReviewCompleted(setup.payload),
    ]);
    expect(setup.repository.notifications).toEqual(before);
    before[0]!.id = 'changed';
    expect(setup.repository.notifications[0]!.id).not.toBe('changed');
  });
  it('rejects another recipient and revalidates withdrawn membership before writing', async () => {
    const setup = await fixture();
    await expect(
      setup.useCase.notifyReviewCompleted({ ...setup.payload, recipientUserIds: ['other'] }),
    ).rejects.toThrow('authorization');
    expect(await setup.repository.resolve(setup.payload)).toMatchObject({
      requesterHasActiveMembership: true,
    });
    await setup.memberships.removeMember({
      membershipId: setup.member.id,
      projectId,
      userId: student,
      removedAt: now,
    });
    await expect(
      setup.repository.persistAuthorized({ ...setup.payload, recipientUserId: student }),
    ).rejects.toThrow('authorization');
    expect(setup.repository.notifications).toEqual([]);
  });
  it('the default Maps API composition no longer emits the deferred-delivery error', async () => {
    const setup = await fixture();
    const pending = await setup.reviews.createRequest({
      projectId,
      requesterId: student,
      title: 'Pending review',
      description: 'Pending synthetic progress.',
    });
    const app = createApp({
      nodeEnv: 'test',
      reviewRepository: setup.reviews,
      membershipRepository: setup.memberships,
      teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(
        new Map([[teacher, [projectId]]]),
      ),
      authentication: async (context, next) => {
        context.set('user', { userId: teacher, role: 'teacher' });
        await next();
      },
    });
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await app.request(
        `/api/projects/${projectId}/reviews/${pending.id}/response`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'APPROVED', observation: 'Synthetic approval.' }),
        },
      );
      expect(response.status).toBe(200);
      expect(diagnostic).not.toHaveBeenCalled();
    } finally {
      diagnostic.mockRestore();
    }
  });
});
