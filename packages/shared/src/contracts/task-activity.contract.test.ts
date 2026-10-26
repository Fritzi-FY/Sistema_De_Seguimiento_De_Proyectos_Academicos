import { describe, expect, it } from 'vitest';
import { TaskActivityListResponseSchema, CreateTaskSchema } from './task.contract.js';
import { MembershipResponseSchema } from './membership.contract.js';

const id = '11111111-1111-4111-8111-111111111111';
const stamp = '2026-10-25T00:00:00.000Z';
const event = {
  id,
  taskId: id,
  projectId: id,
  actorId: 'dev-student-01',
  action: 'CREATED',
  createdAt: stamp,
};
describe('Activity list contract and identity boundary', () => {
  it('accepts actual dev actor IDs and an empty history without changing assignee UUIDs', () => {
    expect(TaskActivityListResponseSchema.parse([event])).toEqual([event]);
    expect(TaskActivityListResponseSchema.parse([])).toEqual([]);
    expect(
      MembershipResponseSchema.safeParse({
        id,
        projectId: id,
        userId: 'dev-student-01',
        role: 'owner',
        status: 'active',
        joinedAt: stamp,
        updatedAt: stamp,
      }).success,
    ).toBe(true);
    expect(
      CreateTaskSchema.safeParse({ title: 'Tarea', columnId: id, assigneeIds: ['dev-student-01'] })
        .success,
    ).toBe(false);
  });
  it.each([
    { ...event, taskId: 'bad' },
    { ...event, action: 'INVENTED' },
    { ...event, createdAt: 'yesterday' },
    { ...event, actorId: '' },
  ])('rejects malformed events', (value) => {
    expect(TaskActivityListResponseSchema.safeParse([value]).success).toBe(false);
  });
});
