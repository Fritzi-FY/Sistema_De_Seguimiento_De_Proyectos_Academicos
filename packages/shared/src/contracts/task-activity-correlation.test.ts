import { describe, expect, it } from 'vitest';
import {
  normalizeTaskActivityCorrelation,
  TaskActivityCorrelationIdSchema,
} from './task-activity-correlation.js';
import { TaskActivityListResponseSchema } from './task.contract.js';

const correlationId = 'abcdefab-1234-4abc-8def-123456789abc';
const event = {
  id: '11111111-1111-4111-8111-111111111111',
  taskId: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  actorId: 'dev-student-01',
  action: 'CREATED',
  createdAt: '2026-11-14T15:00:00.000Z',
};

describe('Task activity correlation boundary', () => {
  it.each([correlationId, correlationId.toUpperCase()])(
    'normalizes a valid UUID without changing activity identity or timestamps',
    (value) => {
      expect(normalizeTaskActivityCorrelation(value)).toEqual({ correlationId });
      expect(TaskActivityCorrelationIdSchema.parse(value)).toBe(correlationId);
      expect(TaskActivityListResponseSchema.parse([{ ...event, correlationId: value }])).toEqual([
        { ...event, correlationId },
      ]);
    },
  );

  it.each([
    undefined,
    null,
    '',
    ' ',
    'not-a-uuid',
    'x'.repeat(36),
    'a'.repeat(1000),
    ` ${correlationId}`,
    `${correlationId} `,
    `${correlationId},${correlationId}`,
    `Bearer ${correlationId}`,
    123,
    [correlationId],
    { correlationId },
  ])('omits unusable metadata without retaining the input', (value) => {
    expect(normalizeTaskActivityCorrelation(value)).toEqual({});
    expect(TaskActivityCorrelationIdSchema.safeParse(value).success).toBe(false);
  });

  it('preserves historic events with no correlation field', () => {
    const historic = structuredClone(event);
    const parsed = TaskActivityListResponseSchema.parse([historic]);
    expect(parsed).toEqual([historic]);
    expect(parsed[0]).not.toHaveProperty('correlationId');
    expect(historic).toEqual(event);
  });

  it.each(['', 'not-a-uuid', null, `${correlationId},${correlationId}`])(
    'rejects malformed correlation in an activity response',
    (value) => {
      expect(
        TaskActivityListResponseSchema.safeParse([{ ...event, correlationId: value }]).success,
      ).toBe(false);
    },
  );
});
