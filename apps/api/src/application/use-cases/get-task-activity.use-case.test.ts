import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetTaskActivityUseCase } from './get-task-activity.use-case.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryTaskRepository } from '../../infrastructure/adapters/repositories/in-memory-task.repository.js';
import { InMemoryTaskActivityRepository } from '../../infrastructure/adapters/repositories/in-memory-task-activity.repository.js';
const stamp = '2026-10-25T00:00:00.000Z';
function setup() {
  const projects = new InMemoryProjectRepository();
  const memberships = new InMemoryMembershipRepository();
  const tasks = new InMemoryTaskRepository();
  const activity = new InMemoryTaskActivityRepository();
  const project = vi.spyOn(projects, 'findById').mockResolvedValue({
    id: 'project',
    title: 'Proyecto',
    courseCode: 'IS488',
    status: 'active',
    creatorId: 'owner',
    startDate: stamp,
    targetDate: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const member = vi.spyOn(memberships, 'findByProjectAndUser').mockResolvedValue(null);
  const task = vi.spyOn(tasks, 'findById').mockResolvedValue({
    id: 'task',
    projectId: 'project',
    columnId: 'column',
    title: 'Tarea',
    priority: 'MEDIUM',
    orderIndex: 0,
    labels: [],
    assigneeIds: [],
    creatorId: 'owner',
    createdAt: stamp,
    updatedAt: stamp,
  });
  const events = vi.spyOn(activity, 'findByTaskId').mockResolvedValue([]);
  return {
    useCase: new GetTaskActivityUseCase(projects, memberships, tasks, activity),
    project,
    member,
    task,
    events,
  };
}
afterEach(() => vi.restoreAllMocks());
describe('GetTaskActivityUseCase boundaries', () => {
  it('does not read tasks or events for denied access', async () => {
    const fixture = setup();
    await expect(
      fixture.useCase.execute({ projectId: 'project', taskId: 'task', requesterId: 'outsider' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(fixture.task).not.toHaveBeenCalled();
    expect(fixture.events).not.toHaveBeenCalled();
  });
  it('does not read events for a missing task', async () => {
    const fixture = setup();
    fixture.task.mockResolvedValueOnce(null);
    await expect(
      fixture.useCase.execute({ projectId: 'project', taskId: 'task', requesterId: 'owner' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(fixture.events).not.toHaveBeenCalled();
  });
  it('filters a faulty port response and deterministically breaks equal timestamp ties', async () => {
    const fixture = setup();
    const event = {
      id: 'b',
      projectId: 'project',
      taskId: 'task',
      actorId: 'owner',
      action: 'CREATED' as const,
      createdAt: stamp,
    };
    fixture.events.mockResolvedValueOnce([
      { ...event, projectId: 'other' },
      { ...event, taskId: 'other' },
      event,
      { ...event, id: 'a' },
    ]);
    const result = await fixture.useCase.execute({
      projectId: 'project',
      taskId: 'task',
      requesterId: 'owner',
    });
    expect(result.map((value) => value.id)).toEqual(['a', 'b']);
  });
});
