import { z } from 'zod';

/**
 * Esquema para la prioridad de una tarea.
 */
export const TaskPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const, {
  message: 'La prioridad debe ser LOW, MEDIUM, HIGH o URGENT',
});

export type TaskPriorityDto = z.infer<typeof TaskPrioritySchema>;

/**
 * Esquema de validación para la creación de una nueva tarea.
 */
export const CreateTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, { message: 'El título debe tener al menos 3 caracteres' })
    .max(140, { message: 'El título no puede exceder 140 caracteres' }),
  description: z
    .string()
    .trim()
    .max(2000, { message: 'La descripción no puede exceder 2000 caracteres' })
    .optional(),
  columnId: z.string().uuid({ message: 'El identificador de columna debe ser un UUID válido' }),
  priority: TaskPrioritySchema.default('MEDIUM'),
  dueDate: z
    .string()
    .datetime({ message: 'La fecha límite debe ser una cadena ISO-8601 válida' })
    .optional(),
  labels: z
    .array(
      z
        .string()
        .trim()
        .min(1, { message: 'Una etiqueta no puede estar vacía' })
        .max(30, { message: 'Una etiqueta no puede exceder 30 caracteres' }),
    )
    .max(5, { message: 'No se pueden asignar más de 5 etiquetas por tarea' })
    .default([]),
  assigneeIds: z
    .array(z.string().uuid({ message: 'Cada responsable debe ser un UUID válido' }))
    .default([]),
});

export type CreateTaskRequest = z.infer<typeof CreateTaskSchema>;

/**
 * Esquema de validación para la edición parcial de campos de una tarea existente.
 * NOTA: columnId y orderIndex están excluidos deliberadamente; el movimiento de tareas
 * entre columnas o posiciones es operación separada gestionada por MoveTaskUseCase.
 */
export const UpdateTaskSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, { message: 'El título debe tener al menos 3 caracteres' })
      .max(140, { message: 'El título no puede exceder 140 caracteres' })
      .optional(),
    description: z
      .string()
      .trim()
      .max(2000, { message: 'La descripción no puede exceder 2000 caracteres' })
      .optional(),
    priority: TaskPrioritySchema.optional(),
    dueDate: z
      .string()
      .datetime({ message: 'La fecha límite debe ser una cadena ISO-8601 válida' })
      .nullable()
      .optional(),
    labels: z
      .array(
        z
          .string()
          .trim()
          .min(1, { message: 'Una etiqueta no puede estar vacía' })
          .max(30, { message: 'Una etiqueta no puede exceder 30 caracteres' }),
      )
      .max(5, { message: 'No se pueden asignar más de 5 etiquetas por tarea' })
      .optional(),
    assigneeIds: z
      .array(z.string().uuid({ message: 'Cada responsable debe ser un UUID válido' }))
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Debe especificar al menos un campo para actualizar',
  });

export type UpdateTaskRequest = z.infer<typeof UpdateTaskSchema>;

/**
 * Esquema de validación para mover o reordenar una tarea entre columnas o posiciones.
 */
export const MoveTaskSchema = z.object({
  destinationColumnId: z
    .string()
    .uuid({ message: 'El identificador de columna destino debe ser un UUID válido' }),
  destinationIndex: z
    .number()
    .int({ message: 'El índice destino debe ser un número entero' })
    .min(0, { message: 'El índice destino no puede ser negativo' }),
});

export type MoveTaskRequest = z.infer<typeof MoveTaskSchema>;

/**
 * Esquema para parámetros query al listar tareas de un proyecto.
 */
export const ListTasksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  columnId: z.string().uuid().optional(),
  priority: TaskPrioritySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(30).optional(),
  search: z.string().trim().max(100).optional(),
});

export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;

/**
 * Esquema de representación serializada de una tarea devuelta por la API.
 */
export const TaskResponseSchema = z.object({
  id: z.string().uuid({ message: 'El id de la tarea debe ser un UUID válido' }),
  projectId: z.string().uuid({ message: 'El id del proyecto debe ser un UUID válido' }),
  columnId: z.string().uuid({ message: 'El id de la columna debe ser un UUID válido' }),
  title: z.string().min(1),
  description: z.string().optional(),
  priority: TaskPrioritySchema,
  orderIndex: z.number().int().min(0),
  dueDate: z.string().datetime().optional(),
  labels: z.array(z.string()),
  creatorId: z.string().min(1),
  assigneeIds: z.array(z.string().uuid()),
  createdAt: z.string().datetime({ message: 'createdAt debe ser una cadena ISO-8601 válida' }),
  updatedAt: z.string().datetime({ message: 'updatedAt debe ser una cadena ISO-8601 válida' }),
});

export type TaskResponse = z.infer<typeof TaskResponseSchema>;

/**
 * Esquema de respuesta para consultas paginadas de tareas.
 */
export const PaginatedTasksResponseSchema = z.object({
  items: z.array(TaskResponseSchema),
  totalItems: z.number().int().min(0),
  page: z.number().int().min(1),
  limit: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export type PaginatedTasksResponse = z.infer<typeof PaginatedTasksResponseSchema>;

/**
 * Esquema para evento de auditoría de actividad de una tarea.
 */
export const TaskActivityResponseSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  projectId: z.string().uuid(),
  actorId: z.string().min(1),
  action: z.enum([
    'CREATED',
    'UPDATED',
    'MOVED',
    'COLUMN_DELETED_REALLOCATION',
    'DELETED',
  ] as const),
  fromColumnId: z.string().uuid().optional(),
  toColumnId: z.string().uuid().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  createdAt: z.string().datetime(),
});

export type TaskActivityResponse = z.infer<typeof TaskActivityResponseSchema>;

export const TaskActivityListResponseSchema = z.array(TaskActivityResponseSchema);
export type TaskActivityListResponse = z.infer<typeof TaskActivityListResponseSchema>;
