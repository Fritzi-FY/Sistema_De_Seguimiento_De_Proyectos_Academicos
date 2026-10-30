import { describe, it, expect, beforeEach } from 'vitest';
import {
  BoardColumnNotFoundError,
  type SystemClockPort,
  type Task,
  type TaskActivityEvent,
} from '@is488/shared';
import { CreateTaskUseCase } from './create-task.use-case.js';
import { InMemoryKanbanProjectStorage } from '../../infrastructure/adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryTaskCreationAdapter } from '../../infrastructure/adapters/repositories/in-memory-task-creation.adapter.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';

describe('CreateTaskUseCase', () => {
  let storage: InMemoryKanbanProjectStorage;
  let taskCreationAdapter: InMemoryTaskCreationAdapter;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let boardRepository: InMemoryBoardRepository;
  let mockClock: SystemClockPort;
  let useCase: CreateTaskUseCase;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const memberId = '33333333-3333-4333-8333-333333333333';
  const inactiveMemberId = '44444444-4444-4444-8444-444444444444';
  const foreignUserId = '55555555-5555-4555-8555-555555555555';
  let defaultColumnId: string;

  beforeEach(async () => {
    storage = new InMemoryKanbanProjectStorage();
    taskCreationAdapter = new InMemoryTaskCreationAdapter(storage);
    projectRepository = new InMemoryProjectRepository();
    membershipRepository = new InMemoryMembershipRepository();
    boardRepository = new InMemoryBoardRepository(storage);

    mockClock = {
      now: () => new Date('2026-10-22T21:00:00.000Z'),
      isoString: () => '2026-10-22T21:00:00.000Z',
    };

    useCase = new CreateTaskUseCase(
      taskCreationAdapter,
      projectRepository,
      membershipRepository,
      mockClock,
    );

    // Configurar proyecto inicial
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

    // Configurar membresías
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

    await membershipRepository.addMember({
      projectId,
      userId: inactiveMemberId,
      role: 'collaborator',
      status: 'removed',
      removedAt: '2026-10-01T00:00:00.000Z',
      joinedAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    });

    // Crear tablero por defecto
    const board = await boardRepository.findOrCreateDefaultBoard(projectId);
    defaultColumnId = board.columns[0]!.id;
  });

  it('creates task and records CREATED activity event atomically for project creator', async () => {
    const response = await useCase.execute({
      projectId,
      requesterId: creatorId,
      columnId: defaultColumnId,
      title: 'Implementar modelo de dominio',
      description: 'Definir entidades Task y Value Objects',
      priority: 'HIGH',
      dueDate: '2026-11-01T12:00:00.000Z',
      labels: ['backend', 'core'],
      assigneeIds: [memberId],
    });

    expect(response.id).toBeDefined();
    expect(response.projectId).toBe(projectId);
    expect(response.columnId).toBe(defaultColumnId);
    expect(response.title).toBe('Implementar modelo de dominio');
    expect(response.description).toBe('Definir entidades Task y Value Objects');
    expect(response.priority).toBe('HIGH');
    expect(response.orderIndex).toBe(0);
    expect(response.dueDate).toBe('2026-11-01T12:00:00.000Z');
    expect(response.labels).toEqual(['backend', 'core']);
    expect(response.assigneeIds).toEqual([memberId]);
    expect(response.createdAt).toBe('2026-10-22T21:00:00.000Z');
    expect(response.updatedAt).toBe('2026-10-22T21:00:00.000Z');

    // Verificar almacenamiento persistido
    const snapshot = storage.getSnapshot(projectId);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.tasks[0]?.id).toBe(response.id);
    expect(snapshot.tasks[0]?.orderIndex).toBe(0);

    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.action).toBe('CREATED');
    expect(snapshot.events[0]?.taskId).toBe(response.id);
    expect(snapshot.events[0]?.actorId).toBe(creatorId);
    expect(snapshot.events[0]?.toColumnId).toBe(defaultColumnId);
    expect(snapshot.events[0]?.createdAt).toBe('2026-10-22T21:00:00.000Z');
  });

  it('creates task when requester is an active collaborator member', async () => {
    const response = await useCase.execute({
      projectId,
      requesterId: memberId,
      columnId: defaultColumnId,
      title: 'Tarea creada por colaborador',
      priority: 'LOW',
    });

    expect(response.creatorId).toBe(memberId);
    expect(response.orderIndex).toBe(0);

    const snapshot = storage.getSnapshot(projectId);
    expect(snapshot.tasks).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.actorId).toBe(memberId);
  });

  it('rejects with 404 when requester is not a member nor creator (strict horizontal isolation / unassigned teacher)', async () => {
    await expect(
      useCase.execute({
        projectId,
        requesterId: foreignUserId,
        columnId: defaultColumnId,
        title: 'Intento no autorizado',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: `Proyecto '${projectId}' no encontrado`,
    });

    // Ni tarea ni evento persisten
    const snapshot = storage.getSnapshot(projectId);
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.events).toHaveLength(0);
  });

  it('rejects with 404 when project does not exist', async () => {
    const unknownProjectId = '00000000-0000-4000-8000-000000000000';
    await expect(
      useCase.execute({
        projectId: unknownProjectId,
        requesterId: creatorId,
        columnId: defaultColumnId,
        title: 'Proyecto inexistente',
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: `Proyecto '${unknownProjectId}' no encontrado`,
    });
  });

  it('rejects with 400 (IneligibleAssigneeError) when an assignee does not belong to the project', async () => {
    await expect(
      useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: defaultColumnId,
        title: 'Asignacion foranea',
        assigneeIds: [foreignUserId],
      }),
    ).rejects.toMatchObject({
      name: 'IneligibleAssigneeError',
      statusCode: 400,
    });

    // Sin efectos secundarios en almacenamiento
    const snapshot = storage.getSnapshot(projectId);
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.events).toHaveLength(0);
  });

  it('rejects with 400 (IneligibleAssigneeError) when an assignee has removed/inactive membership', async () => {
    await expect(
      useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: defaultColumnId,
        title: 'Asignacion inactiva',
        assigneeIds: [inactiveMemberId],
      }),
    ).rejects.toMatchObject({
      name: 'IneligibleAssigneeError',
      statusCode: 400,
    });

    // Sin efectos secundarios en almacenamiento
    const snapshot = storage.getSnapshot(projectId);
    expect(snapshot.tasks).toHaveLength(0);
    expect(snapshot.events).toHaveLength(0);
  });

  it('rejects with 404 (BoardColumnNotFoundError) when column is a valid non-existent UUID', async () => {
    // Probar con un UUID v4 sintácticamente válido pero ausente en el tablero
    const absentColumnId = crypto.randomUUID();

    // Estado inicial antes del intento
    const snapshotBefore = storage.getSnapshot(projectId);

    await expect(
      useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: absentColumnId,
        title: 'Columna ausente con UUID válido',
      }),
    ).rejects.toThrow(BoardColumnNotFoundError);

    // Estado 100% inalterado
    const snapshotAfter = storage.getSnapshot(projectId);
    expect(snapshotAfter).toEqual(snapshotBefore);
  });

  it('completes failure test: valid inputs, real adapter execution and fault induced after preparing task/event before publishing, preserving entire state including prior audit', async () => {
    // 1. Configurar estado preexistente: 1 tarea previa y 1 evento de auditoría previo
    const preExistingTaskId = crypto.randomUUID();
    const preExistingTask: Task = {
      id: preExistingTaskId,
      projectId,
      columnId: defaultColumnId,
      title: 'Tarea Previa Existente',
      priority: 'MEDIUM',
      orderIndex: 0,
      labels: ['previa'],
      creatorId,
      assigneeIds: [memberId],
      createdAt: '2026-10-22T20:00:00.000Z',
      updatedAt: '2026-10-22T20:00:00.000Z',
    };

    const preExistingEvent: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId: preExistingTaskId,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: defaultColumnId,
      details: { initial: true },
      createdAt: '2026-10-22T20:00:00.000Z',
    };

    const currentState = storage.getSnapshot(projectId);
    currentState.tasks.push(preExistingTask);
    currentState.events.push(preExistingEvent);
    storage.commitSnapshot(projectId, currentState);

    // Capturar copia íntegra del estado inicial (incluida auditoría previa y boardRevision)
    const snapshotBefore = storage.getSnapshot(projectId);
    expect(snapshotBefore.tasks).toHaveLength(1);
    expect(snapshotBefore.events).toHaveLength(1);

    // 2. Inducir fallo adversarial en el adaptador tras preparar tarea y evento, antes de publicar
    taskCreationAdapter.setFaultInjectionPoint('before_publish');

    // 3. Ejecución real con entradas plenamente válidas
    await expect(
      useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: defaultColumnId,
        title: 'Nueva Tarea que Fallará Antes de Publicar',
        description: 'Descripción válida',
        priority: 'HIGH',
        labels: ['backend'],
        assigneeIds: [memberId],
      }),
    ).rejects.toThrow(
      'Simulated failure after preparing task and event before publishing atomic state',
    );

    // 4. Comparar TODO el estado, verificando que ni tarea ni auditoría sufrieron mutaciones
    const snapshotAfter = storage.getSnapshot(projectId);
    expect(snapshotAfter).toEqual(snapshotBefore);
    expect(snapshotAfter.board).toEqual(snapshotBefore.board);
    expect(snapshotAfter.boardRevision).toBe(snapshotBefore.boardRevision);
    expect(snapshotAfter.tasks).toHaveLength(1);
    expect(snapshotAfter.tasks[0]).toEqual(preExistingTask);
    expect(snapshotAfter.events).toHaveLength(1);
    expect(snapshotAfter.events[0]).toEqual(preExistingEvent);

    // Limpiar punto de inyección
    taskCreationAdapter.setFaultInjectionPoint(null);
  });

  it('handles two concurrent creations within a column with previous tasks: contiguous indices, exactly one CREATED per task and clock timestamps', async () => {
    // 1. Configurar columna con dos tareas previas existentes (índices 0 y 1) y su auditoría
    const preTaskId0 = crypto.randomUUID();
    const preTaskId1 = crypto.randomUUID();

    const preTask0: Task = {
      id: preTaskId0,
      projectId,
      columnId: defaultColumnId,
      title: 'Tarea Preexistente 0',
      priority: 'LOW',
      orderIndex: 0,
      labels: [],
      creatorId,
      assigneeIds: [],
      createdAt: '2026-10-22T19:00:00.000Z',
      updatedAt: '2026-10-22T19:00:00.000Z',
    };

    const preTask1: Task = {
      id: preTaskId1,
      projectId,
      columnId: defaultColumnId,
      title: 'Tarea Preexistente 1',
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
      taskId: preTaskId0,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: defaultColumnId,
      createdAt: '2026-10-22T19:00:00.000Z',
    };

    const preEvent1: TaskActivityEvent = {
      id: crypto.randomUUID(),
      taskId: preTaskId1,
      projectId,
      actorId: creatorId,
      action: 'CREATED',
      toColumnId: defaultColumnId,
      createdAt: '2026-10-22T19:30:00.000Z',
    };

    const initState = storage.getSnapshot(projectId);
    initState.tasks.push(preTask0, preTask1);
    initState.events.push(preEvent0, preEvent1);
    storage.commitSnapshot(projectId, initState);

    const cmd1 = {
      projectId,
      requesterId: creatorId,
      columnId: defaultColumnId,
      title: 'Tarea Concurrente 1',
      priority: 'HIGH' as const,
      assigneeIds: [memberId],
    };

    const cmd2 = {
      projectId,
      requesterId: creatorId,
      columnId: defaultColumnId,
      title: 'Tarea Concurrente 2',
      priority: 'URGENT' as const,
    };

    // 2. Ejecutar ambas creaciones en paralelo
    const [t1, t2] = await Promise.all([useCase.execute(cmd1), useCase.execute(cmd2)]);

    // Validar identificadores únicos
    expect(t1.id).not.toBe(t2.id);

    // Validar índices contiguos subsiguientes a las tareas previas: [2, 3]
    const newIndices = [t1.orderIndex, t2.orderIndex].sort((a, b) => a - b);
    expect(newIndices).toEqual([2, 3]);

    // Validar timestamps provistos por el reloj inyectado
    const expectedClockIso = mockClock.isoString();
    expect(t1.createdAt).toBe(expectedClockIso);
    expect(t1.updatedAt).toBe(expectedClockIso);
    expect(t2.createdAt).toBe(expectedClockIso);
    expect(t2.updatedAt).toBe(expectedClockIso);

    // 3. Inspeccionar almacenamiento persistido
    const snapshot = storage.getSnapshot(projectId);
    const tasksInColumn = snapshot.tasks
      .filter((t) => t.columnId === defaultColumnId)
      .sort((a, b) => a.orderIndex - b.orderIndex);

    // Secuencia contigua completa: 0, 1, 2, 3
    expect(tasksInColumn.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
    expect(snapshot.tasks).toHaveLength(4);

    // 4. Validar exactamente un evento CREATED por cada nueva tarea
    const t1Events = snapshot.events.filter((e) => e.taskId === t1.id);
    expect(t1Events).toHaveLength(1);
    expect(t1Events[0]?.action).toBe('CREATED');
    expect(t1Events[0]?.actorId).toBe(creatorId);
    expect(t1Events[0]?.toColumnId).toBe(defaultColumnId);
    expect(t1Events[0]?.createdAt).toBe(expectedClockIso);

    const t2Events = snapshot.events.filter((e) => e.taskId === t2.id);
    expect(t2Events).toHaveLength(1);
    expect(t2Events[0]?.action).toBe('CREATED');
    expect(t2Events[0]?.actorId).toBe(creatorId);
    expect(t2Events[0]?.toColumnId).toBe(defaultColumnId);
    expect(t2Events[0]?.createdAt).toBe(expectedClockIso);

    // En total 4 eventos en el proyecto (2 previos + 2 creados)
    expect(snapshot.events).toHaveLength(4);
    expect(snapshot.events.every((e) => e.action === 'CREATED')).toBe(true);
  });

  it('validates input schema with Zod rejecting invalid payload', async () => {
    await expect(
      useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: defaultColumnId,
        title: 'AB', // muy corto (min 3)
      }),
    ).rejects.toThrow();

    await expect(
      useCase.execute({
        projectId,
        requesterId: creatorId,
        columnId: 'not-a-uuid',
        title: 'Titulo valido',
      }),
    ).rejects.toThrow();
  });
});
