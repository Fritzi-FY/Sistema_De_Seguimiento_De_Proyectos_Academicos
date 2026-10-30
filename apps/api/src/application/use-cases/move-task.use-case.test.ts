import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoardColumnNotFoundError,
  type SystemClockPort,
  type Task,
  type TaskActivityEvent,
} from '@is488/shared';
import { MoveTaskUseCase } from './move-task.use-case.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryTaskMoveAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-move.adapter.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(
  overrides: Partial<Task> & Pick<Task, 'id' | 'projectId' | 'columnId' | 'orderIndex'>,
): Task {
  return {
    title: 'Tarea de prueba',
    description: undefined,
    priority: 'MEDIUM',
    dueDate: undefined,
    labels: [],
    creatorId: '22222222-2222-4222-8222-222222222222',
    assigneeIds: [],
    createdAt: '2026-10-22T19:00:00.000Z',
    updatedAt: '2026-10-22T19:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite principal
// ---------------------------------------------------------------------------

describe('MoveTaskUseCase', () => {
  let storage: InMemoryKanbanProjectStorage;
  let taskMoveAdapter: InMemoryTaskMoveAdapter;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let boardRepository: InMemoryBoardRepository;
  let mockClock: SystemClockPort;
  let useCase: MoveTaskUseCase;

  // UUIDs estables para el proyecto principal
  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const memberId = '33333333-3333-4333-8333-333333333333';
  const foreignUserId = '55555555-5555-4555-8555-555555555555';

  // UUIDs para un segundo proyecto (aislamiento horizontal)
  const otherProjectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const otherCreatorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const clockIso = '2026-10-22T21:00:00.000Z';

  let colA: string;
  let colB: string;
  let otherProjectColId: string;

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    taskMoveAdapter = new InMemoryTaskMoveAdapter(storage);
    projectRepository = new InMemoryProjectRepository();
    membershipRepository = new InMemoryMembershipRepository();
    boardRepository = new InMemoryBoardRepository(storage);

    mockClock = {
      now: () => new Date(clockIso),
      isoString: () => clockIso,
    };

    useCase = new MoveTaskUseCase(
      taskMoveAdapter,
      projectRepository,
      membershipRepository,
      mockClock,
    );

    // -----------------------------------------------------------------------
    // Proyecto principal
    // -----------------------------------------------------------------------
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
      removedAt: null,
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    await membershipRepository.addMember({
      projectId,
      userId: memberId,
      role: 'collaborator',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    // Crear tablero del proyecto principal con 2 columnas (colA, colB)
    const board = await boardRepository.findOrCreateDefaultBoard(projectId);
    colA = board.columns[0]!.id;
    colB = board.columns[1]!.id;

    // -----------------------------------------------------------------------
    // Proyecto extranjero (para aislamiento horizontal)
    // -----------------------------------------------------------------------
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
      removedAt: null,
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
    const otherBoard = await boardRepository.findOrCreateDefaultBoard(otherProjectId);
    otherProjectColId = otherBoard.columns[0]!.id;
  });

  // =========================================================================
  // Helpers internos de setup de tareas
  // =========================================================================

  /** Carga N tareas en una columna con orderIndex 0..N-1 */
  function loadTasksInColumn(columnId: string, count: number, pId = projectId): Task[] {
    const snap = storage.getSnapshot(pId);
    const tasks: Task[] = [];
    for (let i = 0; i < count; i++) {
      const t = makeTask({ id: crypto.randomUUID(), projectId: pId, columnId, orderIndex: i });
      snap.tasks.push(t);
      tasks.push(t);
    }
    storage.commitSnapshot(pId, snap);
    return tasks;
  }

  /** Carga un evento previo de auditoría en el proyecto */
  function loadPriorEvent(taskId: string, pId = projectId): TaskActivityEvent {
    const snap = storage.getSnapshot(pId);
    const ev: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId,
      projectId: pId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: snap.tasks.find((t) => t.id === taskId)?.columnId,
      createdAt: '2026-10-22T19:00:00.000Z',
    };
    snap.events.push(ev);
    storage.commitSnapshot(pId, snap);
    return ev;
  }

  // =========================================================================
  // 1. MOVIMIENTOS DENTRO DE LA MISMA COLUMNA (reordenamiento)
  // =========================================================================

  describe('intra-column reordering', () => {
    it('moves task from position 0 to position 2 (beginning → end): single MOVED event, original/final indices, same columns, clock timestamp', async () => {
      const tasks = loadTasksInColumn(colA, 3);
      const taskToMove = tasks[0]!;

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colA,
        destinationIndex: 2,
        requestingUserId: creatorId,
      });

      // La tarea movida debe estar en la última posición con updatedAt del reloj
      expect(result.task.orderIndex).toBe(2);
      expect(result.task.columnId).toBe(colA);
      expect(result.task.updatedAt).toBe(clockIso);

      // Evento único de auditoría MOVED
      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('MOVED');
      expect(result.activity!.fromColumnId).toBe(colA);
      expect(result.activity!.toColumnId).toBe(colA);
      expect(result.activity!.actorId).toBe(creatorId);
      expect(result.activity!.projectId).toBe(projectId);
      expect(result.activity!.taskId).toBe(taskToMove.id);
      expect(result.activity!.createdAt).toBe(clockIso);
      expect(result.activity!.details).toEqual({
        fromIndex: 0,
        toIndex: 2,
      });

      // Verificar índices contiguos en el storage
      const snap = storage.getSnapshot(projectId);
      const colATasks = snap.tasks
        .filter((t) => t.columnId === colA)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      expect(colATasks.map((t) => t.orderIndex)).toEqual([0, 1, 2]);
      const indices = colATasks.map((t) => t.orderIndex);
      const unique = new Set(indices);
      expect(unique.size).toBe(indices.length);

      // Exactamente un evento en storage
      expect(snap.events).toHaveLength(1);
      expect(snap.events[0]!.id).toBe(result.activity!.id);
    });

    it('moves task from position 2 to position 0 (end → beginning): contiguous indices 0..2 and MOVED event', async () => {
      const tasks = loadTasksInColumn(colA, 3);
      const taskToMove = tasks[2]!;

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colA,
        destinationIndex: 0,
        requestingUserId: memberId,
      });

      expect(result.task.orderIndex).toBe(0);
      expect(result.task.updatedAt).toBe(clockIso);
      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('MOVED');
      expect(result.activity!.fromColumnId).toBe(colA);
      expect(result.activity!.toColumnId).toBe(colA);
      expect(result.activity!.details).toEqual({
        fromIndex: 2,
        toIndex: 0,
      });

      const snap = storage.getSnapshot(projectId);
      const colATasks = snap.tasks
        .filter((t) => t.columnId === colA)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      expect(colATasks.map((t) => t.orderIndex)).toEqual([0, 1, 2]);
    });

    it('moves task from position 0 to position 1 (intermediate position): contiguous indices and MOVED event', async () => {
      const tasks = loadTasksInColumn(colA, 4);
      const taskToMove = tasks[0]!;

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colA,
        destinationIndex: 1,
        requestingUserId: creatorId,
      });

      expect(result.task.columnId).toBe(colA);
      expect(result.task.orderIndex).toBe(1);
      expect(result.task.updatedAt).toBe(clockIso);
      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('MOVED');
      expect(result.activity!.details).toEqual({
        fromIndex: 0,
        toIndex: 1,
      });

      const snap = storage.getSnapshot(projectId);
      const colATasks = snap.tasks
        .filter((t) => t.columnId === colA)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      expect(colATasks.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
    });

    it('is idempotent when task is already at the effective position: complete snapshot intact, no event, no updatedAt change', async () => {
      const tasks = loadTasksInColumn(colA, 3);
      const taskToMove = tasks[1]!; // Ya en posición 1

      const snapBefore = storage.getSnapshot(projectId);

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colA,
        destinationIndex: 1,
        requestingUserId: creatorId,
      });

      // No se emite actividad
      expect(result.activity).toBeNull();
      // El updatedAt devuelto no se modifica con el reloj
      expect(result.task.updatedAt).toBe(taskToMove.updatedAt);

      // Snapshot completo exactamente intacto (tareas, eventos, tablero, revisión)
      const snapAfter = storage.getSnapshot(projectId);
      expect(snapAfter).toEqual(snapBefore);
    });

    it('clamps out-of-range destinationIndex to end of column: valid contiguous indices and MOVED event', async () => {
      const tasks = loadTasksInColumn(colA, 3);
      const taskToMove = tasks[0]!;

      // destinationIndex=99 >> 2 (longitud - 1 sin la tarea movida)
      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colA,
        destinationIndex: 99,
        requestingUserId: creatorId,
      });

      expect(result.task.orderIndex).toBe(2);
      expect(result.activity).not.toBeNull();
      expect(result.activity!.details).toEqual({
        fromIndex: 0,
        toIndex: 2,
      });

      const snap = storage.getSnapshot(projectId);
      const colATasks = snap.tasks
        .filter((t) => t.columnId === colA)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      // La tarea debe estar al final
      const movedTask = snap.tasks.find((t) => t.id === taskToMove.id)!;
      expect(movedTask.orderIndex).toBe(2);
      expect(colATasks.map((t) => t.orderIndex)).toEqual([0, 1, 2]);
    });
  });

  // =========================================================================
  // 2. MOVIMIENTO ENTRE COLUMNAS
  // =========================================================================

  describe('inter-column moves', () => {
    it('moves task from colA to empty colB at position 0: single task, orderIndex 0, MOVED event emitted', async () => {
      const tasks = loadTasksInColumn(colA, 1);
      const taskToMove = tasks[0]!;
      const priorEvent = loadPriorEvent(taskToMove.id);

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colB,
        destinationIndex: 0,
        requestingUserId: creatorId,
      });

      // La tarea debe estar en colB con orderIndex 0
      expect(result.task.columnId).toBe(colB);
      expect(result.task.orderIndex).toBe(0);
      expect(result.task.updatedAt).toBe(clockIso);

      // Debe haberse emitido exactamente 1 evento MOVED
      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('MOVED');
      expect(result.activity!.fromColumnId).toBe(colA);
      expect(result.activity!.toColumnId).toBe(colB);
      expect(result.activity!.actorId).toBe(creatorId);
      expect(result.activity!.projectId).toBe(projectId);
      expect(result.activity!.taskId).toBe(taskToMove.id);
      expect(result.activity!.createdAt).toBe(clockIso);
      expect(result.activity!.details).toEqual({
        fromIndex: 0,
        toIndex: 0,
      });

      // Verificar estado en storage
      const snap = storage.getSnapshot(projectId);
      expect(snap.tasks.find((t) => t.id === taskToMove.id)?.columnId).toBe(colB);
      const colARemaining = snap.tasks.filter((t) => t.columnId === colA);
      expect(colARemaining).toHaveLength(0);

      // El evento previo (CREATED) debe seguir intacto en auditoría
      const allEvents = snap.events;
      expect(allEvents.some((e) => e.id === priorEvent.id)).toBe(true);
      expect(allEvents.some((e) => e.action === 'MOVED')).toBe(true);
      expect(allEvents).toHaveLength(2);
    });

    it('moves task between columns 2→0: fromIndex=2 and toIndex=0, contiguous ordering in both columns', async () => {
      const tasksA = loadTasksInColumn(colA, 3);
      loadTasksInColumn(colB, 2);
      const taskToMove = tasksA[2]!; // Índice original 2 en colA

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colB,
        destinationIndex: 0,
        requestingUserId: creatorId,
      });

      expect(result.task.columnId).toBe(colB);
      expect(result.task.orderIndex).toBe(0);
      expect(result.task.updatedAt).toBe(clockIso);

      // Evento MOVED con fromIndex=2 y toIndex=0
      expect(result.activity).not.toBeNull();
      expect(result.activity!.action).toBe('MOVED');
      expect(result.activity!.fromColumnId).toBe(colA);
      expect(result.activity!.toColumnId).toBe(colB);
      expect(result.activity!.details).toEqual({
        fromIndex: 2,
        toIndex: 0,
      });

      const snap = storage.getSnapshot(projectId);
      const colAFinal = snap.tasks
        .filter((t) => t.columnId === colA)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const colBFinal = snap.tasks
        .filter((t) => t.columnId === colB)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      // colA debe tener 2 tareas con índices 0,1
      expect(colAFinal.map((t) => t.orderIndex)).toEqual([0, 1]);
      // colB debe tener 3 tareas con índices 0,1,2 (la tarea movida en posición 0)
      expect(colBFinal.map((t) => t.orderIndex)).toEqual([0, 1, 2]);
      expect(colBFinal[0]!.id).toBe(taskToMove.id);

      // Sin índices duplicados en ninguna columna
      const indicesA = colAFinal.map((t) => t.orderIndex);
      expect(new Set(indicesA).size).toBe(indicesA.length);
      const indicesB = colBFinal.map((t) => t.orderIndex);
      expect(new Set(indicesB).size).toBe(indicesB.length);
    });

    it('moves task to intermediate position of non-empty colB: all indices contiguous and unique', async () => {
      const tasksA = loadTasksInColumn(colA, 2);
      loadTasksInColumn(colB, 3);
      const taskToMove = tasksA[0]!;

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colB,
        destinationIndex: 2,
        requestingUserId: memberId,
      });

      expect(result.activity!.details).toEqual({
        fromIndex: 0,
        toIndex: 2,
      });

      const snap = storage.getSnapshot(projectId);
      const colBFinal = snap.tasks
        .filter((t) => t.columnId === colB)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      expect(colBFinal.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
      expect(colBFinal[2]!.id).toBe(taskToMove.id);
    });

    it('moves task to end of non-empty colB (out-of-range index clamped): contiguous indices', async () => {
      const tasksA = loadTasksInColumn(colA, 2);
      loadTasksInColumn(colB, 2);
      const taskToMove = tasksA[0]!;

      const result = await useCase.execute({
        projectId,
        taskId: taskToMove.id,
        destinationColumnId: colB,
        destinationIndex: 100,
        requestingUserId: creatorId,
      });

      expect(result.activity!.details).toEqual({
        fromIndex: 0,
        toIndex: 2,
      });

      const snap = storage.getSnapshot(projectId);
      const colBFinal = snap.tasks
        .filter((t) => t.columnId === colB)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      expect(colBFinal.map((t) => t.orderIndex)).toEqual([0, 1, 2]);
      expect(colBFinal[2]!.id).toBe(taskToMove.id); // Al final
    });
  });

  // =========================================================================
  // 3. AUTORIZACIÓN CONTEXTUAL (acceso denegado)
  // =========================================================================

  describe('contextual authorization', () => {
    it('rejects with 404 when requestingUserId is not a member of the project', async () => {
      const tasks = loadTasksInColumn(colA, 1);
      const taskToMove = tasks[0]!;

      await expect(
        useCase.execute({
          projectId,
          taskId: taskToMove.id,
          destinationColumnId: colB,
          destinationIndex: 0,
          requestingUserId: foreignUserId,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 404 when the project does not exist', async () => {
      const nonExistentProjectId = crypto.randomUUID();
      const taskId = crypto.randomUUID();

      await expect(
        useCase.execute({
          projectId: nonExistentProjectId,
          taskId,
          destinationColumnId: crypto.randomUUID(),
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  // =========================================================================
  // 4. AISLAMIENTO HORIZONTAL — tarea o columna de otro proyecto
  // =========================================================================

  describe('horizontal isolation', () => {
    it('rejects with 404 when trying to move a task belonging to another project', async () => {
      // Crear tarea en el otherProject
      const otherTasks = loadTasksInColumn(otherProjectColId, 1, otherProjectId);
      const foreignTask = otherTasks[0]!;

      // El usuario creatorId pertenece al projectId, pero no al otherProjectId
      // La tarea pertenece al otherProjectId → debe rechazarse con 404
      await expect(
        useCase.execute({
          projectId,
          taskId: foreignTask.id,
          destinationColumnId: colB,
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });

      // Estado del otherProject inalterado
      const snapOther = storage.getSnapshot(otherProjectId);
      expect(snapOther.tasks.find((t) => t.id === foreignTask.id)?.columnId).toBe(
        otherProjectColId,
      );
    });

    it('rejects with 400 when destinationColumnId belongs to another project', async () => {
      const tasks = loadTasksInColumn(colA, 1);
      const taskToMove = tasks[0]!;

      // La columna destino pertenece al otro proyecto → columna inválida para este tablero
      await expect(
        useCase.execute({
          projectId,
          taskId: taskToMove.id,
          destinationColumnId: otherProjectColId,
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });

      // La tarea sigue en su columna original
      const snap = storage.getSnapshot(projectId);
      expect(snap.tasks.find((t) => t.id === taskToMove.id)?.columnId).toBe(colA);
      // No se emitió ningún evento MOVED
      expect(snap.events.some((e) => e.action === 'MOVED')).toBe(false);
    });

    it('rejects with 400 when destinationColumnId does not exist at all', async () => {
      const tasks = loadTasksInColumn(colA, 1);
      const taskToMove = tasks[0]!;
      const nonExistentColId = crypto.randomUUID();

      await expect(
        useCase.execute({
          projectId,
          taskId: taskToMove.id,
          destinationColumnId: nonExistentColId,
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
      ).rejects.toThrow(BoardColumnNotFoundError);
    });
  });

  // =========================================================================
  // 5. ATOMICIDAD — fallo después de preparar y antes de publicar
  // =========================================================================

  describe('atomicity on failure', () => {
    it('reverses entire state including prior audit when fault is injected before publish (inter-column)', async () => {
      const tasksA = loadTasksInColumn(colA, 2);
      loadTasksInColumn(colB, 1);
      const taskToMove = tasksA[0]!;
      const priorEvent = loadPriorEvent(taskToMove.id);

      // Capturar estado completo antes del intento
      const snapBefore = storage.getSnapshot(projectId);
      expect(snapBefore.tasks).toHaveLength(3);
      expect(snapBefore.events).toHaveLength(1);

      // Inducir fallo adversarial antes de la publicación atómica
      taskMoveAdapter.setFaultInjectionPoint('before_publish');

      await expect(
        useCase.execute({
          projectId,
          taskId: taskToMove.id,
          destinationColumnId: colB,
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
      ).rejects.toThrow('Simulated failure after preparing move state');

      // Estado completamente inalterado (tareas, eventos, tablero, revisión)
      const snapAfter = storage.getSnapshot(projectId);
      expect(snapAfter.tasks).toHaveLength(3);
      expect(snapAfter.events).toHaveLength(1);
      expect(snapAfter.tasks).toEqual(snapBefore.tasks);
      expect(snapAfter.events).toEqual(snapBefore.events);
      expect(snapAfter.board).toEqual(snapBefore.board);
      expect(snapAfter.boardRevision).toBe(snapBefore.boardRevision);

      // La auditoría previa (CREATED) sigue intacta
      expect(snapAfter.events.some((e) => e.id === priorEvent.id)).toBe(true);
      expect(snapAfter.events.some((e) => e.action === 'MOVED')).toBe(false);

      // La tarea sigue en su columna original
      expect(snapAfter.tasks.find((t) => t.id === taskToMove.id)?.columnId).toBe(colA);

      // Limpiar punto de inyección
      taskMoveAdapter.setFaultInjectionPoint(null);
    });

    it('reverses entire state when fault is injected after preparing audit in intra-column move: snapshot complete intact, prior events preserved', async () => {
      const tasks = loadTasksInColumn(colA, 3);
      const taskToMove = tasks[0]!;
      const priorEvent = loadPriorEvent(taskToMove.id);

      const snapBefore = storage.getSnapshot(projectId);
      expect(snapBefore.events).toHaveLength(1);

      taskMoveAdapter.setFaultInjectionPoint('before_publish');

      await expect(
        useCase.execute({
          projectId,
          taskId: taskToMove.id,
          destinationColumnId: colA,
          destinationIndex: 2,
          requestingUserId: creatorId,
        }),
      ).rejects.toThrow('Simulated failure after preparing move state');

      const snapAfter = storage.getSnapshot(projectId);
      // Snapshot completo exactamente intacto
      expect(snapAfter).toEqual(snapBefore);
      expect(snapAfter.events.some((e) => e.id === priorEvent.id)).toBe(true);
      expect(snapAfter.events.some((e) => e.action === 'MOVED')).toBe(false);
      expect(snapAfter.tasks.find((t) => t.id === taskToMove.id)?.orderIndex).toBe(0);

      taskMoveAdapter.setFaultInjectionPoint(null);
    });
  });

  // =========================================================================
  // 6. CONCURRENCIA — movimientos simultáneos sin pérdidas ni índices duplicados
  // =========================================================================

  describe('concurrent moves', () => {
    it('serializes two concurrent inter-column moves: preserves original IDs, no lost tasks, no duplicate indices, exact MOVED audit per effective move', async () => {
      // colA tiene 2 tareas, colB está vacía
      const tasksA = loadTasksInColumn(colA, 2);
      const task0 = tasksA[0]!;
      const task1 = tasksA[1]!;
      const originalIds = new Set([task0.id, task1.id]);

      // Disparar dos movimientos concurrentes (task0 y task1 ambas a colB)
      const [res0, res1] = await Promise.all([
        useCase.execute({
          projectId,
          taskId: task0.id,
          destinationColumnId: colB,
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
        useCase.execute({
          projectId,
          taskId: task1.id,
          destinationColumnId: colB,
          destinationIndex: 0,
          requestingUserId: memberId,
        }),
      ]);

      // Ambos resultados son distintos en id
      expect(res0.task.id).not.toBe(res1.task.id);

      // Verificar estado en storage
      const snap = storage.getSnapshot(projectId);

      // Conserva exactamente los IDs originales
      const currentIds = new Set(snap.tasks.map((t) => t.id));
      expect(currentIds).toEqual(originalIds);

      // colA debe estar vacía
      expect(snap.tasks.filter((t) => t.columnId === colA)).toHaveLength(0);

      // colB debe tener exactamente 2 tareas con índices contiguos sin duplicados
      const colBFinal = snap.tasks
        .filter((t) => t.columnId === colB)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      expect(colBFinal).toHaveLength(2);
      expect(colBFinal.map((t) => t.orderIndex)).toEqual([0, 1]);
      const colBIndices = colBFinal.map((t) => t.orderIndex);
      expect(new Set(colBIndices).size).toBe(colBIndices.length);

      // Total de tareas en el proyecto sin pérdidas
      expect(snap.tasks).toHaveLength(2);

      // Exactamente un evento MOVED por tarea movida con sus taskIds correspondientes
      const movedEvents = snap.events.filter((e) => e.action === 'MOVED');
      expect(movedEvents).toHaveLength(2);
      const movedTaskIds = new Set(movedEvents.map((e) => e.taskId));
      expect(movedTaskIds.has(task0.id)).toBe(true);
      expect(movedTaskIds.has(task1.id)).toBe(true);
    });

    it('serializes concurrent intra-column moves: preserves original IDs, no duplicate indices, exact MOVED audit per effective move', async () => {
      const tasks = loadTasksInColumn(colA, 4);
      const originalIds = new Set(tasks.map((t) => t.id));
      const target0 = tasks[0]!;
      const target3 = tasks[3]!;

      // Mover task[0] al final y task[3] al inicio concurrentemente
      const [res0, res3] = await Promise.all([
        useCase.execute({
          projectId,
          taskId: target0.id,
          destinationColumnId: colA,
          destinationIndex: 3,
          requestingUserId: creatorId,
        }),
        useCase.execute({
          projectId,
          taskId: target3.id,
          destinationColumnId: colA,
          destinationIndex: 0,
          requestingUserId: memberId,
        }),
      ]);

      expect(res0.activity).not.toBeNull();
      expect(res3.activity).not.toBeNull();

      const snap = storage.getSnapshot(projectId);

      // Conserva exactamente los IDs originales sin pérdidas ni corrupciones
      const currentIds = new Set(snap.tasks.map((t) => t.id));
      expect(currentIds).toEqual(originalIds);

      const colAFinal = snap.tasks
        .filter((t) => t.columnId === colA)
        .sort((a, b) => a.orderIndex - b.orderIndex);

      // 4 tareas con índices 0,1,2,3 sin duplicados
      expect(colAFinal).toHaveLength(4);
      expect(colAFinal.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
      const indices = colAFinal.map((t) => t.orderIndex);
      expect(new Set(indices).size).toBe(indices.length);

      // Exactamente 2 eventos MOVED emitidos para los movimientos efectivos
      const movedEvents = snap.events.filter((e) => e.action === 'MOVED');
      expect(movedEvents).toHaveLength(2);
      const movedTaskIds = new Set(movedEvents.map((e) => e.taskId));
      expect(movedTaskIds.has(target0.id)).toBe(true);
      expect(movedTaskIds.has(target3.id)).toBe(true);
    });
  });

  // =========================================================================
  // 7. VALIDACIÓN ZOD y casos de borde del esquema
  // =========================================================================

  describe('Zod schema validation', () => {
    it('rejects negative destinationIndex', async () => {
      const tasks = loadTasksInColumn(colA, 1);

      await expect(
        useCase.execute({
          projectId,
          taskId: tasks[0]!.id,
          destinationColumnId: colB,
          destinationIndex: -1,
          requestingUserId: creatorId,
        }),
      ).rejects.toThrow();
    });

    it('rejects non-UUID destinationColumnId', async () => {
      const tasks = loadTasksInColumn(colA, 1);

      await expect(
        useCase.execute({
          projectId,
          taskId: tasks[0]!.id,
          destinationColumnId: 'not-a-uuid',
          destinationIndex: 0,
          requestingUserId: creatorId,
        }),
      ).rejects.toThrow();
    });
  });
});
