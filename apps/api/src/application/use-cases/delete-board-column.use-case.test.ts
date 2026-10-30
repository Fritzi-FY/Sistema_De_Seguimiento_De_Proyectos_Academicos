import { describe, it, expect, beforeEach } from 'vitest';
import { DeleteBoardColumnUseCase } from './delete-board-column.use-case.js';
import { InMemoryBoardColumnDeletionAdapter } from '../../infrastructure/adapters/repositories/in-memory-board-column-deletion.adapter.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';
import { InMemoryTaskRepository } from '../../infrastructure/adapters/repositories/in-memory-task.repository.js';
import { InMemoryTaskActivityRepository } from '../../infrastructure/adapters/repositories/in-memory-task-activity.repository.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import {
  LastColumnDeletionError,
  ColumnNotEmptyError,
  InvalidDestinationColumnError,
} from '@is488/shared';
import type { Project, SystemClockPort } from '@is488/shared';

class FakeSystemClock implements SystemClockPort {
  isoString(): string {
    return '2026-03-10T12:00:00.000Z';
  }
  now(): Date {
    return new Date('2026-03-10T12:00:00.000Z');
  }
}

describe('DeleteBoardColumnUseCase', () => {
  let storage: InMemoryKanbanProjectStorage;
  let boardRepository: InMemoryBoardRepository;
  let taskRepository: InMemoryTaskRepository;
  let taskActivityRepository: InMemoryTaskActivityRepository;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let deletionAdapter: InMemoryBoardColumnDeletionAdapter;
  let clock: FakeSystemClock;
  let useCase: DeleteBoardColumnUseCase;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const collaboratorId = '33333333-3333-4333-8333-333333333333';
  const unassignedTeacherId = '55555555-5555-4555-8555-555555555555';

  const sampleProject: Project = {
    id: projectId,
    title: 'Proyecto IS488',
    description: 'Delete Column Test',
    courseCode: 'IS488',
    status: 'active',
    startDate: '2026-03-01T00:00:00.000Z',
    targetDate: '2026-07-15T00:00:00.000Z',
    creatorId,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    boardRepository = new InMemoryBoardRepository(storage);
    taskRepository = new InMemoryTaskRepository(storage);
    taskActivityRepository = new InMemoryTaskActivityRepository(storage);
    projectRepository = new InMemoryProjectRepository();
    membershipRepository = new InMemoryMembershipRepository();
    clock = new FakeSystemClock();

    deletionAdapter = new InMemoryBoardColumnDeletionAdapter(storage);

    useCase = new DeleteBoardColumnUseCase(
      deletionAdapter,
      projectRepository,
      membershipRepository,
      clock,
    );

    await projectRepository.save(sampleProject);

    await membershipRepository.addMember({
      projectId,
      userId: collaboratorId,
      role: 'collaborator',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    // Inicializar tablero por defecto con 3 columnas ('Por hacer', 'En progreso', 'Completado')
    await boardRepository.findOrCreateDefaultBoard(projectId);
  });

  it('rejects deletion with 404 when requester is a teacher without real assignment evidence (default denial)', async () => {
    const board = await boardRepository.findByProjectId(projectId);
    const colId = board!.columns[0]!.id;

    await expect(
      useCase.execute({
        projectId,
        columnId: colId,
        requesterId: unassignedTeacherId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects deletion with 404 when column does not exist', async () => {
    await expect(
      useCase.execute({
        projectId,
        columnId: '00000000-0000-4000-8000-000000000000',
        requesterId: creatorId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects deletion of the last remaining column with 400 Bad Request (LastColumnDeletionError)', async () => {
    const board = await boardRepository.findByProjectId(projectId);
    await boardRepository.deleteColumn(board!.columns[0]!.id);
    await boardRepository.deleteColumn(board!.columns[1]!.id);

    const remaining = (await boardRepository.findByProjectId(projectId))!.columns[0]!;

    await expect(
      useCase.execute({
        projectId,
        columnId: remaining.id,
        requesterId: creatorId,
      }),
    ).rejects.toThrow(LastColumnDeletionError);

    await expect(
      useCase.execute({
        projectId,
        columnId: remaining.id,
        requesterId: creatorId,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects deletion with 409 Conflict (ColumnNotEmptyError) when column has tasks and no target is given', async () => {
    const board = await boardRepository.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;

    await taskRepository.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Tarea activa',
      priority: 'HIGH',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [collaboratorId],
    });

    await expect(
      useCase.execute({
        projectId,
        columnId: sourceCol.id,
        requesterId: collaboratorId,
      }),
    ).rejects.toThrow(ColumnNotEmptyError);

    await expect(
      useCase.execute({
        projectId,
        columnId: sourceCol.id,
        requesterId: collaboratorId,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects deletion with 400 (InvalidDestinationColumnError) when target column is invalid or same column', async () => {
    const board = await boardRepository.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!;

    await taskRepository.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Tarea activa',
      priority: 'MEDIUM',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [collaboratorId],
    });

    // Mismo id que la columna origen
    await expect(
      useCase.execute({
        projectId,
        columnId: sourceCol.id,
        targetColumnId: sourceCol.id,
        requesterId: creatorId,
      }),
    ).rejects.toThrow(InvalidDestinationColumnError);

    // Id inexistente en el tablero
    await expect(
      useCase.execute({
        projectId,
        columnId: sourceCol.id,
        targetColumnId: '00000000-0000-4000-8000-000000000000',
        requesterId: creatorId,
      }),
    ).rejects.toThrow(InvalidDestinationColumnError);
  });

  it('successfully deletes an empty column and recompacts orderIndex', async () => {
    const board = await boardRepository.findByProjectId(projectId);
    const colToDelete = board!.columns[1]!; // 'En progreso'

    const result = await useCase.execute({
      projectId,
      columnId: colToDelete.id,
      requesterId: creatorId,
    });

    expect(result.success).toBe(true);
    expect(result.migratedTasksCount).toBe(0);

    const updatedBoard = await boardRepository.findByProjectId(projectId);
    expect(updatedBoard!.columns).toHaveLength(2);
    expect(updatedBoard!.columns[0]?.orderIndex).toBe(0);
    expect(updatedBoard!.columns[1]?.orderIndex).toBe(1);
    expect(updatedBoard!.columns.find((c) => c.id === colToDelete.id)).toBeUndefined();
  });

  it('atomically migrates tasks, records activity events, deletes source column and guarantees contiguous indices', async () => {
    const board = await boardRepository.findByProjectId(projectId);
    const sourceCol = board!.columns[0]!; // 'Por hacer'
    const targetCol = board!.columns[1]!; // 'En progreso'

    // Preexistentes en destino para probar contigüidad
    const preExistingTargetTask = await taskRepository.create({
      projectId,
      columnId: targetCol.id,
      title: 'Tarea previa en destino',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [collaboratorId],
    });

    const task1 = await taskRepository.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Tarea 1',
      priority: 'MEDIUM',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [collaboratorId],
    });

    const task2 = await taskRepository.create({
      projectId,
      columnId: sourceCol.id,
      title: 'Tarea 2',
      priority: 'HIGH',
      orderIndex: 1,
      labels: [],
      creatorId,
      assigneeIds: [collaboratorId],
    });

    const result = await useCase.execute({
      projectId,
      columnId: sourceCol.id,
      targetColumnId: targetCol.id,
      requesterId: collaboratorId,
    });

    expect(result.success).toBe(true);
    expect(result.migratedTasksCount).toBe(2);

    // Verificar que todas las tareas en destino tienen índices estrictamente contiguos: 0, 1, 2
    const tasksInTarget = await taskRepository.findByColumnId(targetCol.id);
    expect(tasksInTarget).toHaveLength(3);
    tasksInTarget.sort((a, b) => a.orderIndex - b.orderIndex);
    expect(tasksInTarget[0]?.id).toBe(preExistingTargetTask.id);
    expect(tasksInTarget[0]?.orderIndex).toBe(0);
    expect(tasksInTarget[1]?.id).toBe(task1.id);
    expect(tasksInTarget[1]?.orderIndex).toBe(1);
    expect(tasksInTarget[2]?.id).toBe(task2.id);
    expect(tasksInTarget[2]?.orderIndex).toBe(2);

    // Verificar eventos de auditoría emitidos
    expect(taskActivityRepository.events).toHaveLength(2);
    expect(taskActivityRepository.events[0]).toMatchObject({
      taskId: task1.id,
      action: 'COLUMN_DELETED_REALLOCATION',
      fromColumnId: sourceCol.id,
      toColumnId: targetCol.id,
      actorId: collaboratorId,
    });

    // Verificar que la columna origen fue eliminada del tablero y las columnas restantes tienen índices contiguos: 0, 1
    const updatedBoard = await boardRepository.findByProjectId(projectId);
    expect(updatedBoard!.columns).toHaveLength(2);
    expect(updatedBoard!.columns[0]?.orderIndex).toBe(0);
    expect(updatedBoard!.columns[1]?.orderIndex).toBe(1);
    expect(updatedBoard!.columns.find((c) => c.id === sourceCol.id)).toBeUndefined();
  });

  describe('Adversarial Tests: Failure After Events, Full Rollback, Concurrency & Contiguity', () => {
    it('adversarial 1: leaves all state intact when failure occurs BEFORE publication', async () => {
      const board = await boardRepository.findByProjectId(projectId);
      const sourceCol = board!.columns[0]!;
      const targetCol = board!.columns[1]!;

      const task = await taskRepository.create({
        projectId,
        columnId: sourceCol.id,
        title: 'Tarea en prueba adversarial tras eventos',
        priority: 'HIGH',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [collaboratorId],
      });

      // Configurar punto de fallo adversarial inmediatamente después de persistir eventos
      deletionAdapter.setFaultInjectionPoint('before_publish');

      await expect(
        useCase.execute({
          projectId,
          columnId: sourceCol.id,
          targetColumnId: targetCol.id,
          requesterId: creatorId,
        }),
      ).rejects.toThrow('Simulated failure before publishing atomic state');

      // 1. Verificar que los eventos de auditoría fueron purgados / revertidos (cero eventos huérfanos)
      expect(taskActivityRepository.events).toHaveLength(0);

      // 2. Verificar que la tarea fue restaurada íntegramente a la columna origen con su orderIndex 0
      const restoredTask = await taskRepository.findById(task.id);
      expect(restoredTask!.columnId).toBe(sourceCol.id);
      expect(restoredTask!.orderIndex).toBe(0);

      // 3. Verificar que la columna origen NO fue eliminada y el tablero conserva sus 3 columnas contiguas
      const currentBoard = await boardRepository.findByProjectId(projectId);
      expect(currentBoard!.columns).toHaveLength(3);
      expect(currentBoard!.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
      expect(currentBoard!.columns.some((c) => c.id === sourceCol.id)).toBe(true);
    });

    it('adversarial 2: guarantees no partial modifications when destination column is invalid or preparation fails', async () => {
      const board = await boardRepository.findByProjectId(projectId);
      const sourceCol = board!.columns[0]!;

      const task = await taskRepository.create({
        projectId,
        columnId: sourceCol.id,
        title: 'Tarea protegida contra fallo inicial de validación',
        priority: 'HIGH',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [collaboratorId],
      });

      // Intentar eliminar con una columna destino inexistente
      await expect(
        useCase.execute({
          projectId,
          columnId: sourceCol.id,
          targetColumnId: '99999999-9999-4999-8999-999999999999',
          requesterId: creatorId,
        }),
      ).rejects.toThrow();

      // Tarea intacta en columna origen con orderIndex 0
      const restoredTask = await taskRepository.findById(task.id);
      expect(restoredTask!.columnId).toBe(sourceCol.id);
      expect(restoredTask!.orderIndex).toBe(0);

      // Tablero intacto con columnas contiguas
      const currentBoard = await boardRepository.findByProjectId(projectId);
      expect(currentBoard!.columns).toHaveLength(3);
      expect(currentBoard!.columns.map((c) => c.orderIndex)).toEqual([0, 1, 2]);
      expect(taskActivityRepository.events).toHaveLength(0);
    });

    it('adversarial 3: guarantees contiguous order indices in both source and target columns during rollback', async () => {
      const board = await boardRepository.findByProjectId(projectId);
      const sourceCol = board!.columns[0]!;
      const targetCol = board!.columns[1]!;

      // 2 tareas en origen
      const s1 = await taskRepository.create({
        projectId,
        columnId: sourceCol.id,
        title: 'S1',
        priority: 'LOW',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [],
      });
      const s2 = await taskRepository.create({
        projectId,
        columnId: sourceCol.id,
        title: 'S2',
        priority: 'LOW',
        orderIndex: 1,
        labels: [],
        creatorId,
        assigneeIds: [],
      });

      // 2 tareas en destino
      const d1 = await taskRepository.create({
        projectId,
        columnId: targetCol.id,
        title: 'D1',
        priority: 'LOW',
        orderIndex: 0,
        labels: [],
        creatorId,
        assigneeIds: [],
      });
      const d2 = await taskRepository.create({
        projectId,
        columnId: targetCol.id,
        title: 'D2',
        priority: 'LOW',
        orderIndex: 1,
        labels: [],
        creatorId,
        assigneeIds: [],
      });

      deletionAdapter.setFaultInjectionPoint('before_publish');

      await expect(
        useCase.execute({
          projectId,
          columnId: sourceCol.id,
          targetColumnId: targetCol.id,
          requesterId: creatorId,
        }),
      ).rejects.toThrow();

      // Verificar que los índices en origen siguen siendo contiguos [0, 1]
      const sourceTasks = await taskRepository.findByColumnId(sourceCol.id);
      sourceTasks.sort((a, b) => a.orderIndex - b.orderIndex);
      expect(sourceTasks.map((t) => t.id)).toEqual([s1.id, s2.id]);
      expect(sourceTasks.map((t) => t.orderIndex)).toEqual([0, 1]);

      // Verificar que los índices en destino siguen siendo contiguos [0, 1]
      const targetTasks = await taskRepository.findByColumnId(targetCol.id);
      targetTasks.sort((a, b) => a.orderIndex - b.orderIndex);
      expect(targetTasks.map((t) => t.id)).toEqual([d1.id, d2.id]);
      expect(targetTasks.map((t) => t.orderIndex)).toEqual([0, 1]);
    });

    it('adversarial 4: serializes concurrent deletions on the same board without race conditions', async () => {
      const board = await boardRepository.findByProjectId(projectId);
      const col0 = board!.columns[0]!; // 'Por hacer'
      const col1 = board!.columns[1]!; // 'En progreso'
      // 'Completado'

      // Agregar una 4ta columna para tener suficientes columnas
      await boardRepository.addColumn(board!.id, {
        boardId: board!.id,
        name: 'Columna 4',
        category: 'TODO',
        orderIndex: 3,
      });

      // Ejecutar dos eliminaciones en paralelo para columnas distintas
      const [res1, res2] = await Promise.all([
        useCase.execute({
          projectId,
          columnId: col0.id,
          requesterId: creatorId,
        }),
        useCase.execute({
          projectId,
          columnId: col1.id,
          requesterId: collaboratorId,
        }),
      ]);

      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);

      const finalBoard = await boardRepository.findByProjectId(projectId);
      expect(finalBoard!.columns).toHaveLength(2);
      // Las dos columnas restantes deben tener índices contiguos: [0, 1]
      expect(finalBoard!.columns.map((c) => c.orderIndex)).toEqual([0, 1]);
      expect(finalBoard!.columns.find((c) => c.id === col0.id)).toBeUndefined();
      expect(finalBoard!.columns.find((c) => c.id === col1.id)).toBeUndefined();
    });
  });
});
