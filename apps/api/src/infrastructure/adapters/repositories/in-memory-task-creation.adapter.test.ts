import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoardColumnNotFoundError,
  type Board,
  type Task,
  type TaskActivityEvent,
} from '@is488/shared';
import { InMemoryKanbanProjectStorage } from './in-memory-kanban-project.storage.js';
import { InMemoryTaskCreationAdapter } from './in-memory-task-creation.adapter.js';

describe('InMemoryTaskCreationAdapter', () => {
  let storage: InMemoryKanbanProjectStorage;
  let adapter: InMemoryTaskCreationAdapter;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const boardId = '55555555-5555-4555-8555-555555555555';
  const columnId = '22222222-2222-4222-8222-222222222222';
  const creatorId = '33333333-3333-4333-8333-333333333333';
  const memberId = '44444444-4444-4444-8444-444444444444';

  beforeEach(() => {
    storage = new InMemoryKanbanProjectStorage();
    adapter = new InMemoryTaskCreationAdapter(storage);

    // Inicializar tablero con una columna válida y boardRevision = 1
    const board: Board = {
      id: boardId,
      projectId,
      columns: [
        {
          id: columnId,
          boardId,
          name: 'Por hacer',
          category: 'TODO',
          orderIndex: 0,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    };

    storage.commitSnapshot(projectId, {
      board,
      tasks: [],
      events: [],
      boardRevision: 1,
    });
  });

  it('creates task and CREATED activity event atomically with valid inputs and real adapter execution', async () => {
    const clockTimestamp = '2026-10-22T21:00:00.000Z';
    const result = await adapter.executeAtomicTaskCreation({
      projectId,
      columnId,
      title: 'Tarea atómica en adapter',
      description: 'Prueba unitaria directa del adaptador',
      priority: 'HIGH',
      labels: ['infra', 'storage'],
      creatorId,
      assigneeIds: [memberId],
      timestamp: clockTimestamp,
    });

    expect(result.task.id).toBeDefined();
    expect(result.task.projectId).toBe(projectId);
    expect(result.task.columnId).toBe(columnId);
    expect(result.task.title).toBe('Tarea atómica en adapter');
    expect(result.task.orderIndex).toBe(0);
    expect(result.task.createdAt).toBe(clockTimestamp);
    expect(result.task.updatedAt).toBe(clockTimestamp);

    expect(result.activity.id).toBeDefined();
    expect(result.activity.taskId).toBe(result.task.id);
    expect(result.activity.projectId).toBe(projectId);
    expect(result.activity.actorId).toBe(creatorId);
    expect(result.activity.action).toBe('CREATED');
    expect(result.activity.toColumnId).toBe(columnId);
    expect(result.activity.createdAt).toBe(clockTimestamp);

    // Verificar almacenamiento persistido
    const snapshot = storage.getSnapshot(projectId);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.boardRevision).toBe(1); // Task creation no muta el tablero, revision conservada
  });

  it('completes failure test: valid inputs, real adapter execution and fault induced after preparing task/event before publishing, preserving entire state including prior audit', async () => {
    // 1. Configurar estado preexistente (auditoría previa, tarea previa y boardRevision)
    const preTaskId = crypto.randomUUID();
    const preTask: Task = {
      id: preTaskId,
      projectId,
      columnId,
      title: 'Tarea Previa',
      priority: 'LOW',
      orderIndex: 0,
      labels: ['previo'],
      creatorId,
      assigneeIds: [],
      createdAt: '2026-10-22T20:00:00.000Z',
      updatedAt: '2026-10-22T20:00:00.000Z',
    };

    const preEvent: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId: preTaskId,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: columnId,
      details: { initial: true },
      createdAt: '2026-10-22T20:00:00.000Z',
    };

    const state = storage.getSnapshot(projectId);
    state.tasks.push(preTask);
    state.events.push(preEvent);
    storage.commitSnapshot(projectId, state);

    // Capturar snapshot íntegro antes del fallo
    const snapshotBefore = storage.getSnapshot(projectId);
    expect(snapshotBefore.tasks).toHaveLength(1);
    expect(snapshotBefore.events).toHaveLength(1);
    expect(snapshotBefore.boardRevision).toBe(1);

    // 2. Inducir fallo adversarial después de preparar tarea y evento, antes de publicar
    adapter.setFaultInjectionPoint('before_publish');

    // 3. Ejecución real del adaptador con entradas válidas
    await expect(
      adapter.executeAtomicTaskCreation({
        projectId,
        columnId,
        title: 'Tarea Válida que Fallará',
        priority: 'MEDIUM',
        labels: [],
        creatorId,
        assigneeIds: [],
        timestamp: '2026-10-22T21:00:00.000Z',
      }),
    ).rejects.toThrow(
      'Simulated failure after preparing task and event before publishing atomic state',
    );

    // 4. Compara TODO el estado, incluida auditoría previa: 100% idéntico e intacto
    const snapshotAfter = storage.getSnapshot(projectId);
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(snapshotAfter.board).toEqual(snapshotBefore.board);
    expect(snapshotAfter.boardRevision).toBe(snapshotBefore.boardRevision);
    expect(snapshotAfter.tasks).toEqual(snapshotBefore.tasks);
    expect(snapshotAfter.events).toEqual(snapshotBefore.events);

    // Limpiar punto de inyección
    adapter.setFaultInjectionPoint(null);
  });

  it('rejects with 404 (BoardColumnNotFoundError) when columnId is a valid non-existent UUID', async () => {
    // UUID v4 sintácticamente válido pero no perteneciente al tablero
    const absentColumnId = crypto.randomUUID();

    const snapshotBefore = storage.getSnapshot(projectId);

    await expect(
      adapter.executeAtomicTaskCreation({
        projectId,
        columnId: absentColumnId,
        title: 'Tarea en columna ausente',
        priority: 'MEDIUM',
        labels: [],
        creatorId,
        assigneeIds: [],
        timestamp: '2026-10-22T21:00:00.000Z',
      }),
    ).rejects.toThrow(BoardColumnNotFoundError);

    const snapshotAfter = storage.getSnapshot(projectId);
    expect(snapshotAfter).toEqual(snapshotBefore);
  });

  it('handles two concurrent creations within a column with previous tasks: contiguous indices, exactly one CREATED per task and clock timestamps', async () => {
    // 1. Configurar dos tareas previas (índices 0 y 1)
    const pre0Id = crypto.randomUUID();
    const pre1Id = crypto.randomUUID();

    const pre0: Task = {
      id: pre0Id,
      projectId,
      columnId,
      title: 'T0 Existente',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
      createdAt: '2026-10-22T19:00:00.000Z',
      updatedAt: '2026-10-22T19:00:00.000Z',
    };

    const pre1: Task = {
      id: pre1Id,
      projectId,
      columnId,
      title: 'T1 Existente',
      priority: 'MEDIUM',
      orderIndex: 1,
      labels: [],
      creatorId,
      assigneeIds: [],
      createdAt: '2026-10-22T19:30:00.000Z',
      updatedAt: '2026-10-22T19:30:00.000Z',
    };

    const preEvent0: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId: pre0Id,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: columnId,
      createdAt: '2026-10-22T19:00:00.000Z',
    };

    const preEvent1: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId: pre1Id,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: columnId,
      createdAt: '2026-10-22T19:30:00.000Z',
    };

    const st = storage.getSnapshot(projectId);
    st.tasks.push(pre0, pre1);
    st.events.push(preEvent0, preEvent1);
    storage.commitSnapshot(projectId, st);

    const clockTimestamp = '2026-10-22T21:00:00.000Z';

    const p1 = adapter.executeAtomicTaskCreation({
      projectId,
      columnId,
      title: 'Tarea Concurrente A',
      priority: 'HIGH',
      labels: [],
      creatorId,
      assigneeIds: [],
      timestamp: clockTimestamp,
    });

    const p2 = adapter.executeAtomicTaskCreation({
      projectId,
      columnId,
      title: 'Tarea Concurrente B',
      priority: 'URGENT',
      labels: [],
      creatorId,
      assigneeIds: [],
      timestamp: clockTimestamp,
    });

    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.task.id).not.toBe(r2.task.id);

    // Índices contiguos [2, 3] continuando tras las tareas previas
    const indices = [r1.task.orderIndex, r2.task.orderIndex].sort((a, b) => a - b);
    expect(indices).toEqual([2, 3]);

    // Timestamps del reloj
    expect(r1.task.createdAt).toBe(clockTimestamp);
    expect(r1.task.updatedAt).toBe(clockTimestamp);
    expect(r1.activity.createdAt).toBe(clockTimestamp);

    expect(r2.task.createdAt).toBe(clockTimestamp);
    expect(r2.task.updatedAt).toBe(clockTimestamp);
    expect(r2.activity.createdAt).toBe(clockTimestamp);

    // Exactamente un evento CREATED por cada nueva tarea
    const finalSnapshot = storage.getSnapshot(projectId);
    expect(finalSnapshot.tasks).toHaveLength(4);

    const tasksInCol = finalSnapshot.tasks.sort((a, b) => a.orderIndex - b.orderIndex);
    expect(tasksInCol.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);

    const r1Events = finalSnapshot.events.filter((e) => e.taskId === r1.task.id);
    expect(r1Events).toHaveLength(1);
    expect(r1Events[0]?.action).toBe('CREATED');

    const r2Events = finalSnapshot.events.filter((e) => e.taskId === r2.task.id);
    expect(r2Events).toHaveLength(1);
    expect(r2Events[0]?.action).toBe('CREATED');
  });
});
