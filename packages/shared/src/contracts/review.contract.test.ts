import { describe, it, expect } from 'vitest';
import {
  CreateReviewRequestSchema,
  RespondReviewRequestSchema,
  ResubmitReviewRequestSchema,
  ReviewActionResponseSchema,
  ReviewTimelineEntryResponseSchema,
  ReviewDetailResponseSchema,
  ReviewListResponseSchema,
  ReviewStatusSchema,
} from './review.contract.js';

describe('Review Contracts: Zod Schemas and Input Validations', () => {
  describe('ReviewStatusSchema', () => {
    it('accepts valid statuses', () => {
      expect(ReviewStatusSchema.parse('PENDING')).toBe('PENDING');
      expect(ReviewStatusSchema.parse('CHANGES_REQUESTED')).toBe('CHANGES_REQUESTED');
      expect(ReviewStatusSchema.parse('APPROVED')).toBe('APPROVED');
    });

    it('rejects invalid statuses', () => {
      expect(() => ReviewStatusSchema.parse('IN_REVIEW')).toThrow();
      expect(() => ReviewStatusSchema.parse('REJECTED')).toThrow();
      expect(() => ReviewStatusSchema.parse('')).toThrow();
    });
  });

  describe('CreateReviewRequestSchema', () => {
    const validPayload = {
      title: 'Revisión de arquitectura hexagonal',
      description: 'Se implementaron los puertos y adaptadores para la base de datos.',
      evidenceUrl: 'https://github.com/example/repo/pull/12',
    };

    it('accepts valid payload with evidenceUrl', () => {
      const parsed = CreateReviewRequestSchema.parse(validPayload);
      expect(parsed.title).toBe(validPayload.title);
      expect(parsed.description).toBe(validPayload.description);
      expect(parsed.evidenceUrl).toBe(validPayload.evidenceUrl);
    });

    it('accepts valid payload without optional evidenceUrl', () => {
      const parsed = CreateReviewRequestSchema.parse({
        title: 'Revisión sin enlace externo',
        description: 'Avance general del sprint sin enlaces externos requeridos.',
      });
      expect(parsed.title).toBe('Revisión sin enlace externo');
      expect(parsed.evidenceUrl).toBeUndefined();
    });

    it('trims whitespace on title and description', () => {
      const parsed = CreateReviewRequestSchema.parse({
        title: '   Espacios recortados   ',
        description: '   Descripción con espacios al inicio y al final.   ',
      });
      expect(parsed.title).toBe('Espacios recortados');
      expect(parsed.description).toBe('Descripción con espacios al inicio y al final.');
    });

    it('rejects title shorter than 3 characters', () => {
      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          title: 'Ab',
        }),
      ).toThrow(/al menos 3 caracteres/);
    });

    it('rejects title longer than 120 characters', () => {
      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          title: 'A'.repeat(121),
        }),
      ).toThrow(/no puede exceder 120 caracteres/);
    });

    it('rejects description shorter than 10 characters', () => {
      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          description: 'Demasiado',
        }),
      ).toThrow(/al menos 10 caracteres/);
    });

    it('rejects description longer than 2000 characters', () => {
      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          description: 'A'.repeat(2001),
        }),
      ).toThrow(/no puede exceder 2000 caracteres/);
    });

    it('rejects malformed evidenceUrl', () => {
      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          evidenceUrl: 'not-a-valid-url',
        }),
      ).toThrow(/URL válida/);
    });

    it('strictly rejects any client-provided status (status is determined solely by server as PENDING)', () => {
      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          status: 'PENDING',
        }),
      ).toThrow(/unrecognized_key/i);

      expect(() =>
        CreateReviewRequestSchema.parse({
          ...validPayload,
          status: 'APPROVED',
        }),
      ).toThrow(/unrecognized_key/i);
    });

    it('STRICT: rejects server-controlled fields injected by client', () => {
      const serverControlledInjections = [
        { id: '11111111-1111-4111-8111-111111111111' },
        { requesterId: 'hacked-student-id' },
        { projectId: '22222222-2222-4222-8222-222222222222' },
        { status: 'APPROVED' },
        { createdAt: '2026-11-05T00:00:00.000Z' },
        { updatedAt: '2026-11-05T00:00:00.000Z' },
        { sequenceNumber: 99 },
      ];

      for (const injection of serverControlledInjections) {
        expect(() =>
          CreateReviewRequestSchema.parse({
            ...validPayload,
            ...injection,
          }),
        ).toThrow(/unrecognized_key/i);
      }
    });
  });

  describe('RespondReviewRequestSchema', () => {
    it('accepts valid CHANGES_REQUESTED with observation', () => {
      const parsed = RespondReviewRequestSchema.parse({
        status: 'CHANGES_REQUESTED',
        observation: 'Corregir la separación de capas en los controladores.',
      });
      expect(parsed.status).toBe('CHANGES_REQUESTED');
      expect(parsed.observation).toBe('Corregir la separación de capas en los controladores.');
    });

    it('accepts valid APPROVED with observation', () => {
      const parsed = RespondReviewRequestSchema.parse({
        status: 'APPROVED',
        observation: 'Excelente diseño arquitectónico, todo conforme.',
      });
      expect(parsed.status).toBe('APPROVED');
    });

    it('rejects PENDING in teacher response (only APPROVED or CHANGES_REQUESTED allowed)', () => {
      expect(() =>
        RespondReviewRequestSchema.parse({
          status: 'PENDING',
          observation: 'Observación válida pero estado inválido.',
        }),
      ).toThrow(/APPROVED o CHANGES_REQUESTED/);
    });

    it('rejects observation shorter than 5 characters', () => {
      expect(() =>
        RespondReviewRequestSchema.parse({
          status: 'CHANGES_REQUESTED',
          observation: 'Mal',
        }),
      ).toThrow(/al menos 5 caracteres/);
    });

    it('rejects observation longer than 2000 characters', () => {
      expect(() =>
        RespondReviewRequestSchema.parse({
          status: 'APPROVED',
          observation: 'O'.repeat(2001),
        }),
      ).toThrow(/no puede exceder 2000 caracteres/);
    });

    it('STRICT: rejects server-controlled fields in teacher response', () => {
      const invalidInjections = [
        { reviewerId: 'forged-teacher-id' },
        { sequenceNumber: 1 },
        { actionType: 'TEACHER_RESPONSE' },
        { createdAt: '2026-11-05T12:00:00.000Z' },
        { actorRole: 'teacher' },
      ];

      for (const injection of invalidInjections) {
        expect(() =>
          RespondReviewRequestSchema.parse({
            status: 'APPROVED',
            observation: 'Observación pedagógica válida.',
            ...injection,
          }),
        ).toThrow(/unrecognized_key/i);
      }
    });
  });

  describe('ResubmitReviewRequestSchema', () => {
    const validResubmit = {
      description: 'Se aplicaron las correcciones sugeridas en el controlador HTTP.',
      evidenceUrl: 'https://github.com/example/repo/commit/123456',
    };

    it('accepts valid resubmission payload', () => {
      const parsed = ResubmitReviewRequestSchema.parse(validResubmit);
      expect(parsed.description).toBe(validResubmit.description);
      expect(parsed.evidenceUrl).toBe(validResubmit.evidenceUrl);
    });

    it('accepts resubmission without optional evidenceUrl', () => {
      const parsed = ResubmitReviewRequestSchema.parse({
        description: 'Ajustes menores realizados en la lógica de negocio.',
      });
      expect(parsed.description).toBe('Ajustes menores realizados en la lógica de negocio.');
      expect(parsed.evidenceUrl).toBeUndefined();
    });

    it('rejects description shorter than 10 characters', () => {
      expect(() =>
        ResubmitReviewRequestSchema.parse({
          description: 'Ajustes',
        }),
      ).toThrow(/al menos 10 caracteres/);
    });

    it('strictly rejects any client-provided status (status is determined solely by server as PENDING)', () => {
      expect(() =>
        ResubmitReviewRequestSchema.parse({
          ...validResubmit,
          status: 'PENDING',
        }),
      ).toThrow(/unrecognized_key/i);

      expect(() =>
        ResubmitReviewRequestSchema.parse({
          ...validResubmit,
          status: 'CHANGES_REQUESTED',
        }),
      ).toThrow(/unrecognized_key/i);
    });

    it('STRICT: rejects server-controlled fields in resubmission', () => {
      const invalidInjections = [
        { status: 'PENDING' },
        { actorId: 'forged-student' },
        { sequenceNumber: 2 },
        { createdAt: '2026-11-05T13:00:00.000Z' },
        { actorRole: 'student' },
      ];

      for (const injection of invalidInjections) {
        expect(() =>
          ResubmitReviewRequestSchema.parse({
            description: 'Descripción válida de ajustes aplicados.',
            ...injection,
          }),
        ).toThrow(/unrecognized_key/i);
      }
    });
  });

  describe('Response Schemas Validation', () => {
    const sampleAction = {
      id: '11111111-1111-4111-8111-111111111111',
      reviewRequestId: '22222222-2222-4222-8222-222222222222',
      sequenceNumber: 1,
      actorId: 'teacher-01',
      actorRole: 'teacher' as const,
      actionType: 'TEACHER_RESPONSE' as const,
      status: 'CHANGES_REQUESTED' as const,
      comment: 'Falta documentación de contratos.',
      evidenceUrl: undefined,
      createdAt: '2026-11-05T11:00:00.000Z',
    };

    const sampleTimelineEntry = {
      sequenceNumber: 0,
      actionType: 'INITIAL_REQUEST' as const,
      actorId: 'student-01',
      actorRole: 'student' as const,
      status: 'PENDING' as const,
      comment: 'Avance inicial presentado.',
      evidenceUrl: 'https://example.com/doc',
      createdAt: '2026-11-05T10:00:00.000Z',
    };

    const sampleSummary = {
      id: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
      requesterId: 'student-01',
      title: 'Entrega Sprint 1',
      description: 'Avance inicial presentado.',
      evidenceUrl: 'https://example.com/doc',
      status: 'CHANGES_REQUESTED' as const,
      createdAt: '2026-11-05T10:00:00.000Z',
      updatedAt: '2026-11-05T11:00:00.000Z',
    };

    it('validates ReviewActionResponseSchema', () => {
      const parsed = ReviewActionResponseSchema.parse(sampleAction);
      expect(parsed.sequenceNumber).toBe(1);
      expect(parsed.actorRole).toBe('teacher');
    });

    it('rejects ReviewActionResponseSchema if sequenceNumber < 1', () => {
      expect(() =>
        ReviewActionResponseSchema.parse({
          ...sampleAction,
          sequenceNumber: 0,
        }),
      ).toThrow(/número de secuencia debe ser >= 1/);
    });

    it('validates ReviewTimelineEntryResponseSchema', () => {
      const parsed = ReviewTimelineEntryResponseSchema.parse(sampleTimelineEntry);
      expect(parsed.sequenceNumber).toBe(0);
      expect(parsed.actionType).toBe('INITIAL_REQUEST');
    });

    it('validates ReviewDetailResponseSchema with actions and derived timeline', () => {
      const detailPayload = {
        ...sampleSummary,
        actions: [sampleAction],
        timeline: [
          sampleTimelineEntry,
          {
            sequenceNumber: 1,
            actionType: 'TEACHER_RESPONSE' as const,
            actorId: 'teacher-01',
            actorRole: 'teacher' as const,
            status: 'CHANGES_REQUESTED' as const,
            comment: 'Falta documentación de contratos.',
            evidenceUrl: undefined,
            createdAt: '2026-11-05T11:00:00.000Z',
          },
        ],
      };

      const parsed = ReviewDetailResponseSchema.parse(detailPayload);
      expect(parsed.id).toBe(sampleSummary.id);
      expect(parsed.actions).toHaveLength(1);
      expect(parsed.timeline).toHaveLength(2);
    });

    it('validates ReviewListResponseSchema', () => {
      const listPayload = [sampleSummary];
      const parsed = ReviewListResponseSchema.parse(listPayload);
      expect(parsed).toHaveLength(1);
      expect(parsed[0]!.id).toBe(sampleSummary.id);
    });
  });
});
