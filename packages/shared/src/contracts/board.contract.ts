import { z } from 'zod';

/**
 * Esquema para la categoría semántica de columnas de tablero Kanban.
 */
export const ColumnCategorySchema = z.enum(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE'] as const, {
  message: 'La categoría debe ser TODO, IN_PROGRESS, IN_REVIEW o DONE',
});

export type ColumnCategoryDto = z.infer<typeof ColumnCategorySchema>;

/**
 * Esquema de validación para la creación de una nueva columna en el tablero.
 */
export const CreateBoardColumnSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'El nombre de la columna debe tener al menos 1 caracter' })
      .max(50, { message: 'El nombre de la columna no puede exceder 50 caracteres' }),
    color: z
      .string()
      .trim()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
        message: 'El color debe ser un valor hexadecimal válido (ej. #3b82f6)',
      })
      .optional(),
    category: ColumnCategorySchema.default('TODO'),
  })
  .strict();

export type CreateBoardColumnRequest = z.infer<typeof CreateBoardColumnSchema>;

/**
 * Esquema de validación para la actualización de una columna existente.
 */
export const UpdateBoardColumnSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'El nombre de la columna debe tener al menos 1 caracter' })
      .max(50, { message: 'El nombre de la columna no puede exceder 50 caracteres' })
      .optional(),
    color: z
      .string()
      .trim()
      .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
        message: 'El color debe ser un valor hexadecimal válido (ej. #3b82f6)',
      })
      .optional(),
    category: ColumnCategorySchema.optional(),
    orderIndex: z
      .number()
      .int({ message: 'El orden debe ser un número entero' })
      .min(0, { message: 'El orden no puede ser negativo' })
      .optional(),
  })
  .strict()
  .refine((data) => Object.values(data).some((val) => val !== undefined), {
    message: 'Debe especificar al menos un campo para actualizar',
  });

export type UpdateBoardColumnRequest = z.infer<typeof UpdateBoardColumnSchema>;

/**
 * Esquema de parámetros query para la eliminación de una columna de tablero.
 */
export const DeleteBoardColumnQuerySchema = z.object({
  targetColumnId: z
    .string()
    .uuid({ message: 'El identificador de columna destino debe ser un UUID válido' })
    .optional(),
});

export type DeleteBoardColumnQuery = z.infer<typeof DeleteBoardColumnQuerySchema>;

/**
 * Esquema de representación serializada de una columna devuelta por la API.
 */
export const BoardColumnResponseSchema = z.object({
  id: z.string().uuid({ message: 'El id de la columna debe ser un UUID válido' }),
  boardId: z.string().uuid({ message: 'El id del tablero debe ser un UUID válido' }),
  name: z.string().min(1, { message: 'El nombre no puede estar vacío' }).max(50),
  orderIndex: z.number().int().min(0),
  category: ColumnCategorySchema,
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .optional(),
  createdAt: z.string().datetime({ message: 'createdAt debe ser una cadena ISO-8601 válida' }),
  updatedAt: z.string().datetime({ message: 'updatedAt debe ser una cadena ISO-8601 válida' }),
});

export type BoardColumnResponse = z.infer<typeof BoardColumnResponseSchema>;

/**
 * Esquema de representación serializada del tablero completo con sus columnas.
 */
export const BoardResponseSchema = z.object({
  id: z.string().uuid({ message: 'El id del tablero debe ser un UUID válido' }),
  projectId: z.string().uuid({ message: 'El id del proyecto debe ser un UUID válido' }),
  columns: z.array(BoardColumnResponseSchema),
  createdAt: z.string().datetime({ message: 'createdAt debe ser una cadena ISO-8601 válida' }),
  updatedAt: z.string().datetime({ message: 'updatedAt debe ser una cadena ISO-8601 válida' }),
});

export type BoardResponse = z.infer<typeof BoardResponseSchema>;
