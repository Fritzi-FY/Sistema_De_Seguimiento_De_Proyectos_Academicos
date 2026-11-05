import { describe, it, expect } from 'vitest';
import {
  canTransitionReview,
  assertValidReviewTransition,
  deriveReviewTimeline,
  InvalidReviewTransitionError,
  type TeacherReviewRequest,
  type TeacherReviewAction,
} from './review-repository.port.js';

describe('Review Domain: Transition Rules and Timeline Derivation', () => {
  describe('canTransitionReview and assertValidReviewTransition', () => {
    it('allows teacher to request changes from PENDING via TEACHER_RESPONSE', () => {
      expect(
        canTransitionReview('PENDING', 'CHANGES_REQUESTED', 'TEACHER_RESPONSE', 'teacher'),
      ).toBe(true);
      expect(() =>
        assertValidReviewTransition('PENDING', 'CHANGES_REQUESTED', 'TEACHER_RESPONSE', 'teacher'),
      ).not.toThrow();
    });

    it('allows teacher to approve from PENDING via TEACHER_RESPONSE', () => {
      expect(canTransitionReview('PENDING', 'APPROVED', 'TEACHER_RESPONSE', 'teacher')).toBe(true);
      expect(() =>
        assertValidReviewTransition('PENDING', 'APPROVED', 'TEACHER_RESPONSE', 'teacher'),
      ).not.toThrow();
    });

    it('allows student to resubmit from CHANGES_REQUESTED to PENDING via STUDENT_RESUBMISSION', () => {
      expect(
        canTransitionReview('CHANGES_REQUESTED', 'PENDING', 'STUDENT_RESUBMISSION', 'student'),
      ).toBe(true);
      expect(() =>
        assertValidReviewTransition(
          'CHANGES_REQUESTED',
          'PENDING',
          'STUDENT_RESUBMISSION',
          'student',
        ),
      ).not.toThrow();
    });

    it('supports two full correction cycles sequentially', () => {
      // Cycle 1
      expect(
        canTransitionReview('PENDING', 'CHANGES_REQUESTED', 'TEACHER_RESPONSE', 'teacher'),
      ).toBe(true);
      expect(
        canTransitionReview('CHANGES_REQUESTED', 'PENDING', 'STUDENT_RESUBMISSION', 'student'),
      ).toBe(true);
      // Cycle 2
      expect(
        canTransitionReview('PENDING', 'CHANGES_REQUESTED', 'TEACHER_RESPONSE', 'teacher'),
      ).toBe(true);
      expect(
        canTransitionReview('CHANGES_REQUESTED', 'PENDING', 'STUDENT_RESUBMISSION', 'student'),
      ).toBe(true);
      // Final approval
      expect(canTransitionReview('PENDING', 'APPROVED', 'TEACHER_RESPONSE', 'teacher')).toBe(true);
    });

    it('rejects student attempting TEACHER_RESPONSE', () => {
      expect(canTransitionReview('PENDING', 'APPROVED', 'TEACHER_RESPONSE', 'student')).toBe(false);
      expect(() =>
        assertValidReviewTransition('PENDING', 'APPROVED', 'TEACHER_RESPONSE', 'student'),
      ).toThrow(InvalidReviewTransitionError);
    });

    it('rejects teacher attempting STUDENT_RESUBMISSION', () => {
      expect(
        canTransitionReview('CHANGES_REQUESTED', 'PENDING', 'STUDENT_RESUBMISSION', 'teacher'),
      ).toBe(false);
      expect(() =>
        assertValidReviewTransition(
          'CHANGES_REQUESTED',
          'PENDING',
          'STUDENT_RESUBMISSION',
          'teacher',
        ),
      ).toThrow(InvalidReviewTransitionError);
    });

    it('rejects teacher attempting direct evaluation from CHANGES_REQUESTED without student resubmission', () => {
      expect(
        canTransitionReview('CHANGES_REQUESTED', 'APPROVED', 'TEACHER_RESPONSE', 'teacher'),
      ).toBe(false);
      expect(() =>
        assertValidReviewTransition('CHANGES_REQUESTED', 'APPROVED', 'TEACHER_RESPONSE', 'teacher'),
      ).toThrow(InvalidReviewTransitionError);
    });

    it('rejects any transition once review is in terminal state APPROVED', () => {
      expect(canTransitionReview('APPROVED', 'PENDING', 'STUDENT_RESUBMISSION', 'student')).toBe(
        false,
      );
      expect(
        canTransitionReview('APPROVED', 'CHANGES_REQUESTED', 'TEACHER_RESPONSE', 'teacher'),
      ).toBe(false);
      expect(canTransitionReview('APPROVED', 'APPROVED', 'TEACHER_RESPONSE', 'teacher')).toBe(
        false,
      );

      expect(() =>
        assertValidReviewTransition('APPROVED', 'PENDING', 'STUDENT_RESUBMISSION', 'student'),
      ).toThrow(InvalidReviewTransitionError);
    });

    it('rejects transition to identical state (no self-loops)', () => {
      expect(canTransitionReview('PENDING', 'PENDING', 'STUDENT_RESUBMISSION', 'student')).toBe(
        false,
      );
      expect(
        canTransitionReview(
          'CHANGES_REQUESTED',
          'CHANGES_REQUESTED',
          'TEACHER_RESPONSE',
          'teacher',
        ),
      ).toBe(false);
    });
  });

  describe('deriveReviewTimeline', () => {
    const mockRequest: TeacherReviewRequest = {
      id: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      requesterId: 'student-01',
      title: 'Entrega inicial de arquitectura',
      description: 'Se presenta el diagrama C4 y puertos hexagonales.',
      evidenceUrl: 'https://github.com/example/repo/pull/1',
      status: 'APPROVED',
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T14:00:00.000Z',
    };

    it('derives timeline with sequence 0 for inception and orders subsequent actions strictly by sequenceNumber', () => {
      // Deliberately unsorted in array and with identical timestamps to prove sequenceNumber is the true tiebreaker
      const mockActions: TeacherReviewAction[] = [
        {
          id: 'action-2',
          reviewRequestId: mockRequest.id,
          sequenceNumber: 2,
          actorId: 'student-01',
          actorRole: 'student',
          actionType: 'STUDENT_RESUBMISSION',
          status: 'PENDING',
          comment: 'Se corrigieron los puertos según observación.',
          evidenceUrl: 'https://github.com/example/repo/pull/1/commits/abc',
          createdAt: '2026-11-05T12:00:00.000Z',
        },
        {
          id: 'action-1',
          reviewRequestId: mockRequest.id,
          sequenceNumber: 1,
          actorId: 'teacher-01',
          actorRole: 'teacher',
          actionType: 'TEACHER_RESPONSE',
          status: 'CHANGES_REQUESTED',
          comment: 'Falta desacoplar el adaptador de notificación.',
          createdAt: '2026-11-05T12:00:00.000Z', // identical timestamp!
        },
        {
          id: 'action-3',
          reviewRequestId: mockRequest.id,
          sequenceNumber: 3,
          actorId: 'teacher-01',
          actorRole: 'teacher',
          actionType: 'TEACHER_RESPONSE',
          status: 'APPROVED',
          comment: 'Excelente desacoplamiento, aprobado.',
          createdAt: '2026-11-05T14:00:00.000Z',
        },
      ];

      const timeline = deriveReviewTimeline(mockRequest, mockActions);

      expect(timeline).toHaveLength(4);

      // Event 0: Inception
      expect(timeline[0]).toEqual({
        sequenceNumber: 0,
        actionType: 'INITIAL_REQUEST',
        actorId: 'student-01',
        actorRole: 'student',
        status: 'PENDING',
        comment: 'Se presenta el diagrama C4 y puertos hexagonales.',
        evidenceUrl: 'https://github.com/example/repo/pull/1',
        createdAt: '2026-11-05T10:00:00.000Z',
      });

      // Event 1: Teacher response (sequence 1)
      expect(timeline[1]!.sequenceNumber).toBe(1);
      expect(timeline[1]!.actionType).toBe('TEACHER_RESPONSE');
      expect(timeline[1]!.actorId).toBe('teacher-01');
      expect(timeline[1]!.status).toBe('CHANGES_REQUESTED');

      // Event 2: Student resubmission (sequence 2)
      expect(timeline[2]!.sequenceNumber).toBe(2);
      expect(timeline[2]!.actionType).toBe('STUDENT_RESUBMISSION');
      expect(timeline[2]!.actorId).toBe('student-01');
      expect(timeline[2]!.status).toBe('PENDING');

      // Event 3: Teacher approval (sequence 3)
      expect(timeline[3]!.sequenceNumber).toBe(3);
      expect(timeline[3]!.actionType).toBe('TEACHER_RESPONSE');
      expect(timeline[3]!.actorId).toBe('teacher-01');
      expect(timeline[3]!.status).toBe('APPROVED');
    });

    it('derives timeline with only inception when no actions exist yet', () => {
      const pendingRequest: TeacherReviewRequest = {
        ...mockRequest,
        status: 'PENDING',
      };

      const timeline = deriveReviewTimeline(pendingRequest, []);
      expect(timeline).toHaveLength(1);
      expect(timeline[0]!.sequenceNumber).toBe(0);
      expect(timeline[0]!.actionType).toBe('INITIAL_REQUEST');
      expect(timeline[0]!.actorId).toBe('student-01');
      expect(timeline[0]!.status).toBe('PENDING');
    });

    it('always preserves PENDING in initial timeline entry even when current request status is CHANGES_REQUESTED or APPROVED', () => {
      const approvedRequest: TeacherReviewRequest = {
        ...mockRequest,
        status: 'APPROVED',
      };
      const changesRequestedRequest: TeacherReviewRequest = {
        ...mockRequest,
        status: 'CHANGES_REQUESTED',
      };

      const timelineApproved = deriveReviewTimeline(approvedRequest, []);
      expect(timelineApproved[0]!.status).toBe('PENDING');

      const timelineChanges = deriveReviewTimeline(changesRequestedRequest, []);
      expect(timelineChanges[0]!.status).toBe('PENDING');
    });
  });
});
