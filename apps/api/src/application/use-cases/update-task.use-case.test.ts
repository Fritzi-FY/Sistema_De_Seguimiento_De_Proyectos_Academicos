import { describe, it, expect, beforeEach } from 'vitest';
import {
  IneligibleAssigneeError,
  type SystemClockPort,
  type Task,
  type TaskActivityEvent,
} from '@is488/shared';
import { UpdateTaskUseCase } from './update-task.use-case.js';
import { MoveTaskUseCase } from './move-task.use-case.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryTaskUpdateAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-update.adapter.js';
import { InMemoryTaskMoveAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-move.adapter.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';

function makeTask(
  overrides: Partial<Task> & Pick<Task, 'id' | 'projectId' | 'columnId' | 'orderIndex'>,
): Task {
  return {
    title: 'Tarea inicial',
    description: 'Descripcion original',
    priority: 'MEDIUM',
    dueDate: '2026-11-15T12:00:00.000Z',
    labels: ['backend', 'core'],
    creatorId: '22222222-2222-4222-8222-222222222222',
    assigneeIds: ['33333333-3333-4333-8333-333333333333'],
    createdAt: '2026-10-22T19:00:00.000Z',
    updatedAt: '2026-10-22T19:00:00.000Z',
    ...overrides,
  };
}

describe('UpdateTaskUseCase', () => {
  let storage: InMemoryKanbanProjectStorage;
  let taskUpdateAdapter: InMemoryTaskUpdateAdapter;
  let taskMoveAdapter: InMemoryTaskMoveAdapter;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let boardRepository: InMemoryBoardRepository;
  let mockClock: SystemClockPort;
  let useCase: UpdateTaskUseCase;
  let moveUseCase: MoveTaskUseCase;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const memberId = '33333333-3333-4333-8333-333333333333';
  const secondMemberId = '44444444-4444-4444-8444-444444444444';
  const inactiveMemberId = '66666666-6666-4666-8666-666666666666';
  const foreignUserId = '55555555-5555-4555-8555-555555555555';

  const otherProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherCreatorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const clockIso = '2026-10-23T01:30:00.000Z';

  let colA: string;
  let colB: string;
  let otherProjectColId: string;

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    taskUpdateAdapter = new InMemoryTaskUpdateAdapter(storage);
    taskMoveAdapter = new InMemoryTaskMoveAdapter(storage);
    projectRepository = new InMemoryProjectRepository();
    membershipRepository = new InMemoryMembershipRepository();
    boardRepository = new InMemoryBoardRepository(storage);

    mockClock = {
      now: () => new Date(clockIso),
      isoString: () => clockIso,
    };

    useCase = new UpdateTaskUseCase(
      taskUpdateAdapter,
      projectRepository,
      membershipRepository,
      mockClock,
    );

    moveUseCase = new MoveTaskUseCase(
      taskMoveAdapter,
      projectRepository,
      membershipRepository,
      mockClock,
    );

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
      userId: secondMemberId,
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    // Miembro inactivo
    await membershipRepository.addMember({
      projectId,
      userId: inactiveMemberId,
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
      description: 'Proyecto ajeno',
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
    const otherBoard = await boardRepository.findOrCreateDefaultBoard(otherProjectId);
    otherProjectColId = otherBoard.columns[0]!.id;
  });

  function setupTask(overrides: Partial<Task> = {}): Task {
    const snap = storage.getSnapshot(projectId);
    const task = makeTask({
      id: crypto.randomUUID(),
      projectId,
      columnId: colA,
      orderIndex: snap.tasks.filter((t) => t.columnId === colA).length,
      ...overrides,
    });
    snap.tasks.push(task);
    const ev: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId: task.id,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: colA,
      createdAt: task.createdAt,
    };
    snap.events.push(ev);
    storage.commitSnapshot(projectId, snap);
    return task;
  }

  // =========================================================================
  // 1. EDICIÓN PARCIAL
  // =========================================================================

  describe('partial update', () => {
    it('updates only title and priority: omitted fields retain their value, updatedAt is refreshed, exactly one UPDATED event recorded', async () => {
      const task = setupTask();

      const result = await useCase.execute({
        projectId,
        taskId: task.id,
        requesterId: creatorId,
        title: 'Titulo actualizado',
        priority: 'URGENT',
      });

      expect(result.task.title).toBe('Titulo actualizado');
      expect(result.task.priority).toBe('URGENT');
      expect(result.task.updatedAt).toBe(clockIso);

      // Campos omitidos conservados
      expect(result.task.description).toBe(task.description);
      expect(result.task.dueDate).toBe(task.dueDate);
      expect(result.task.labels).toEqual(task.labels);
      expect(result.task.assigneeIds).toEqual(task.assigneeIds);
      expect(result.task.columnId).toBe(task.columnId);
      expect(result.task.orderIndex).toBe(task.orderIndex);
      expect(result.task.creatorId).toBe(task.creatorId);

      // Evento de auditoría UPDATED
      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('UPDATED');
      expect(result.activity!.actorId).toBe(creatorId);
      expect(result.activity!.createdAt).toBe(clockIso);
      expect(result.activity!.details).toHaveProperty('title');
      expect(result.activity!.details).toHaveProperty('priority');

      const snap = storage.getSnapshot(projectId);
      expect(snap.events).toHaveLength(2); // CREATED previo + UPDATED nuevo
      expect(snap.events[1]!.id).toBe(result.activity!.id);
    });
  });

  // =========================================================================
  // 2. SEMÁNTICA DE VACIADO
  // =========================================================================

  describe('clearing semantics', () => {
    it('clears description with empty string and dueDate with null, clears labels and assignees with empty arrays', async () => {
      const task = setupTask();

      const result = await useCase.execute({
        projectId,
        taskId: task.id,
        requesterId: memberId,
        description: '', // Vaciado de descripción
        dueDate: null, // Vaciado de fecha límite
        labels: [], // Vaciado de etiquetas
        assigneeIds: [], // Desasignación total
      });

      expect(result.task.description).toBeUndefined();
      expect(result.task.dueDate).toBeUndefined();
      expect(result.task.labels).toEqual([]);
      expect(result.task.assigneeIds).toEqual([]);
      expect(result.task.updatedAt).toBe(clockIso);

      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('UPDATED');

      const snap = storage.getSnapshot(projectId);
      const stored = snap.tasks.find((t) => t.id === task.id)!;
      expect(stored.description).toBeUndefined();
      expect(stored.dueDate).toBeUndefined();
      expect(stored.labels).toEqual([]);
      expect(stored.assigneeIds).toEqual([]);
    });
  });

  // =========================================================================
  // 3. ASIGNACIÓN Y DESASIGNACIÓN DE MIEMBROS ACTIVOS
  // =========================================================================

  describe('assignee management', () => {
    it('reassigns to another active project member', async () => {
      const task = setupTask({ assigneeIds: [memberId] });

      const result = await useCase.execute({
        projectId,
        taskId: task.id,
        requesterId: creatorId,
        assigneeIds: [secondMemberId],
      });

      expect(result.task.assigneeIds).toEqual([secondMemberId]);
      expect(result.activity).not.toBeNull();
      expect(result.activity!.details).toHaveProperty('assigneeIds');
    });

    it('rejects with 400 when assigning a non-member of the project', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          assigneeIds: [foreignUserId],
        }),
      ).rejects.toThrow(IneligibleAssigneeError);
    });

    it('rejects with 400 when assigning a removed/inactive member', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          assigneeIds: [inactiveMemberId],
        }),
      ).rejects.toThrow(IneligibleAssigneeError);
    });
  });

  // =========================================================================
  // 4. AUTORIZACIÓN CONTEXTUAL Y AISLAMIENTO
  // =========================================================================

  describe('contextual authorization and isolation', () => {
    it('rejects with 404 when requester is not a project member', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: foreignUserId,
          title: 'Intento de edicion ajeno',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 404 when project does not exist', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId: crypto.randomUUID(),
          taskId: task.id,
          requesterId: creatorId,
          title: 'Nuevo titulo',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 404 when task belongs to another project', async () => {
      // Crear tarea en otherProject
      const snapOther = storage.getSnapshot(otherProjectId);
      const foreignTask = makeTask({
        id: crypto.randomUUID(),
        projectId: otherProjectId,
        columnId: otherProjectColId,
        orderIndex: 0,
      });
      snapOther.tasks.push(foreignTask);
      storage.commitSnapshot(otherProjectId, snapOther);

      await expect(
        useCase.execute({
          projectId,
          taskId: foreignTask.id,
          requesterId: creatorId,
          title: 'Modificar tarea de otro proyecto',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // =========================================================================
  // 5. CAMPOS PROTEGIDOS Y DE MOVIMIENTO
  // =========================================================================

  describe('protected fields and movement prevention', () => {
    it('rejects with 400 when attempting to modify columnId (movement disallowed via update)', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          columnId: colB,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects with 400 when attempting to tamper with immutable id, creator, order or project', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo',
          ...({ id: crypto.randomUUID() } as unknown as object),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo',
          ...({ targetProjectId: crypto.randomUUID() } as unknown as object),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo',
          ...({ creatorId: crypto.randomUUID() } as unknown as object),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo',
          ...({ orderIndex: 99 } as unknown as object),
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  // =========================================================================
  // 6. VALIDACIÓN ZOD Y DATOS INVÁLIDOS
  // =========================================================================

  describe('validation', () => {
    it('rejects title shorter than 3 characters', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'ab',
        }),
      ).rejects.toThrow();
    });

    it('rejects title longer than 140 characters', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'x'.repeat(141),
        }),
      ).rejects.toThrow();
    });

    it('rejects empty payload with no fields specified', async () => {
      const task = setupTask();

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
        }),
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 7. NO-OP IDEMPOTENTE
  // =========================================================================

  describe('no-op idempotency', () => {
    it('does not alter updatedAt, does not record UPDATED event, and preserves complete snapshot intact when updates match current values', async () => {
      const task = setupTask();
      const snapBefore = storage.getSnapshot(projectId);

      const result = await useCase.execute({
        projectId,
        taskId: task.id,
        requesterId: creatorId,
        title: task.title,
        priority: task.priority,
        description: task.description,
        labels: [...task.labels],
        assigneeIds: [...task.assigneeIds],
      });

      expect(result.activity).toBeNull();
      expect(result.task.updatedAt).toBe(task.updatedAt);

      const snapAfter = storage.getSnapshot(projectId);
      expect(snapAfter).toEqual(snapBefore);
    });
  });

  // =========================================================================
  // 8. ATOMICIDAD ANTE FALLOS ADVERSARIALES
  // =========================================================================

  describe('atomicity on failure', () => {
    it('preserves entire snapshot intact including prior audit when fault is injected before publish', async () => {
      const task = setupTask();
      const snapBefore = storage.getSnapshot(projectId);
      expect(snapBefore.events).toHaveLength(1);

      taskUpdateAdapter.setFaultInjectionPoint('before_publish');

      await expect(
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo que fallara',
          priority: 'URGENT',
        }),
      ).rejects.toThrow('Simulated failure after preparing updated task');

      const snapAfter = storage.getSnapshot(projectId);
      expect(snapAfter).toEqual(snapBefore);
      expect(snapAfter.tasks.find((t) => t.id === task.id)!.title).toBe(task.title);
      expect(snapAfter.events.some((e) => e.action === 'UPDATED')).toBe(false);

      taskUpdateAdapter.setFaultInjectionPoint(null);
    });
  });

  // =========================================================================
  // 9. CONCURRENCIA ENTRE EDICIÓN Y MOVIMIENTO (ADAPTADORES REALES)
  // =========================================================================

  describe('concurrency between update and move', () => {
    it('preserves both update and move mutations without lost updates when executed concurrently', async () => {
      const task = setupTask();

      // Lanzar simultáneamente una edición (título y prioridad) y un movimiento (a colB)
      const [updateResult, moveResult] = await Promise.all([
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo Concurrente Editado',
          priority: 'HIGH',
        }),
        moveUseCase.execute({
          projectId,
          taskId: task.id,
          destinationColumnId: colB,
          destinationIndex: 0,
          requestingUserId: memberId,
        }),
      ]);

      expect(updateResult.task.id).toBe(task.id);
      expect(moveResult.task.id).toBe(task.id);

      const snap = storage.getSnapshot(projectId);
      const finalTask = snap.tasks.find((t) => t.id === task.id)!;

      // La tarea final debe reflejar TANTO el movimiento a colB COMO el nuevo título y prioridad
      expect(finalTask.columnId).toBe(colB);
      expect(finalTask.title).toBe('Titulo Concurrente Editado');
      expect(finalTask.priority).toBe('HIGH');

      // Se deben haber registrado ambos eventos inmutables: UPDATED y MOVED
      const actions = snap.events.map((e) => e.action);
      expect(actions).toContain('CREATED');
      expect(actions).toContain('UPDATED');
      expect(actions).toContain('MOVED');
    });

    it('preserves disjoint-field updates from concurrent operations: re-read within mutex ensures both survive', async () => {
      const task = setupTask({ description: 'Descripcion original' });

      // A cambia solo el título; B cambia solo la prioridad — campos disjuntos.
      // Gracias a la re-lectura dentro del mutex, independientemente del orden:
      //   - el que ejecuta primero solo parchea su campo sobre el estado actual
      //   - el que ejecuta segundo re-lee el estado ya parchado y solo parchea su propio campo
      //   => Ambos cambios sobreviven en el snapshot final
      await Promise.all([
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Titulo desde A',
        }),
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: memberId,
          priority: 'URGENT',
        }),
      ]);

      const snap = storage.getSnapshot(projectId);
      const finalTask = snap.tasks.find((t) => t.id === task.id)!;

      // Ambos cambios deben sobrevivir al haber tocado campos distintos
      expect(finalTask.title).toBe('Titulo desde A');
      expect(finalTask.priority).toBe('URGENT');
      // La descripción no fue tocada por ninguno de los dos updates
      expect(finalTask.description).toBe('Descripcion original');

      const updatedEvents = snap.events.filter((e) => e.action === 'UPDATED');
      expect(updatedEvents).toHaveLength(2);
    });

    it('serializes two concurrent updates: last write wins without lost attributes or duplicate events', async () => {
      const task = setupTask();

      await Promise.all([
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: creatorId,
          title: 'Update A',
          priority: 'LOW',
        }),
        useCase.execute({
          projectId,
          taskId: task.id,
          requesterId: memberId,
          title: 'Update B',
          priority: 'URGENT',
        }),
      ]);

      const snap = storage.getSnapshot(projectId);
      const finalTask = snap.tasks.find((t) => t.id === task.id)!;

      // La tarea debe estar en uno de los dos estados atómicos consistentes
      // (título y prioridad deben pertenecer al mismo update, no mezclarse entre operaciones)
      const isConsistentA = finalTask.title === 'Update A' && finalTask.priority === 'LOW';
      const isConsistentB = finalTask.title === 'Update B' && finalTask.priority === 'URGENT';
      expect(isConsistentA || isConsistentB).toBe(true);

      // Exactamente 2 eventos UPDATED registrados (uno por cada operación efectiva)
      const updatedEvents = snap.events.filter((e) => e.action === 'UPDATED');
      expect(updatedEvents).toHaveLength(2);
    });
  });
});
