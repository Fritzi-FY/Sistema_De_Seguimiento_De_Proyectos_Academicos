import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryBoardColumnDeletionAdapter } from './in-memory-board-column-deletion.adapter.js';
import { InMemoryBoardRepository } from './in-memory-board.repository.js';
import { InMemoryTaskRepository } from './in-memory-task.repository.js';
import { InMemoryTaskActivityRepository } from './in-memory-task-activity.repository.js';
import { InMemoryKanbanProjectStorage } from './in-memory-kanban-project.storage.js';
import type { Task } from '@is488/shared';
import { BoardColumnNotFoundError } from '@is488/shared';

describe('InMemoryBoardColumnDeletionAdapter (Atomic Project Storage)', () => {
  let storage: InMemoryKanbanProjectStorage;
  let boardRepo: InMemoryBoardRepository;
  let taskRepo: InMemoryTaskRepository;
  let activityRepo: InMemoryTaskActivityRepository;
  let adapter: InMemoryBoardColumnDeletionAdapter;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const actorId = '22222222-2222-4222-8222-222222222222';

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    boardRepo = new InMemoryBoardRepository(storage);
    taskRepo = new InMemoryTaskRepository(storage);
    activityRepo = new InMemoryTaskActivityRepository(storage);
    adapter = new InMemoryBoardColumnDeletionAdapter(storage);

    // Inicializar tablero con 3 columnas canonicas ('Por hacer', 'En progreso', 'Completado')
    await boardRepo.findOrCreateDefaultBoard(projectId);
  });

  it('deletes empty column without task migrations', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    expect(board!.columns).toHaveLength(3);
    const colToDelete = board!.columns[1]!; // 'En progreso'

    const result = await adapter.executeAtomicColumnDeletion({
      projectId,
      columnId: colToDelete.id,
      actorId,
      timestamp: '2026-10-22T20:00:00.000Z',
    });

    expect(result.deletedColumnId).toBe(colToDelete.id);
    expect(result.migratedTasksCount).toBe(0);

    const updated = await boardRepo.findByProjectId(projectId);
    expect(updated!.columns).toHaveLength(2);
    expect(updated!.columns.map((c) => c.orderIndex)).toEqual([0, 1]);
    expect(updated!.columns.find((c) => c.id === colToDelete.id)).toBeUndefined();
    expect(updated!.updatedAt).toBe('2026-10-22T20:00:00.000Z');
  });

  it('migrates tasks with strictly contiguous orderIndex, exact timestamps, and records batch audit events', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;
    const targetCol = board!.columns[1]!;
    const exactTimestamp = '2026-10-22T20:15:30.500Z';

    await taskRepo.create({
      projectId,
      columnId: targetCol.id,
      title: 'Target Task 0',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    const s1 = await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Source Task 1',
      priority: 'MEDIUM',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    const s2 = await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Source Task 2',
      priority: 'HIGH',
      orderIndex: 1,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    const result = await adapter.executeAtomicColumnDeletion({
      projectId,
      columnId: sourceCol.id,
      targetColumnId: targetCol.id,
      actorId,
      reason: 'Migracion por reorganizacion academica',
      timestamp: exactTimestamp,
    });

    expect(result.deletedColumnId).toBe(sourceCol.id);
    expect(result.migratedTasksCount).toBe(2);

    // Verificar tablero actualizado con indices contiguos
    const updatedBoard = await boardRepo.findByProjectId(projectId);
    expect(updatedBoard!.columns).toHaveLength(2);
    expect(updatedBoard!.columns.map((c) => c.orderIndex)).toEqual([0, 1]);
    expect(updatedBoard!.updatedAt).toBe(exactTimestamp);

    // Verificar tareas migradas y orden contiguo [0, 1, 2] en columna destino
    const targetTasks = await taskRepo.findByColumnId(targetCol.id);
    expect(targetTasks).toHaveLength(3);
    targetTasks.sort((a, b) => a.orderIndex - b.orderIndex);
    expect(targetTasks.map((t) => t.orderIndex)).toEqual([0, 1, 2]);

    const migrated1 = targetTasks.find((t) => t.id === s1.id)!;
    expect(migrated1.columnId).toBe(targetCol.id);
    expect(migrated1.orderIndex).toBe(1);
    expect(migrated1.updatedAt).toBe(exactTimestamp);

    const migrated2 = targetTasks.find((t) => t.id === s2.id)!;
    expect(migrated2.columnId).toBe(targetCol.id);
    expect(migrated2.orderIndex).toBe(2);
    expect(migrated2.updatedAt).toBe(exactTimestamp);

    // Origen sin tareas
    const sourceTasks = await taskRepo.findByColumnId(sourceCol.id);
    expect(sourceTasks).toHaveLength(0);

    // Eventos de auditoria registrados con timestamp exacto
    const events = await activityRepo.findByProjectId(projectId);
    expect(events).toHaveLength(2);
    for (const ev of events) {
      expect(ev.action).toBe('COLUMN_DELETED_REALLOCATION');
      expect(ev.fromColumnId).toBe(sourceCol.id);
      expect(ev.toColumnId).toBe(targetCol.id);
      expect(ev.actorId).toBe(actorId);
      expect(ev.createdAt).toBe(exactTimestamp);
      expect(ev.details).toEqual({ reason: 'Migracion por reorganizacion academica' });
    }
  });

  it('leaves shared state completely intact when preparation fails (including preexisting audit trail)', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;
    const targetCol = board!.columns[1]!;

    // Auditoria previa preexistente en el proyecto
    await activityRepo.recordEvent({
      taskId: 'preexisting-task-id',
      projectId,
      actorId,
      action: 'CREATED',
    });

    const task = await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Tarea en prueba de preparacion fallida',
      priority: 'HIGH',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    // Inyectar fallo antes de la publicacion atomica
    adapter.setFaultInjectionPoint('before_publish');

    await expect(
      adapter.executeAtomicColumnDeletion({
        projectId,
        columnId: sourceCol.id,
        targetColumnId: targetCol.id,
        actorId,
        timestamp: new Date().toISOString(),
      }),
    ).rejects.toThrow('Simulated failure before publishing atomic state');

    // 1. Tareas completamente inalteradas en columna origen
    const taskAfter = await taskRepo.findById(task.id);
    expect(taskAfter!.columnId).toBe(sourceCol.id);
    expect(taskAfter!.orderIndex).toBe(0);

    // 2. Auditoria preexistente intacta (1 solo evento, sin eventos huerfanos)
    const eventsAfter = await activityRepo.findByProjectId(projectId);
    expect(eventsAfter).toHaveLength(1);
    expect(eventsAfter[0]!.action).toBe('CREATED');

    // 3. Tablero completamente intacto con sus 3 columnas originales
    const currentBoard = await boardRepo.findByProjectId(projectId);
    expect(currentBoard!.columns).toHaveLength(3);
    expect(currentBoard!.columns.some((c) => c.id === sourceCol.id)).toBe(true);
    expect(currentBoard!.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
  });

  it('concurrent reads observe intact original state during preparation phase (no intermediate partially published state)', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;
    const targetCol = board!.columns[1]!;

    await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Task in source',
      priority: 'MEDIUM',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    let observedBoardDuringPrep: unknown = null;
    let observedTasksDuringPrep: Task[] = [];
    let observedEventsDuringPrep = -1;

    // Hook de intercalado controlado: se ejecuta durante la fase de preparacion aislada
    adapter.setOnPreparationHook(async () => {
      // Leer el almacen compartido durante la preparacion (snapshot actual)
      const b = await boardRepo.findByProjectId(projectId);
      observedBoardDuringPrep = b;
      observedTasksDuringPrep = await taskRepo.findByColumnId(sourceCol.id);
      const events = await activityRepo.findByProjectId(projectId);
      observedEventsDuringPrep = events.length;
    });

    const result = await adapter.executeAtomicColumnDeletion({
      projectId,
      columnId: sourceCol.id,
      targetColumnId: targetCol.id,
      actorId,
      timestamp: new Date().toISOString(),
    });

    expect(result.migratedTasksCount).toBe(1);

    // Verificar lo que observo la lectura durante la preparacion aislada:
    // Tablero intacto con 3 columnas
    expect((observedBoardDuringPrep as { columns: unknown[] }).columns).toHaveLength(3);
    // Tarea intacta en columna origen
    expect(observedTasksDuringPrep).toHaveLength(1);
    expect(observedTasksDuringPrep[0]?.columnId).toBe(sourceCol.id);
    // 0 eventos observados durante preparacion
    expect(observedEventsDuringPrep).toBe(0);

    // Verificar estado final publicado tras culminar la operacion
    const finalBoard = await boardRepo.findByProjectId(projectId);
    expect(finalBoard!.columns).toHaveLength(2);
    const finalEvents = await activityRepo.findByProjectId(projectId);
    expect(finalEvents).toHaveLength(1);
  });

  it('serializes concurrent writes on the same project using the shared lock manager without lost updates', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;
    const targetCol = board!.columns[1]!;

    let notifyEnteredPreparation!: () => void;
    const enteredPreparationBarrier = new Promise<void>((resolve) => {
      notifyEnteredPreparation = resolve;
    });

    let releasePreparationBarrier!: () => void;
    const preparationBarrier = new Promise<void>((resolve) => {
      releasePreparationBarrier = resolve;
    });

    let addColumnCompleted = false;

    // Hook dentro de la fase de preparacion aislada de la eliminacion (bajo el lock del proyecto)
    adapter.setOnPreparationHook(async () => {
      notifyEnteredPreparation();
      await preparationBarrier;
    });

    // 1. Iniciar la eliminacion atomica
    const deletionPromise = adapter.executeAtomicColumnDeletion({
      projectId,
      columnId: sourceCol.id,
      targetColumnId: targetCol.id,
      actorId,
      timestamp: new Date().toISOString(),
    });

    // 2. Esperar a que la eliminacion haya adquirido el lock del proyecto
    await enteredPreparationBarrier;

    // 3. Capturar explicitamente la promesa concurrente de adicion de columna
    const addColumnPromise = (async () => {
      const currentBoard = await boardRepo.findByProjectId(projectId);
      return boardRepo.addColumn(board!.id, {
        boardId: board!.id,
        name: 'Columna Concurrente',
        category: 'TODO',
        orderIndex: currentBoard!.columns.length,
      });
    })();

    addColumnPromise.then(() => {
      addColumnCompleted = true;
    });

    // Ceder el turno en event loop para que addColumn intente adquirir el lock
    await Promise.resolve();
    expect(addColumnCompleted).toBe(false);

    // 4. Liberar la barrera de preparacion
    releasePreparationBarrier();

    // 5. Capturar y esperar AMBAS promesas explicitamente propagando cualquier rechazo
    const [deletionResult, addedColumn] = await Promise.all([deletionPromise, addColumnPromise]);

    expect(deletionResult.deletedColumnId).toBe(sourceCol.id);
    expect(addedColumn.name).toBe('Columna Concurrente');

    // Tras completar ambas secuencialmente por el lock, el tablero refleja ambos cambios
    const finalBoard = await boardRepo.findByProjectId(projectId);
    expect(finalBoard!.columns).toHaveLength(3);
    expect(finalBoard!.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
    expect(finalBoard!.columns.some((c) => c.name === 'Columna Concurrente')).toBe(true);
    expect(finalBoard!.columns.some((c) => c.id === sourceCol.id)).toBe(false);
  });

  it('proves concurrent column deletion and task creation/movement: no task is ever left pointing to a deleted column', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    const colToDelete = board!.columns[1]!; // 'En progreso'
    const targetCol = board!.columns[2]!; // 'Completado'

    let notifyEnteredPrep!: () => void;
    const enteredPrep = new Promise<void>((resolve) => {
      notifyEnteredPrep = resolve;
    });

    let releasePrep!: () => void;
    const prepBarrier = new Promise<void>((resolve) => {
      releasePrep = resolve;
    });

    adapter.setOnPreparationHook(async () => {
      notifyEnteredPrep();
      await prepBarrier;
    });

    // Iniciar eliminacion de columna
    const deletionPromise = adapter.executeAtomicColumnDeletion({
      projectId,
      columnId: colToDelete.id,
      targetColumnId: targetCol.id,
      actorId,
      timestamp: new Date().toISOString(),
    });

    await enteredPrep;

    // Intentar concurrentemente crear una tarea en la columna que esta siendo eliminada
    const concurrentTaskPromise = taskRepo.create({
      projectId,
      columnId: colToDelete.id,
      title: 'Tarea Concurrente en Columna Eliminada',
      priority: 'HIGH',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    // Liberar la eliminacion para que complete su publicacion
    releasePrep();

    // Esperar eliminacion exitosa
    await deletionPromise;

    // Como la columna ya fue eliminada, la creacion concurrente que esperaba el lock debe fallar con 404
    await expect(concurrentTaskPromise).rejects.toThrow(BoardColumnNotFoundError);

    // Ninguna tarea existe apuntando a la columna eliminada
    const currentBoard = await boardRepo.findByProjectId(projectId);
    expect(currentBoard!.columns.some((c) => c.id === colToDelete.id)).toBe(false);

    const allTasks = await taskRepo.findByProjectId(projectId);
    for (const t of allTasks) {
      expect(currentBoard!.columns.some((c) => c.id === t.columnId)).toBe(true);
    }
  });

  it('preserves strictly contiguous orderIndex in multiple source and target tasks with full audit trail', async () => {
    const board = await boardRepo.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;
    const targetCol = board!.columns[1]!;

    // 2 tareas preexistentes en destino
    await taskRepo.create({
      projectId,
      columnId: targetCol.id,
      title: 'T0',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });
    await taskRepo.create({
      projectId,
      columnId: targetCol.id,
      title: 'T1',
      priority: 'MEDIUM',
      orderIndex: 1,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    // 3 tareas en origen
    const s0 = await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'S0',
      priority: 'HIGH',
      orderIndex: 0,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });
    const s1 = await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'S1',
      priority: 'URGENT',
      orderIndex: 1,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });
    const s2 = await taskRepo.create({
      projectId,
      columnId: sourceCol.id,
      title: 'S2',
      priority: 'LOW',
      orderIndex: 2,
      labels: [],
      creatorId: actorId,
      assigneeIds: [],
    });

    const result = await adapter.executeAtomicColumnDeletion({
      projectId,
      columnId: sourceCol.id,
      targetColumnId: targetCol.id,
      actorId,
      reason: 'Reestructuracion curricular',
      timestamp: '2026-10-22T20:00:00.000Z',
    });

    expect(result.migratedTasksCount).toBe(3);

    const finalTargetTasks = await taskRepo.findByColumnId(targetCol.id);
    expect(finalTargetTasks).toHaveLength(5);
    finalTargetTasks.sort((a, b) => a.orderIndex - b.orderIndex);
    expect(finalTargetTasks.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3, 4]);

    const migratedIds = [s0.id, s1.id, s2.id];
    for (const id of migratedIds) {
      const task = finalTargetTasks.find((t) => t.id === id);
      expect(task).toBeDefined();
      expect(task!.columnId).toBe(targetCol.id);
      expect(task!.updatedAt).toBe('2026-10-22T20:00:00.000Z');
    }

    const events = await activityRepo.findByProjectId(projectId);
    expect(events).toHaveLength(3);
    for (const event of events) {
      expect(event.action).toBe('COLUMN_DELETED_REALLOCATION');
      expect(event.fromColumnId).toBe(sourceCol.id);
      expect(event.toColumnId).toBe(targetCol.id);
      expect(event.actorId).toBe(actorId);
      expect(event.details).toEqual({ reason: 'Reestructuracion curricular' });
      expect(event.createdAt).toBe('2026-10-22T20:00:00.000Z');
    }
  });
});
