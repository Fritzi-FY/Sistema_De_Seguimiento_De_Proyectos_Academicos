import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskActivityListResponseSchema,
  ProjectResponseSchema,
  BoardResponseSchema,
  TaskResponseSchema,
} from '@is488/shared';
import { createApp } from '../app.js';
import { InMemoryKanbanProjectStorage } from '../../adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryTaskActivityRepository } from '../../adapters/repositories/in-memory-task-activity.repository.js';
import { openApiSpec } from '../../openapi/openapi.contract.js';

const owner = {
  'X-Dev-User-Id': 'dev-student-01',
  'X-Dev-User-Role': 'student',
  'Content-Type': 'application/json',
};
const collaborator = '22222222-2222-4222-8222-222222222222';
const missing = '99999999-9999-4999-8999-999999999999';
const stamp = '2026-10-25T00:00:00.000Z';
describe('Task activity HTTP', () => {
  let app: ReturnType<typeof createApp>;
  let storage: InMemoryKanbanProjectStorage;
  let projectId: string;
  let taskId: string;
  let columnId: string;
  const url = () => `/api/projects/${projectId}/tasks/${taskId}/activity`;
  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    let tick = 0;
    app = createApp({
      nodeEnv: 'test',
      kanbanStorage: storage,
      clock: {
        now: () => new Date(stamp),
        isoString: () => new Date(Date.parse(stamp) + tick++).toISOString(),
      },
    });
    const project = await app.request('/api/projects', {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({
        title: 'Proyecto historial',
        courseCode: 'IS488',
        startDate: stamp,
        targetDate: stamp,
      }),
    });
    expect(project.status).toBe(201);
    projectId = ProjectResponseSchema.parse(await project.json()).id;
    columnId = BoardResponseSchema.parse(
      await (await app.request(`/api/projects/${projectId}/board`, { headers: owner })).json(),
    ).columns[0]!.id;
    const task = await app.request(`/api/projects/${projectId}/tasks`, {
      method: 'POST',
      headers: owner,
      body: JSON.stringify({ title: 'Actividad real', columnId }),
    });
    expect(task.status).toBe(201);
    taskId = TaskResponseSchema.parse(await task.json()).id;
  });
  it('returns actual CREATED/UPDATED events, schema, deterministic order and no effects', async () => {
    await app.request(`/api/projects/${projectId}/tasks/${taskId}`, {
      method: 'PATCH',
      headers: owner,
      body: JSON.stringify({ title: 'Actualizada' }),
    });
    const events = new InMemoryTaskActivityRepository(storage);
    for (const suffix of ['3', '2'])
      await events.recordEvent({
        id: `00000000-0000-4000-8000-00000000000${suffix}`,
        projectId,
        taskId,
        actorId: 'dev-student-01',
        action: 'MOVED',
        createdAt: '2099-01-01T00:00:00.000Z',
      });
    await events.recordEvent({ projectId: missing, taskId, actorId: 'other', action: 'CREATED' });
    const snapshot = storage.getSnapshot(projectId);
    const response = await app.request(url(), { headers: owner });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const data = TaskActivityListResponseSchema.parse(await response.json());
    expect(data.map((event) => event.action)).toEqual(['MOVED', 'MOVED', 'UPDATED', 'CREATED']);
    expect(data[0]!.id).toBe('00000000-0000-4000-8000-000000000002');
    expect(data.every((event) => event.projectId === projectId && event.taskId === taskId)).toBe(
      true,
    );
    expect(storage.getSnapshot(projectId)).toEqual(snapshot);
    expect(await (await app.request(url(), { headers: owner })).json()).toEqual(data);
  });
  it('returns real empty history for an existing task', async () => {
    const state = storage.getSnapshot(projectId);
    state.events = [];
    storage.commitSnapshot(projectId, state);
    expect(await (await app.request(url(), { headers: owner })).json()).toEqual([]);
  });
  it('requires auth, rejects malformed UUIDs and unsupported methods', async () => {
    expect((await app.request(url())).status).toBe(401);
    expect(
      (await app.request('/api/projects/bad/tasks/bad/activity', { headers: owner })).status,
    ).toBe(400);
    const method = await app.request(url(), { method: 'POST', headers: owner });
    expect(method.status).toBe(405);
    expect(method.headers.get('Allow')).toBe('GET');
    expect(
      (await createApp({ nodeEnv: 'production' }).request(url(), { headers: owner })).status,
    ).toBe(401);
  });
  it('uses identical 404 for non-member, unassigned teacher, missing project/task and wrong project task', async () => {
    const requests = [
      app.request(url(), { headers: { ...owner, 'X-Dev-User-Id': 'outsider' } }),
      app.request(url(), {
        headers: { ...owner, 'X-Dev-User-Id': 'teacher', 'X-Dev-User-Role': 'teacher' },
      }),
      app.request(`/api/projects/${missing}/tasks/${taskId}/activity`, { headers: owner }),
      app.request(`/api/projects/${projectId}/tasks/${missing}/activity`, { headers: owner }),
    ];
    const otherProject = ProjectResponseSchema.parse(
      await (
        await app.request('/api/projects', {
          method: 'POST',
          headers: owner,
          body: JSON.stringify({
            title: 'Otro proyecto',
            courseCode: 'IS488',
            startDate: stamp,
            targetDate: stamp,
          }),
        })
      ).json(),
    );
    requests.push(
      app.request(`/api/projects/${otherProject.id}/tasks/${taskId}/activity`, { headers: owner }),
    );
    for (const request of requests) {
      const res = await request;
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not Found', message: 'Recurso no encontrado' });
    }
  });
  it('allows active member and denies removed member', async () => {
    const memberUrl = `/api/projects/${projectId}/members`;
    expect(
      (
        await app.request(memberUrl, {
          method: 'POST',
          headers: owner,
          body: JSON.stringify({ userId: collaborator, role: 'collaborator' }),
        })
      ).status,
    ).toBe(201);
    const headers = { ...owner, 'X-Dev-User-Id': collaborator };
    expect((await app.request(url(), { headers })).status).toBe(200);
    await app.request(`${memberUrl}/${collaborator}`, { method: 'DELETE', headers: owner });
    expect((await app.request(url(), { headers })).status).toBe(404);
  });
  it('contains repository failures without exposing details', async () => {
    const failure = vi.spyOn(storage, 'getAllEvents').mockImplementation(() => {
      throw new Error('private');
    });
    try {
      const res = await app.request(url(), { headers: owner });
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    } finally {
      failure.mockRestore();
    }
  });
  it('documents path, schema and existing dev authentication in OpenAPI', () => {
    const endpoint = openApiSpec.paths['/api/projects/{projectId}/tasks/{taskId}/activity'].get;
    expect(endpoint.parameters.map((param) => param.schema.format)).toEqual(['uuid', 'uuid']);
    expect(Object.keys(endpoint.responses)).toEqual(['200', '400', '401', '404', '405', '500']);
    expect(endpoint.responses['200'].content['application/json'].schema.items.$ref).toBe(
      '#/components/schemas/TaskActivityResponse',
    );
    expect(openApiSpec.components.schemas.TaskActivityResponse.required).toContain('actorId');
  });
});
