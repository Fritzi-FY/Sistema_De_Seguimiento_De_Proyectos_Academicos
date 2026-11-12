import { describe, expect, it, vi } from 'vitest';
import { PostgresqlReviewRepository } from './review.repository.js';
import type { SqlSession } from './session.js';

describe('PostgresqlReviewRepository response result (simulated SQL session)', () => {
  it.each([false, true])(
    'returns the inserted action identity only after transaction success; commit failure=%s',
    async (commitFails) => {
      const row = {
        id: '11111111-1111-4111-8111-111111111111',
        project_id: '22222222-2222-4222-8222-222222222222',
        requester_id: 'student',
        title: 'Review',
        description: 'Description',
        evidence_url: null,
        status: 'PENDING',
        created_at: '2026-11-10T00:00:00.000Z',
        updated_at: '2026-11-10T00:00:00.000Z',
      };
      let insertedActionId: unknown;
      let committed = false;
      const query = vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql.includes('INSERT INTO public.teacher_review_actions')) {
          insertedActionId = values?.[0];
          return { rows: [] };
        }
        if (sql.includes('MAX(sequence_number)')) return { rows: [{ next_seq: 1 }] };
        if (sql.includes('UPDATE public.teacher_review_requests'))
          return { rows: [{ ...row, status: 'APPROVED' }] };
        return { rows: [row] };
      });
      const failure = new Error('Commit not confirmed');
      const session = {
        query,
        transaction: async (work: () => Promise<unknown>) => {
          const result = await work();
          if (commitFails) throw failure;
          committed = true;
          return result;
        },
      } as unknown as SqlSession;
      const repository = new PostgresqlReviewRepository(() => session);
      const result = repository.recordTeacherResponse(row.project_id, row.id, {
        reviewerId: 'teacher',
        status: 'APPROVED',
        observation: 'Approved review',
      });
      if (commitFails) {
        await expect(result).rejects.toBe(failure);
        expect(committed).toBe(false);
      } else {
        expect(await result).toMatchObject({
          responseActionId: insertedActionId,
          status: 'APPROVED',
        });
        expect(committed).toBe(true);
      }
      expect(typeof insertedActionId).toBe('string');
      expect(query).toHaveBeenCalledTimes(4);
    },
  );
});
