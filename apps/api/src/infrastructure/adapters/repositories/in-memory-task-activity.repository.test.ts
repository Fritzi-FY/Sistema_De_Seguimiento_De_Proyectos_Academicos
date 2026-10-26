import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskActivityRepository } from './in-memory-task-activity.repository.js';
import { InMemoryKanbanProjectStorage } from './in-memory-kanban-project.storage.js';

describe('InMemoryTaskActivityRepository', () => {
  let storage: InMemoryKanbanProjectStorage;
  let repository: InMemoryTaskActivityRepository;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const taskId = 'task-1';
  const actorId = 'actor-1';

  beforeEach(() => {
    storage = new InMemoryKanbanProjectStorage();
    repository = new InMemoryTaskActivityRepository(storage);
  });

  it('records single activity event and persists in chronological order', async () => {
    const event = await repository.recordEvent({
      taskId,
      projectId,
      actorId,
      action: 'CREATED',
      details: { title: 'Nueva tarea' },
    });

    expect(event.id).toBeDefined();
    expect(event.createdAt).toBeDefined();
    expect(event.action).toBe('CREATED');

    const byTask = await repository.findByTaskId(taskId);
    expect(byTask).toHaveLength(1);
    expect(byTask[0]!.id).toBe(event.id);
  });

  it('records events in batch atomically and isolates external references', async () => {
    const events = await repository.recordEventsBatch([
      {
        taskId,
        projectId,
        actorId,
        action: 'MOVED',
        fromColumnId: 'col-1',
        toColumnId: 'col-2',
      },
      {
        taskId: 'task-2',
        projectId,
        actorId,
        action: 'COLUMN_DELETED_REALLOCATION',
      },
    ]);

    expect(events).toHaveLength(2);

    const projectEvents = await repository.findByProjectId(projectId);
    expect(projectEvents).toHaveLength(2);

    // Inmutabilidad
    const all = repository.events;
    expect(all).toHaveLength(2);
  });

  it('rejects recording batch events with mixed projectIds', async () => {
    const foreignProjectId = '99999999-9999-4999-8999-999999999999';

    await expect(
      repository.recordEventsBatch([
        {
          taskId,
          projectId,
          actorId,
          action: 'MOVED',
          fromColumnId: 'col-1',
          toColumnId: 'col-2',
        },
        {
          taskId: 'task-other-project',
          projectId: foreignProjectId,
          actorId,
          action: 'CREATED',
        },
      ]),
    ).rejects.toThrow(/múltiples proyectos en un mismo lote atómico/);

    // Comprobar que ningún evento fue persistido (todo-o-nada)
    const eventsProject1 = await repository.findByProjectId(projectId);
    expect(eventsProject1).toHaveLength(0);

    const eventsProject2 = await repository.findByProjectId(foreignProjectId);
    expect(eventsProject2).toHaveLength(0);
  });
});
