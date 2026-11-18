import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskActivityListResponseSchema, type SystemClockPort } from '@is488/shared';
import { CreateTaskUseCase } from './create-task.use-case.js';
import { UpdateTaskUseCase } from './update-task.use-case.js';
import { MoveTaskUseCase } from './move-task.use-case.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryTaskCreationAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-creation.adapter.js';
import { InMemoryTaskUpdateAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-update.adapter.js';
import { InMemoryTaskMoveAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-move.adapter.js';
import { InMemoryTaskActivityRepository } from '../../infrastructure/adapters/repositories/in-memory-task-activity.repository.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const member = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
const correlationId = 'abcdefab-1234-4abc-8def-123456789abc';
const timestamp = '2026-11-14T15:00:00.000Z';
const operations = ['create', 'update', 'move'] as const;
type Operation = (typeof operations)[number];
const actions = { create: 'CREATED', update: 'UPDATED', move: 'MOVED' } as const;

async function fixture() {
  const storage = new InMemoryKanbanProjectStorage();
  const projects = new InMemoryProjectRepository();
  const memberships = new InMemoryMembershipRepository();
  await projects.save({
    id: projectId,
    creatorId: owner,
    title: 'Correlation fixture',
    courseCode: 'IS-488',
    status: 'active',
    startDate: timestamp,
    targetDate: '2026-12-01T00:00:00.000Z',
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await memberships.addMember({
    projectId,
    userId: member,
    role: 'collaborator',
    status: 'active',
    removedAt: null,
    joinedAt: timestamp,
    updatedAt: timestamp,
  });
  const board = await new InMemoryBoardRepository(storage).findOrCreateDefaultBoard(projectId);
  const source = board.columns[0]!.id;
  const destination = board.columns[1]!.id;
  const clock: SystemClockPort = {
    now: () => new Date(timestamp),
    isoString: () => timestamp,
  };
  const adapters = {
    create: new InMemoryTaskCreationAdapter(storage),
    update: new InMemoryTaskUpdateAdapter(storage),
    move: new InMemoryTaskMoveAdapter(storage),
  };
  const create = new CreateTaskUseCase(adapters.create, projects, memberships, clock);
  const update = new UpdateTaskUseCase(adapters.update, projects, memberships, clock);
  const move = new MoveTaskUseCase(adapters.move, projects, memberships, clock);
  const seeded = await create.execute({
    projectId,
    requesterId: owner,
    columnId: source,
    title: 'Historic task',
  });
  const spies = {
    create: vi.spyOn(adapters.create, 'executeAtomicTaskCreation'),
    update: vi.spyOn(adapters.update, 'executeAtomicTaskUpdate'),
    move: vi.spyOn(adapters.move, 'executeAtomicTaskMove'),
  };
  let sequence = 0;

  async function run(operation: Operation, correlation?: string, actor = member) {
    const context = { correlationId: correlation };
    if (operation === 'create') {
      return (
        await create.execute({
          projectId,
          requesterId: actor,
          columnId: source,
          title: `Created task ${++sequence}`,
          ...context,
        })
      ).id;
    }
    if (operation === 'update') {
      await update.execute({
        projectId,
        taskId: seeded.id,
        requesterId: actor,
        title: `Edited task ${++sequence}`,
        ...context,
      });
    } else {
      const current = storage.getSnapshot(projectId).tasks.find((task) => task.id === seeded.id)!;
      await move.execute({
        projectId,
        taskId: seeded.id,
        requestingUserId: actor,
        destinationColumnId: current.columnId === source ? destination : source,
        destinationIndex: 0,
        ...context,
      });
    }
    return seeded.id;
  }

  function runAtomic(operation: Operation, correlation: string) {
    const context = { projectId, correlationId: correlation, timestamp };
    if (operation === 'create') {
      return adapters.create.executeAtomicTaskCreation({
        ...context,
        columnId: source,
        title: 'Direct atomic creation',
        priority: 'MEDIUM',
        labels: [],
        assigneeIds: [],
        creatorId: member,
      });
    }
    if (operation === 'update') {
      return adapters.update.executeAtomicTaskUpdate({
        ...context,
        taskId: seeded.id,
        actorId: member,
        patch: { title: 'Direct atomic update' },
      });
    }
    return adapters.move.executeAtomicTaskMove({
      ...context,
      taskId: seeded.id,
      actorId: member,
      destinationColumnId: destination,
      destinationIndex: 0,
    });
  }

  return {
    storage,
    adapters,
    spies,
    update,
    move,
    seeded,
    source,
    destination,
    run,
    runAtomic,
    history: new InMemoryTaskActivityRepository(storage),
  };
}

afterEach(() => vi.restoreAllMocks());

describe.each(operations)('%s task activity correlation', (operation) => {
  it.each([correlationId.toUpperCase(), undefined, 'invalid-correlation'])(
    'propagates only normalized usable metadata and preserves actor, action, resource and time',
    async (input) => {
      const f = await fixture();
      const historic = f.storage.getSnapshot(projectId).events[0];
      const taskId = await f.run(operation, input);
      const snapshot = f.storage.getSnapshot(projectId);
      const activity = snapshot.events.at(-1)!;
      expect(activity).toMatchObject({
        actorId: member,
        action: actions[operation],
        taskId,
        projectId,
        createdAt: timestamp,
      });
      const params = f.spies[operation].mock.calls[0]![0];
      if (input === correlationId.toUpperCase()) {
        expect(params).toHaveProperty('correlationId', correlationId);
        expect(activity).toHaveProperty('correlationId', correlationId);
      } else {
        expect(params).not.toHaveProperty('correlationId');
        expect(activity).not.toHaveProperty('correlationId');
        expect(JSON.stringify(activity)).not.toContain('invalid-correlation');
      }
      expect(snapshot.events[0]).toEqual(historic);
      expect(snapshot.events[0]).not.toHaveProperty('correlationId');
      expect(TaskActivityListResponseSchema.parse(snapshot.events)).toEqual(snapshot.events);
      expect(snapshot.tasks.find((task) => task.id === taskId)).not.toHaveProperty('correlationId');
    },
  );

  it.each([correlationId.toUpperCase(), 'invalid-correlation'])(
    'validates direct atomic-port metadata before publishing the event',
    async (input) => {
      const f = await fixture();
      const result = await f.runAtomic(operation, input);
      expect(result.activity).not.toBeNull();
      expect(result.activity).toMatchObject({
        actorId: member,
        action: actions[operation],
        taskId: result.task.id,
        projectId,
        createdAt: timestamp,
      });
      if (input === correlationId.toUpperCase()) {
        expect(result.activity).toHaveProperty('correlationId', correlationId);
      } else {
        expect(result.activity).not.toHaveProperty('correlationId');
      }
      expect(f.storage.getSnapshot(projectId).events.at(-1)).toEqual(result.activity);
    },
  );

  it('keeps historic state and activity intact when failure occurs before publication', async () => {
    const f = await fixture();
    const before = f.storage.getSnapshot(projectId);
    f.adapters[operation].setFaultInjectionPoint('before_publish');
    await expect(f.run(operation, correlationId)).rejects.toThrow('Simulated failure');
    expect(f.storage.getSnapshot(projectId)).toEqual(before);
  });

  it('does not grant an outsider access when the correlation matches committed activity', async () => {
    const f = await fixture();
    await f.run(operation, correlationId);
    const before = f.storage.getSnapshot(projectId);
    f.spies[operation].mockClear();
    await expect(f.run(operation, correlationId, outsider)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(f.spies[operation]).not.toHaveBeenCalled();
    expect(f.storage.getSnapshot(projectId)).toEqual(before);
  });

  it('keeps distinct effective changes with repeated correlation and returns isolated copies', async () => {
    const f = await fixture();
    await f.run(operation, correlationId);
    const taskId = await f.run(operation, correlationId);
    const activities = f.storage.getSnapshot(projectId).events.slice(1);
    expect(activities).toHaveLength(2);
    expect(activities.every((event) => event.correlationId === correlationId)).toBe(true);
    expect(new Set(activities.map((event) => event.id)).size).toBe(2);
    const read = await f.history.findByTaskId(taskId);
    read.find((event) => event.correlationId)!.correlationId = 'mutated-copy';
    expect(f.storage.getSnapshot(projectId).events.slice(1)).toEqual(activities);
  });
});

describe('Correlation preserves no-op behavior', () => {
  it('does not update or append activity for an unchanged edit', async () => {
    const f = await fixture();
    const before = f.storage.getSnapshot(projectId);
    const result = await f.update.execute({
      projectId,
      taskId: f.seeded.id,
      requesterId: member,
      title: f.seeded.title,
      correlationId,
    });
    expect(result.activity).toBeNull();
    expect(f.storage.getSnapshot(projectId)).toEqual(before);
  });

  it('does not update or append activity for the same effective position', async () => {
    const f = await fixture();
    const before = f.storage.getSnapshot(projectId);
    const result = await f.move.execute({
      projectId,
      taskId: f.seeded.id,
      requestingUserId: member,
      destinationColumnId: f.source,
      destinationIndex: 0,
      correlationId,
    });
    expect(result.activity).toBeNull();
    expect(f.storage.getSnapshot(projectId)).toEqual(before);
  });

  it('correlates an effective reorder within the same column', async () => {
    const f = await fixture();
    await f.run('create');
    const result = await f.move.execute({
      projectId,
      taskId: f.seeded.id,
      requestingUserId: member,
      destinationColumnId: f.source,
      destinationIndex: 1,
      correlationId: correlationId.toUpperCase(),
    });
    expect(result.activity).toMatchObject({
      actorId: member,
      action: 'MOVED',
      taskId: f.seeded.id,
      projectId,
      createdAt: timestamp,
      correlationId,
      fromColumnId: f.source,
      toColumnId: f.source,
      details: { fromIndex: 0, toIndex: 1 },
    });
    expect(f.storage.getSnapshot(projectId).events.at(-1)).toEqual(result.activity);
  });
});

describe.each(['single', 'batch'] as const)('%s activity recording', (mode) => {
  it.each([correlationId.toUpperCase(), undefined, 'invalid-correlation'])(
    'preserves only usable correlation when recording and reading events',
    async (input) => {
      const f = await fixture();
      const event = {
        taskId: f.seeded.id,
        projectId,
        actorId: member,
        action: 'UPDATED' as const,
        createdAt: timestamp,
        correlationId: input,
      };
      const saved =
        mode === 'single'
          ? await f.history.recordEvent(event)
          : (await f.history.recordEventsBatch([event]))[0]!;
      if (input === correlationId.toUpperCase()) {
        expect(saved).toHaveProperty('correlationId', correlationId);
      } else {
        expect(saved).not.toHaveProperty('correlationId');
      }
      expect(
        (await f.history.findByProjectId(projectId)).find((entry) => entry.id === saved.id),
      ).toEqual(saved);
      saved.correlationId = 'mutated-copy';
      expect(f.storage.getSnapshot(projectId).events.at(-1)!.correlationId).not.toBe(
        'mutated-copy',
      );
    },
  );
});
