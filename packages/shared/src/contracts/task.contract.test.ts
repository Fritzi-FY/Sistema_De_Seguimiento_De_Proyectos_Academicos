import { describe, it, expect } from 'vitest';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  MoveTaskSchema,
  ListTasksQuerySchema,
  TaskResponseSchema,
  PaginatedTasksResponseSchema,
} from './task.contract.js';

describe('CreateTaskSchema', () => {
  const validColumnId = '123e4567-e89b-12d3-a456-426614174000';
  const validAssigneeId = '223e4567-e89b-12d3-a456-426614174001';

  const validFullPayload = {
    title: 'Implementar modelo de datos Kanban',
    description: 'Definir tablas y esquemas para boards, columns y tasks',
    columnId: validColumnId,
    priority: 'HIGH' as const,
    dueDate: '2026-11-15T18:00:00.000Z',
    labels: ['backend', 'database'],
    assigneeIds: [validAssigneeId],
  };

  it('debe validar exitosamente un payload completo y válido', () => {
    const result = CreateTaskSchema.safeParse(validFullPayload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe(validFullPayload.title);
      expect(result.data.priority).toBe('HIGH');
      expect(result.data.labels).toEqual(['backend', 'database']);
      expect(result.data.assigneeIds).toEqual([validAssigneeId]);
    }
  });

  it('debe aplicar valores por defecto (priority MEDIUM, labels [], assigneeIds []) en payload mínimo', () => {
    const minimalPayload = {
      title: 'Crear componente Kanban',
      columnId: validColumnId,
    };

    const result = CreateTaskSchema.safeParse(minimalPayload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('MEDIUM');
      expect(result.data.labels).toEqual([]);
      expect(result.data.assigneeIds).toEqual([]);
      expect(result.data.description).toBeUndefined();
      expect(result.data.dueDate).toBeUndefined();
    }
  });

  it('debe rechazar títulos menores a 3 caracteres o vacíos', () => {
    const resultShort = CreateTaskSchema.safeParse({ title: 'AB', columnId: validColumnId });
    const resultEmpty = CreateTaskSchema.safeParse({ title: '   ', columnId: validColumnId });

    expect(resultShort.success).toBe(false);
    expect(resultEmpty.success).toBe(false);
  });

  it('debe rechazar títulos que superen los 140 caracteres', () => {
    const longTitle = 'T'.repeat(141);
    const result = CreateTaskSchema.safeParse({ title: longTitle, columnId: validColumnId });

    expect(result.success).toBe(false);
  });

  it('debe rechazar descripciones que superen los 2000 caracteres', () => {
    const longDesc = 'D'.repeat(2001);
    const result = CreateTaskSchema.safeParse({
      title: 'Tarea con descripción extensa',
      description: longDesc,
      columnId: validColumnId,
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar columnId que no sea un UUID válido', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Tarea sin columna válida',
      columnId: 'no-es-uuid',
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar prioridades desconocidas', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Tarea con prioridad inválida',
      columnId: validColumnId,
      priority: 'CRITICAL',
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar dueDate que no tenga formato ISO-8601 válido', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Tarea con fecha inválida',
      columnId: validColumnId,
      dueDate: '2026-11-15',
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar cuando se asignan más de 5 etiquetas', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Tarea con exceso de etiquetas',
      columnId: validColumnId,
      labels: ['uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis'],
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar etiquetas vacías o mayores a 30 caracteres', () => {
    const resultEmptyTag = CreateTaskSchema.safeParse({
      title: 'Tarea etiqueta vacía',
      columnId: validColumnId,
      labels: [''],
    });
    const resultLongTag = CreateTaskSchema.safeParse({
      title: 'Tarea etiqueta larga',
      columnId: validColumnId,
      labels: ['E'.repeat(31)],
    });

    expect(resultEmptyTag.success).toBe(false);
    expect(resultLongTag.success).toBe(false);
  });

  it('debe rechazar assigneeIds con formato no UUID', () => {
    const result = CreateTaskSchema.safeParse({
      title: 'Tarea asignado inválido',
      columnId: validColumnId,
      assigneeIds: ['not-a-uuid'],
    });

    expect(result.success).toBe(false);
  });
});

describe('UpdateTaskSchema', () => {
  it('debe validar actualizaciones parciales de campos individuales', () => {
    const resultTitle = UpdateTaskSchema.safeParse({ title: 'Nuevo título válido' });
    const resultPriority = UpdateTaskSchema.safeParse({ priority: 'URGENT' });
    const resultNullDueDate = UpdateTaskSchema.safeParse({ dueDate: null });

    expect(resultTitle.success).toBe(true);
    expect(resultPriority.success).toBe(true);
    expect(resultNullDueDate.success).toBe(true);
  });

  it('debe rechazar un payload vacío sin ningún campo', () => {
    const result = UpdateTaskSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('debe rechazar títulos menores a 3 caracteres en actualizaciones', () => {
    const result = UpdateTaskSchema.safeParse({ title: 'No' });

    expect(result.success).toBe(false);
  });
});

describe('MoveTaskSchema', () => {
  const validDestinationColumnId = '323e4567-e89b-12d3-a456-426614174003';

  it('debe validar un payload de movimiento conforme', () => {
    const result = MoveTaskSchema.safeParse({
      destinationColumnId: validDestinationColumnId,
      destinationIndex: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.destinationColumnId).toBe(validDestinationColumnId);
      expect(result.data.destinationIndex).toBe(2);
    }
  });

  it('debe rechazar índice de destino negativo o decimal', () => {
    const resultNegative = MoveTaskSchema.safeParse({
      destinationColumnId: validDestinationColumnId,
      destinationIndex: -1,
    });
    const resultDecimal = MoveTaskSchema.safeParse({
      destinationColumnId: validDestinationColumnId,
      destinationIndex: 1.5,
    });

    expect(resultNegative.success).toBe(false);
    expect(resultDecimal.success).toBe(false);
  });

  it('debe rechazar destinationColumnId no UUID', () => {
    const result = MoveTaskSchema.safeParse({
      destinationColumnId: 'invalid-uuid',
      destinationIndex: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe('ListTasksQuerySchema', () => {
  it('debe aplicar page=1 y limit=20 por defecto', () => {
    const result = ListTasksQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.limit).toBe(20);
    }
  });

  it('debe coercionar parámetros numéricos en string (query params de URL)', () => {
    const result = ListTasksQuerySchema.safeParse({
      page: '3',
      limit: '50',
      priority: 'HIGH',
      search: 'Kanban',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.limit).toBe(50);
      expect(result.data.priority).toBe('HIGH');
      expect(result.data.search).toBe('Kanban');
    }
  });

  it('debe rechazar limit superior a 100 o page inferior a 1', () => {
    const resultOverLimit = ListTasksQuerySchema.safeParse({ limit: 101 });
    const resultUnderPage = ListTasksQuerySchema.safeParse({ page: 0 });

    expect(resultOverLimit.success).toBe(false);
    expect(resultUnderPage.success).toBe(false);
  });
});

describe('TaskResponseSchema & PaginatedTasksResponseSchema', () => {
  const validTask = {
    id: '423e4567-e89b-12d3-a456-426614174004',
    projectId: '523e4567-e89b-12d3-a456-426614174005',
    columnId: '623e4567-e89b-12d3-a456-426614174006',
    title: 'Diseñar arquitectura hexagonal',
    description: 'Separación estricta de dominio, aplicación e infraestructura',
    priority: 'HIGH' as const,
    orderIndex: 0,
    dueDate: '2026-11-20T00:00:00.000Z',
    labels: ['architecture', 'is488'],
    creatorId: 'user-001',
    assigneeIds: ['723e4567-e89b-12d3-a456-426614174007'],
    createdAt: '2026-10-21T10:00:00.000Z',
    updatedAt: '2026-10-21T10:00:00.000Z',
  };

  it('debe validar una representación de tarea conforme', () => {
    const result = TaskResponseSchema.safeParse(validTask);

    expect(result.success).toBe(true);
  });

  it('debe validar la respuesta paginada con metadatos', () => {
    const paginatedResponse = {
      items: [validTask],
      totalItems: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    };

    const result = PaginatedTasksResponseSchema.safeParse(paginatedResponse);

    expect(result.success).toBe(true);
  });

  it('debe rechazar cuando falta un campo obligatorio en la tarea', () => {
    const { title: _, ...missingTitle } = validTask;
    const result = TaskResponseSchema.safeParse(missingTitle);

    expect(result.success).toBe(false);
  });
});
