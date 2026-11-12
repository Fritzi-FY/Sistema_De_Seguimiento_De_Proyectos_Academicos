import { describe, expect, it, vi } from 'vitest';
import type { ReviewNotificationContext, ReviewNotificationPayload } from '@is488/shared';
import { PersistReviewNotificationUseCase } from './persist-review-notification.use-case.js';

function fixture() {
  const payload: ReviewNotificationPayload = {
    responseActionId: 'response-1',
    projectId: 'project-1',
    reviewId: 'review-1',
    reviewerId: 'teacher-1',
    status: 'CHANGES_REQUESTED',
    recipientUserIds: ['student-1'],
  };
  const context: ReviewNotificationContext = {
    review: {
      id: 'review-1',
      projectId: 'project-1',
      requesterId: 'student-1',
      title: 'Review',
      description: 'Private description',
      status: 'APPROVED',
      createdAt: '2026-11-10T00:00:00.000Z',
      updatedAt: '2026-11-10T00:00:00.000Z',
    },
    action: {
      id: 'response-1',
      reviewRequestId: 'review-1',
      sequenceNumber: 1,
      actorId: 'teacher-1',
      actorRole: 'teacher',
      actionType: 'TEACHER_RESPONSE',
      status: 'CHANGES_REQUESTED',
      comment: 'Private observation',
      createdAt: '2026-11-10T00:00:00.000Z',
    },
    requesterHasActiveMembership: true,
    requesterCanQueryReview: true,
  };
  const resolver = { resolve: vi.fn().mockResolvedValue(context) };
  const store = { persistAuthorized: vi.fn().mockResolvedValue(undefined) };
  const useCase = new PersistReviewNotificationUseCase(resolver, store);
  return { payload, context, resolver, store, useCase };
}

describe('PersistReviewNotificationUseCase', () => {
  it('passes only minimal metadata for an authorized historical response', async () => {
    const setup = fixture();
    await setup.useCase.notifyReviewCompleted(setup.payload);
    expect(setup.store.persistAuthorized).toHaveBeenCalledTimes(1);
    expect(setup.store.persistAuthorized).toHaveBeenCalledWith({
      responseActionId: 'response-1',
      recipientUserId: 'student-1',
      projectId: 'project-1',
      reviewId: 'review-1',
      reviewerId: 'teacher-1',
      status: 'CHANGES_REQUESTED',
    });
  });

  it.each([
    'other recipient',
    'multiple recipients',
    'no recipient',
    'inactive',
    'no query permission',
    'project',
    'review',
    'action identity',
    'action review',
    'action type',
    'actor role',
    'actor',
    'status',
  ])('does not store invalid context: %s', async (scenario) => {
    const setup = fixture();
    switch (scenario) {
      case 'other recipient':
        setup.payload.recipientUserIds = ['other'];
        break;
      case 'multiple recipients':
        setup.payload.recipientUserIds = ['student-1', 'other'];
        break;
      case 'no recipient':
        setup.payload.recipientUserIds = [];
        break;
      case 'inactive':
        setup.context.requesterHasActiveMembership = false;
        break;
      case 'no query permission':
        setup.context.requesterCanQueryReview = false;
        break;
      case 'project':
        setup.context.review.projectId = 'foreign';
        break;
      case 'review':
        setup.context.review.id = 'foreign';
        break;
      case 'action identity':
        setup.context.action.id = 'foreign';
        break;
      case 'action review':
        setup.context.action.reviewRequestId = 'foreign';
        break;
      case 'action type':
        setup.context.action.actionType = 'STUDENT_RESUBMISSION';
        break;
      case 'actor role':
        setup.context.action.actorRole = 'student';
        break;
      case 'actor':
        setup.context.action.actorId = 'foreign';
        break;
      case 'status':
        setup.context.action.status = 'APPROVED';
        break;
    }
    await expect(setup.useCase.notifyReviewCompleted(setup.payload)).rejects.toThrow(
      'authorization',
    );
    expect(setup.store.persistAuthorized).not.toHaveBeenCalled();
  });

  it('does not store without a confirmed source', async () => {
    const setup = fixture();
    setup.resolver.resolve.mockResolvedValue(null);
    await expect(setup.useCase.notifyReviewCompleted(setup.payload)).rejects.toThrow(
      'authorization',
    );
    expect(setup.store.persistAuthorized).not.toHaveBeenCalled();
  });

  it('propagates permission lookup failure without storing or retrying', async () => {
    const setup = fixture();
    const failure = new Error('Unavailable');
    setup.resolver.resolve.mockRejectedValue(failure);
    await expect(setup.useCase.notifyReviewCompleted(setup.payload)).rejects.toBe(failure);
    expect(setup.resolver.resolve).toHaveBeenCalledTimes(1);
    expect(setup.store.persistAuthorized).not.toHaveBeenCalled();
  });

  it.each(['rolled_back', 'unknown'])(
    'propagates %s storage failure without retries',
    async (outcome) => {
      const setup = fixture();
      const failure = Object.assign(new Error('Storage unavailable'), { outcome });
      setup.store.persistAuthorized.mockRejectedValue(failure);
      await expect(setup.useCase.notifyReviewCompleted(setup.payload)).rejects.toBe(failure);
      expect(setup.store.persistAuthorized).toHaveBeenCalledTimes(1);
      expect(setup.resolver.resolve).toHaveBeenCalledTimes(1);
    },
  );
});
