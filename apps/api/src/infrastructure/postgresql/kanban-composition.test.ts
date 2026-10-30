import { it, expect } from 'vitest';
import { createApp } from '../http/app.js';
import type { ProjectResponse, BoardResponse, TaskResponse } from '@is488/shared';

it('explicit Maps mode retains ordered and repeated assignees without SQL', async () => {
  const app = createApp({ nodeEnv: 'test', persistence: { mode: 'memory' } });
  const owner = '11111111-1111-4111-8111-111111111111',
    member = '22222222-2222-4222-8222-222222222222';
  async function request<T>(method: string, path: string, body?: unknown, status = 200) {
    const response = await app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': owner },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(response.status).toBe(status);
    return (await response.json()) as T;
  }
  const project = await request<ProjectResponse>(
    'POST',
    '/api/projects',
    {
      title: 'Explicit Maps compatibility',
      courseCode: 'IS488',
      startDate: '2026-10-28T00:00:00.000Z',
      targetDate: '2026-12-31T00:00:00.000Z',
    },
    201,
  );
  const path = '/api/projects/' + project.id;
  await request('POST', path + '/members', { userId: member, role: 'collaborator' }, 201);
  const board = await request<BoardResponse>('GET', path + '/board');
  const assigneeIds = [member, owner, member];
  const task = await request<TaskResponse>(
    'POST',
    path + '/tasks',
    { title: 'Repeated assignee compatibility', columnId: board.columns[0]!.id, assigneeIds },
    201,
  );
  expect(task.assigneeIds).toEqual(assigneeIds);
});
