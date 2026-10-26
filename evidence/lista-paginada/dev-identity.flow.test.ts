import { afterEach, expect, it, vi } from 'vitest';
import { createApp } from '../../apps/api/src/infrastructure/http/app.js';
import { DEV_IDENTITIES } from '../../apps/web/src/services/dev-identity.js';
import { createProject, fetchProjects } from '../../apps/web/src/services/project.service.js';
import {
  getMembers,
  addMember,
  removeMember,
} from '../../apps/web/src/services/membership.service.js';
import { getBoard } from '../../apps/web/src/services/board.service.js';
import {
  createTask,
  updateTask,
  getTaskActivity,
  getTasks,
} from '../../apps/web/src/services/task.service.js';

afterEach(() => vi.unstubAllGlobals());

it('uses stable dev UUIDs through real services, HTTP, memberships, assignments and activity', async () => {
  const app = createApp({ nodeEnv: 'test' });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => app.request(url, init));
  const { student, otherStudent, teacher } = DEV_IDENTITIES;
  expect(new Set(Object.values(DEV_IDENTITIES).map((user) => user.userId)).size).toBe(3);
  const input = {
    title: 'Identidades UUID desarrollo',
    courseCode: 'IS488',
    startDate: '2026-10-26T00:00:00.000Z',
    targetDate: '2026-12-26T00:00:00.000Z',
  };
  const project = await createProject(input);
  expect(project.creatorId).toBe(student.userId);
  expect(await getMembers(project.id)).toEqual([
    expect.objectContaining({ userId: student.userId, role: 'owner', status: 'active' }),
  ]);
  expect(await fetchProjects(otherStudent)).toEqual([]);
  await expect(getBoard(project.id, otherStudent)).rejects.toThrow();
  await expect(getTaskActivity(project.id, project.id, teacher)).rejects.toThrow();
  const member = await addMember(project.id, { userId: otherStudent.userId, role: 'collaborator' });
  expect(member).toMatchObject({ userId: otherStudent.userId, status: 'active' });
  await expect(
    addMember(project.id, { userId: teacher.userId, role: 'collaborator' }, otherStudent),
  ).rejects.toThrow();
  const board = await getBoard(project.id);
  const task = await createTask(project.id, {
    title: 'Asignada al crear',
    columnId: board.columns[0]!.id,
    assigneeIds: [student.userId],
  });
  expect(task.assigneeIds).toEqual([student.userId]);
  const edited = await updateTask(project.id, task.id, { assigneeIds: [otherStudent.userId] });
  expect(edited.assigneeIds).toEqual([otherStudent.userId]);
  expect(
    (await getTasks(project.id, { assigneeId: otherStudent.userId, page: 1, limit: 20 })).items.map(
      (item) => item.id,
    ),
  ).toEqual([task.id]);
  expect(
    (await getTasks(project.id, { assigneeId: student.userId, page: 1, limit: 20 })).totalItems,
  ).toBe(0);
  const history = await getTaskActivity(project.id, task.id);
  expect(history.map((event) => event.action).sort()).toEqual(['CREATED', 'UPDATED']);
  expect(history.every((event) => event.actorId === student.userId)).toBe(true);
  expect(history.find((event) => event.action === 'CREATED')!.details?.assigneeIds).toEqual([
    student.userId,
  ]);
  expect(history.find((event) => event.action === 'UPDATED')!.details?.assigneeIds).toEqual({
    from: [student.userId],
    to: [otherStudent.userId],
  });
  expect(await getTaskActivity(project.id, task.id, otherStudent)).toEqual(history);
  await expect(getTaskActivity(project.id, task.id, teacher)).rejects.toThrow();
  await expect(
    updateTask(project.id, task.id, { assigneeIds: [teacher.userId] }),
  ).rejects.toThrow();
  await expect(
    updateTask(project.id, task.id, { assigneeIds: ['dev-student-01'] }),
  ).rejects.toThrow();
  await removeMember(project.id, otherStudent.userId);
  await expect(
    updateTask(project.id, task.id, { assigneeIds: [otherStudent.userId, student.userId] }),
  ).rejects.toThrow();
  await expect(getTaskActivity(project.id, task.id, otherStudent)).rejects.toThrow();
  expect(await getTaskActivity(project.id, task.id)).toEqual(history);
  const legacy = await createProject(input, { userId: 'dev-student-01', role: 'student' });
  expect(legacy.creatorId).toBe('dev-student-01');
  expect((await getMembers(legacy.id, { userId: 'dev-student-01' }))[0]!.userId).toBe(
    'dev-student-01',
  );
  expect((await fetchProjects()).map((item) => item.id)).toEqual([project.id]);
  const production = createApp({ nodeEnv: 'production' });
  expect(
    (
      await production.request('/api/projects', {
        headers: { 'X-Dev-User-Id': student.userId, 'X-Dev-User-Role': student.role },
      })
    ).status,
  ).toBe(401);
});
