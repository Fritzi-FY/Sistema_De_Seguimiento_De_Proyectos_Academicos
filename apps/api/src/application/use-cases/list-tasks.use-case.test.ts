import { describe, it, expect, beforeEach } from 'vitest';
import type { Task } from '@is488/shared';
import { ListTasksUseCase } from './list-tasks.use-case.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryTaskListAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-list.adapter.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTask(
  overrides: Partial<Task> & Pick<Task, 'id' | 'projectId' | 'columnId' | 'orderIndex'>,
): Task {
  return {
    title: 'Tarea de prueba',
    description: 'Descripcion de prueba',
    priority: 'MEDIUM',
    dueDate: undefined,
    labels: [],
    creatorId: '22222222-2222-4222-8222-222222222222',
    assigneeIds: [],
    createdAt: '2026-10-22T10:00:00.000Z',
    updatedAt: '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

describe('ListTasksUseCase', () => {
  let storage: InMemoryKanbanProjectStorage;
  let taskListAdapter: InMemoryTaskListAdapter;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let boardRepository: InMemoryBoardRepository;
  let useCase: ListTasksUseCase;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const memberId = '33333333-3333-4333-8333-333333333333';
  const foreignUserId = '55555555-5555-4555-8555-555555555555';
  const removedMemberId = '66666666-6666-4666-8666-666666666666';

  const otherProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherCreatorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  let colA: string;
  let colB: string;

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    taskListAdapter = new InMemoryTaskListAdapter(storage);
    projectRepository = new InMemoryProjectRepository();
    membershipRepository = new InMemoryMembershipRepository();
    boardRepository = new InMemoryBoardRepository(storage);

    useCase = new ListTasksUseCase(taskListAdapter, projectRepository, membershipRepository);

    // Setup proyecto principal
    await projectRepository.save({
      id: projectId,
      title: 'Proyecto IS488',
      description: 'Proyecto de prueba',
      courseCode: 'IS-488',
      status: 'active',
      startDate: '2026-10-01T00:00:00.000Z',
      targetDate: '2026-12-01T00:00:00.000Z',
      creatorId,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    await membershipRepository.addMember({
      projectId,
      userId: creatorId,
      role: 'owner',
      status: 'active',
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await membershipRepository.addMember({
      projectId,
      userId: memberId,
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await membershipRepository.addMember({
      projectId,
      userId: removedMemberId,
      role: 'collaborator',
      status: 'removed',
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    const board = await boardRepository.findOrCreateDefaultBoard(projectId);
    colA = board.columns[0]!.id;
    colB = board.columns[1]!.id;

    // Setup proyecto extranjero
    await projectRepository.save({
      id: otherProjectId,
      title: 'Otro Proyecto',
      description: 'Ajeno',
      courseCode: 'IS-999',
      status: 'active',
      startDate: '2026-10-01T00:00:00.000Z',
      targetDate: '2026-12-01T00:00:00.000Z',
      creatorId: otherCreatorId,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await membershipRepository.addMember({
      projectId: otherProjectId,
      userId: otherCreatorId,
      role: 'owner',
      status: 'active',
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await boardRepository.findOrCreateDefaultBoard(otherProjectId);
  });

  function addTask(overrides: Partial<Task> & Pick<Task, 'id' | 'columnId' | 'orderIndex'>): Task {
    const snap = storage.getSnapshot(projectId);
    const task = makeTask({ projectId, ...overrides });
    snap.tasks.push(task);
    storage.commitSnapshot(projectId, snap);
    return task;
  }

  // =========================================================================
  // 1. LISTADO BASICO Y AISLAMIENTO
  // =========================================================================

  describe('basic listing and isolation', () => {
    it('returns all tasks for the project when no filters are applied', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1 });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0 });

      const result = await useCase.execute({ projectId, requesterId: creatorId });

      expect(result.items).toHaveLength(3);
      expect(result.totalItems).toBe(3);
    });

    it('does not return tasks from other projects', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });
      // Task in other project
      const otherSnap = storage.getSnapshot(otherProjectId);
      const otherBoard = await boardRepository.findOrCreateDefaultBoard(otherProjectId);
      const otherColId = otherBoard.columns[0]!.id;
      const foreignTask = makeTask({
        id: crypto.randomUUID(),
        projectId: otherProjectId,
        columnId: otherColId,
        orderIndex: 0,
      });
      otherSnap.tasks.push(foreignTask);
      storage.commitSnapshot(otherProjectId, otherSnap);

      const result = await useCase.execute({ projectId, requesterId: creatorId });

      expect(result.items).toHaveLength(1);
      expect(result.items.every((t) => t.projectId === projectId)).toBe(true);
    });

    it('returns empty result when project has no tasks', async () => {
      const result = await useCase.execute({ projectId, requesterId: creatorId });

      expect(result.items).toHaveLength(0);
      expect(result.totalItems).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  // =========================================================================
  // 2. FILTROS INDIVIDUALES
  // =========================================================================

  describe('individual filters', () => {
    it('filters by columnId: returns only tasks in the specified column', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1 });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0 });

      const result = await useCase.execute({ projectId, requesterId: memberId, columnId: colA });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((t) => t.columnId === colA)).toBe(true);
      expect(result.totalItems).toBe(2);
    });

    it('filters by priority: returns only tasks matching the specified priority', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, priority: 'HIGH' });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1, priority: 'MEDIUM' });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0, priority: 'HIGH' });

      const result = await useCase.execute({ projectId, requesterId: creatorId, priority: 'HIGH' });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((t) => t.priority === 'HIGH')).toBe(true);
      expect(result.totalItems).toBe(2);
    });

    it('filters by assigneeId: returns only tasks assigned to the specified user', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, assigneeIds: [memberId] });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1, assigneeIds: [] });
      addTask({
        id: crypto.randomUUID(),
        columnId: colB,
        orderIndex: 0,
        assigneeIds: [memberId, creatorId],
      });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        assigneeId: memberId,
      });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((t) => t.assigneeIds.includes(memberId))).toBe(true);
      expect(result.totalItems).toBe(2);
    });

    it('filters by label: returns only tasks containing the specified label', async () => {
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 0,
        labels: ['backend', 'api'],
      });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1, labels: ['frontend'] });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0, labels: ['backend'] });

      const result = await useCase.execute({ projectId, requesterId: creatorId, label: 'backend' });

      expect(result.items).toHaveLength(2);
      expect(result.items.every((t) => t.labels.includes('backend'))).toBe(true);
    });

    it('filters by search: matches title substring case-insensitively', async () => {
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 0,
        title: 'Implementar autenticacion OAuth',
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 1,
        title: 'Disenar base de datos',
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colB,
        orderIndex: 0,
        title: 'AUTENTICACION con JWT',
      });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        search: 'autenticacion',
      });

      expect(result.items).toHaveLength(2);
    });

    it('filters by search: matches description substring case-insensitively', async () => {
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 0,
        title: 'Tarea sin coincidencia',
        description: 'Usa el modulo de autenticacion Bearer',
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 1,
        title: 'Otra tarea',
        description: 'Sin coincidencia aqui',
      });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        search: 'AUTENTICACION',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe('Tarea sin coincidencia');
    });
  });

  // =========================================================================
  // 3. FILTROS COMBINADOS (AND)
  // =========================================================================

  describe('combined filters (AND logic)', () => {
    it('applies columnId AND priority filters together', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, priority: 'HIGH' });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1, priority: 'LOW' });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0, priority: 'HIGH' });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: colA,
        priority: 'HIGH',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.columnId).toBe(colA);
      expect(result.items[0]!.priority).toBe('HIGH');
    });

    it('applies priority AND assigneeId filters together', async () => {
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 0,
        priority: 'URGENT',
        assigneeIds: [memberId],
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 1,
        priority: 'URGENT',
        assigneeIds: [],
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colB,
        orderIndex: 0,
        priority: 'LOW',
        assigneeIds: [memberId],
      });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        priority: 'URGENT',
        assigneeId: memberId,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.priority).toBe('URGENT');
      expect(result.items[0]!.assigneeIds).toContain(memberId);
    });

    it('applies label AND search filters together', async () => {
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 0,
        title: 'API de usuarios',
        labels: ['backend'],
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colA,
        orderIndex: 1,
        title: 'API de reportes',
        labels: ['analytics'],
      });
      addTask({
        id: crypto.randomUUID(),
        columnId: colB,
        orderIndex: 0,
        title: 'Login de usuarios',
        labels: ['backend'],
      });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        label: 'backend',
        search: 'api',
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]!.title).toBe('API de usuarios');
    });

    it('returns empty when combined filters match no tasks', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, priority: 'LOW' });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0, priority: 'HIGH' });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: colA,
        priority: 'HIGH',
      });

      expect(result.items).toHaveLength(0);
      expect(result.totalItems).toBe(0);
      expect(result.totalPages).toBe(0);
    });
  });

  // =========================================================================
  // 4. ORDEN DETERMINISTA
  // =========================================================================

  describe('deterministic ordering', () => {
    it('orders tasks by (columnId lex, orderIndex asc, createdAt asc): stable across calls', async () => {
      // colA and colB — orderIndex determines position within column
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, title: 'T-A0' });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1, title: 'T-A1' });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0, title: 'T-B0' });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 1, title: 'T-B1' });

      const result1 = await useCase.execute({ projectId, requesterId: creatorId });
      const result2 = await useCase.execute({ projectId, requesterId: creatorId });

      // Results are idempotent across calls
      expect(result1.items.map((t) => t.title)).toEqual(result2.items.map((t) => t.title));

      // Column with lexicographically smaller UUID comes first
      const titles = result1.items.map((t) => t.title);
      const colAFirst = colA.localeCompare(colB) < 0;
      const expectedOrder = colAFirst
        ? ['T-A0', 'T-A1', 'T-B0', 'T-B1']
        : ['T-B0', 'T-B1', 'T-A0', 'T-A1'];
      expect(titles).toEqual(expectedOrder);
    });

    it('uses createdAt as stable tiebreaker for tasks with same columnId and orderIndex', async () => {
      // Tasks with identical columnId and orderIndex but different createdAt
      const snap = storage.getSnapshot(projectId);
      const tEarlier = makeTask({
        id: crypto.randomUUID(),
        projectId,
        columnId: colA,
        orderIndex: 0,
        title: 'Earlier',
        createdAt: '2026-10-22T08:00:00.000Z',
      });
      const tLater = makeTask({
        id: crypto.randomUUID(),
        projectId,
        columnId: colA,
        orderIndex: 0,
        title: 'Later',
        createdAt: '2026-10-22T09:00:00.000Z',
      });
      snap.tasks.push(tEarlier, tLater);
      storage.commitSnapshot(projectId, snap);

      const result = await useCase.execute({ projectId, requesterId: creatorId });

      expect(result.items[0]!.title).toBe('Earlier');
      expect(result.items[1]!.title).toBe('Later');
    });
  });

  // =========================================================================
  // 5. PAGINACION
  // =========================================================================

  describe('pagination', () => {
    it('paginates correctly: page 1 returns first N tasks, page 2 returns next N', async () => {
      for (let i = 0; i < 5; i++) {
        addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: i });
      }

      const page1 = await useCase.execute({ projectId, requesterId: creatorId, page: 1, limit: 3 });
      const page2 = await useCase.execute({ projectId, requesterId: creatorId, page: 2, limit: 3 });

      expect(page1.items).toHaveLength(3);
      expect(page2.items).toHaveLength(2);
      expect(page1.totalItems).toBe(5);
      expect(page1.totalPages).toBe(2);
      expect(page2.page).toBe(2);
    });

    it('returns empty items for a page beyond totalPages', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        page: 5,
        limit: 20,
      });

      expect(result.items).toHaveLength(0);
      expect(result.totalItems).toBe(1);
      expect(result.totalPages).toBe(1);
    });

    it('totalItems reflects filtered count, not total task count', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, priority: 'HIGH' });
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 1, priority: 'LOW' });
      addTask({ id: crypto.randomUUID(), columnId: colB, orderIndex: 0, priority: 'LOW' });

      const result = await useCase.execute({
        projectId,
        requesterId: creatorId,
        priority: 'LOW',
        page: 1,
        limit: 10,
      });

      expect(result.totalItems).toBe(2); // solo los LOW, no los 3 totales
      expect(result.items).toHaveLength(2);
    });

    it('rejects limit greater than 100 with Zod validation error', async () => {
      await expect(
        useCase.execute({ projectId, requesterId: creatorId, limit: 101 }),
      ).rejects.toThrow();
    });

    it('rejects page less than 1 with Zod validation error', async () => {
      await expect(
        useCase.execute({ projectId, requesterId: creatorId, page: 0 }),
      ).rejects.toThrow();
    });

    it('defaults page to 1 and limit to 20 when not specified', async () => {
      const result = await useCase.execute({ projectId, requesterId: creatorId });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });
  });

  // =========================================================================
  // 6. AUTORIZACION CONTEXTUAL Y AISLAMIENTO
  // =========================================================================

  describe('contextual authorization and isolation', () => {
    it('allows project creator to list tasks', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });

      const result = await useCase.execute({ projectId, requesterId: creatorId });

      expect(result.totalItems).toBe(1);
    });

    it('allows active collaborator to list tasks', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });

      const result = await useCase.execute({ projectId, requesterId: memberId });

      expect(result.totalItems).toBe(1);
    });

    it('rejects non-member with 404 (horizontal isolation)', async () => {
      await expect(
        useCase.execute({ projectId, requesterId: foreignUserId }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects removed/inactive member with 404', async () => {
      await expect(
        useCase.execute({ projectId, requesterId: removedMemberId }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects non-existent project with 404', async () => {
      await expect(
        useCase.execute({ projectId: crypto.randomUUID(), requesterId: creatorId }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('does not disclose tasks of another project to a user of that project querying a different projectId', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });

      // otherCreatorId is a member of otherProjectId, not projectId
      await expect(
        useCase.execute({ projectId, requesterId: otherCreatorId }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // =========================================================================
  // 7. INMUTABILIDAD (sin mutacion ni eventos)
  // =========================================================================

  describe('immutability — no mutations or events', () => {
    it('does not modify the project snapshot after listing tasks', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0, title: 'Inmutable' });
      const snapBefore = storage.getSnapshot(projectId);

      await useCase.execute({ projectId, requesterId: creatorId });

      const snapAfter = storage.getSnapshot(projectId);
      expect(snapAfter.tasks).toEqual(snapBefore.tasks);
      expect(snapAfter.events).toEqual(snapBefore.events);
    });

    it('does not record any activity event when listing tasks', async () => {
      addTask({ id: crypto.randomUUID(), columnId: colA, orderIndex: 0 });
      const eventsBefore = storage.getSnapshot(projectId).events.length;

      await useCase.execute({ projectId, requesterId: memberId });

      const eventsAfter = storage.getSnapshot(projectId).events.length;
      expect(eventsAfter).toBe(eventsBefore);
    });
  });
});
