import { z } from 'zod';

/**
 * Esquema de validación para la creación de un nuevo proyecto académico.
 * Asegura límites de tamaño de texto, coherencia de formato de fechas ISO-8601 UTC
 * y que la fecha objetivo de finalización no sea anterior a la fecha de inicio.
 */
export const CreateProjectRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, { message: 'El título debe tener al menos 3 caracteres' })
      .max(120, { message: 'El título no puede exceder 120 caracteres' }),
    description: z
      .string()
      .trim()
      .max(500, { message: 'La descripción no puede exceder 500 caracteres' })
      .optional(),
    courseCode: z
      .string()
      .trim()
      .min(2, { message: 'El código de curso debe tener al menos 2 caracteres' })
      .max(20, { message: 'El código de curso no puede exceder 20 caracteres' }),
    startDate: z
      .string()
      .datetime({ message: 'La fecha de inicio debe ser una cadena ISO-8601 válida' }),
    targetDate: z
      .string()
      .datetime({ message: 'La fecha objetivo debe ser una cadena ISO-8601 válida' }),
  })
  .refine((data) => new Date(data.targetDate).getTime() >= new Date(data.startDate).getTime(), {
    message:
      'La fecha objetivo (targetDate) no puede ser anterior a la fecha de inicio (startDate)',
    path: ['targetDate'],
  });

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

/**
 * Esquema de validación para la representación serializada de un proyecto devuelto por la API.
 */
export const ProjectResponseSchema = z.object({
  id: z.string().uuid({ message: 'El identificador del proyecto debe ser un UUID válido' }),
  title: z.string().min(1, { message: 'El título no puede estar vacío' }),
  description: z.string().optional(),
  courseCode: z.string().min(1, { message: 'El código de curso no puede estar vacío' }),
  status: z.enum(['active', 'archived'] as const, {
    message: 'El estado debe ser "active" o "archived"',
  }),
  startDate: z
    .string()
    .datetime({ message: 'La fecha de inicio debe ser una cadena ISO-8601 válida' }),
  targetDate: z
    .string()
    .datetime({ message: 'La fecha objetivo debe ser una cadena ISO-8601 válida' }),
  creatorId: z.string().min(1, { message: 'El identificador del creador no puede estar vacío' }),
  createdAt: z
    .string()
    .datetime({ message: 'La fecha de creación debe ser una cadena ISO-8601 válida' }),
  updatedAt: z
    .string()
    .datetime({ message: 'La fecha de actualización debe ser una cadena ISO-8601 válida' }),
});

export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

/**
 * Esquema de validación para el listado de proyectos.
 */
export const ProjectListResponseSchema = z.array(ProjectResponseSchema);

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
