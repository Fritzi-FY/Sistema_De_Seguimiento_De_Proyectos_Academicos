import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskRepository } from './in-memory-task.repository.js';
import { InMemoryKanbanProjectStorage } from './in-memory-kanban-project.storage.js';
import { TaskNotFoundError, BoardColumnNotFoundError, type Task } from '@is488/shared';
import { InMemoryBoardRepository } from './in-memory-board.repository.js';

describe('InMemoryTaskRepository', () => {
  let storage: InMemoryKanbanProjectStorage;
  let repository: InMemoryTaskRepository;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const columnId = 'col-1';
  const creatorId = 'creator-1';

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    const boardRepo = new InMemoryBoardRepository(storage);
    const now = new Date().toISOString();
    await boardRepo.saveBoard({
      id: 'board-1',
      projectId,
      columns: [
        {
          id: columnId,
          boardId: 'board-1',
          name: 'Columna 1',
          orderIndex: 0,
          category: 'TODO',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: 'col-2',
          boardId: 'board-1',
          name: 'Columna 2',
          orderIndex: 1,
          category: 'IN_PROGRESS',
          createdAt: now,
          updatedAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
    repository = new InMemoryTaskRepository(storage);
  });

  it('creates tasks with assigned orderIndex and returns deep clone', async () => {
    const task = await repository.create({
      projectId,
      columnId,
      title: 'Primera tarea',
      priority: 'MEDIUM',
      orderIndex: 0,
      labels: ['frontend'],
      creatorId,
      assigneeIds: ['user-1'],
    });

    expect(task.id).toBeDefined();
    expect(task.title).toBe('Primera tarea');
    expect(task.createdAt).toBeDefined();
    expect(task.updatedAt).toBeDefined();

    // Comprobar inmutabilidad por clonacion profunda
    task.labels.push('mutacion-externa');
    const fetched = await repository.findById(task.id);
    expect(fetched!.labels).toEqual(['frontend']);
  });

  it('updates task properties and throws 404 if not found', async () => {
    const task = await repository.create({
      projectId,
      columnId,
      title: 'Tarea original',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
    });

    const updated = await repository.update(task.id, {
      title: 'Tarea modificada',
      priority: 'URGENT',
    });

    expect(updated.title).toBe('Tarea modificada');
    expect(updated.priority).toBe('URGENT');

    await expect(repository.update('non-existent-task-id', { title: 'X' })).rejects.toThrow(
      TaskNotFoundError,
    );
  });

  it('moves task between columns adjusting contiguous order indices', async () => {
    const targetColId = 'col-2';

    await repository.create({
      projectId,
      columnId: targetColId,
      title: 'Target 0',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
    });

    const sourceTask = await repository.create({
      projectId,
      columnId,
      title: 'Source Task',
      priority: 'HIGH',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
    });

    await repository.moveTask(sourceTask.id, targetColId, 1);

    const targetTasks = await repository.findByColumnId(targetColId);
    expect(targetTasks).toHaveLength(2);
    expect(targetTasks.map((t) => t.orderIndex)).toEqual([0, 1]);
    expect(targetTasks[1]!.id).toBe(sourceTask.id);

    const sourceTasks = await repository.findByColumnId(columnId);
    expect(sourceTasks).toHaveLength(0);
  });

  it('lists tasks with filters and server-side pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await repository.create({
        projectId,
        columnId,
        title: 'Task ' + i,
        priority: i % 2 === 0 ? 'HIGH' : 'LOW',
        orderIndex: i,
        labels: i === 0 ? ['bug'] : [],
        creatorId,
        assigneeIds: ['assignee-1'],
      });
    }

    const filtered = await repository.listTasks({
      projectId,
      priority: 'HIGH',
      page: 1,
      limit: 10,
    });

    expect(filtered.totalItems).toBe(3);
    expect(filtered.items).toHaveLength(3);
    expect(filtered.items.every((t) => t.priority === 'HIGH')).toBe(true);

    const paginated = await repository.listTasks({
      projectId,
      page: 2,
      limit: 2,
    });

    expect(paginated.page).toBe(2);
    expect(paginated.limit).toBe(2);
    expect(paginated.items).toHaveLength(2);
    expect(paginated.totalPages).toBe(3);
  });

  it('rejects creating a task when referenced column does not exist in the project board', async () => {
    await expect(
      repository.create({
        projectId,
        columnId: 'non-existent-column',
        title: 'Task in nowhere',
        priority: 'MEDIUM',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [],
      }),
    ).rejects.toThrow(BoardColumnNotFoundError);
  });

  it('rejects updating immutable task id or projectId including empty values', async () => {
    const task = await repository.create({
      projectId,
      columnId,
      title: 'Immutable check',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
    });

    // Modificar por otro id
    await expect(
      repository.update(task.id, {
        id: '00000000-0000-4000-8000-000000000000',
      } as unknown as Partial<Task>),
    ).rejects.toThrow(/identificador inmutable/);

    // Modificar por id vacio
    await expect(
      repository.update(task.id, {
        id: '   ',
      } as unknown as Partial<Task>),
    ).rejects.toThrow(/identificador de la tarea no puede estar vacio/);

    // Modificar por otro projectId
    await expect(
      repository.update(task.id, {
        projectId: '00000000-0000-4000-8000-000000000000',
      } as unknown as Partial<Task>),
    ).rejects.toThrow(/transferir la tarea a otro proyecto/);

    // Modificar por projectId vacio
    await expect(
      repository.update(task.id, {
        projectId: '',
      } as unknown as Partial<Task>),
    ).rejects.toThrow(/identificador de proyecto no puede estar vacio/);
  });

  it('rejects updating columnId with empty or whitespace values, validating by presence', async () => {
    const task = await repository.create({
      projectId,
      columnId,
      title: 'Column validation check',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
    });

    await expect(
      repository.update(task.id, {
        columnId: '',
      } as unknown as Partial<Task>),
    ).rejects.toThrow(/identificador de columna no puede estar vacio/);

    await expect(
      repository.update(task.id, {
        columnId: '   ',
      } as unknown as Partial<Task>),
    ).rejects.toThrow(/identificador de columna no puede estar vacio/);
  });

  it('rejects updating or moving task to a non-existent column', async () => {
    const task = await repository.create({
      projectId,
      columnId,
      title: 'Move check',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
    });

    await expect(repository.update(task.id, { columnId: 'non-existent-col' })).rejects.toThrow(
      BoardColumnNotFoundError,
    );

    await expect(repository.moveTask(task.id, 'non-existent-col', 0)).rejects.toThrow(
      BoardColumnNotFoundError,
    );

    await expect(
      repository.migrateTasksBetweenColumns(columnId, 'non-existent-dest'),
    ).rejects.toThrow(BoardColumnNotFoundError);
  });
});
