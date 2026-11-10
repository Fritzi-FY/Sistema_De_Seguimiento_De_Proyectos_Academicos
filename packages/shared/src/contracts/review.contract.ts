import { z } from 'zod';

/**
 * Esquema de validación para los estados del ciclo de revisión docente.
 */
export const ReviewStatusSchema = z.enum(['PENDING', 'CHANGES_REQUESTED', 'APPROVED'], {
  message: 'El estado de revisión debe ser PENDING, CHANGES_REQUESTED o APPROVED',
});

export type ReviewStatusContract = z.infer<typeof ReviewStatusSchema>;

/**
 * Esquema de validación para los tipos de acciones registrables en una revisión.
 */
export const ReviewActionTypeSchema = z.enum(['TEACHER_RESPONSE', 'STUDENT_RESUBMISSION'], {
  message: 'El tipo de acción debe ser TEACHER_RESPONSE o STUDENT_RESUBMISSION',
});

export type ReviewActionTypeContract = z.infer<typeof ReviewActionTypeSchema>;

/**
 * Esquema de validación para la creación de una solicitud de revisión docente a nivel de proyecto.
 * Utiliza modo estricto (.strict()) para rechazar tajantemente cualquier intento del cliente de
 * inyectar o sobreescribir campos controlados por el servidor (id, requesterId, status, fechas, secuencia).
 */
export const CreateReviewRequestSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, { message: 'El título debe tener al menos 3 caracteres' })
      .max(120, { message: 'El título no puede exceder 120 caracteres' }),
    description: z
      .string()
      .trim()
      .min(10, { message: 'La descripción del avance debe tener al menos 10 caracteres' })
      .max(2000, { message: 'La descripción no puede exceder 2000 caracteres' }),
    evidenceUrl: z
      .string()
      .trim()
      .url({ message: 'El enlace de evidencia debe ser una URL válida' })
      .max(500, { message: 'El enlace no puede exceder 500 caracteres' })
      .optional(),
  })
  .strict();

export type CreateReviewRequest = z.infer<typeof CreateReviewRequestSchema>;

/**
 * Esquema de validación para la respuesta u observación docente.
 * Modo estricto (.strict()) para impedir inyección de id, reviewerId, fechas o secuencia.
 */
export const RespondReviewRequestSchema = z
  .object({
    status: z.enum(['APPROVED', 'CHANGES_REQUESTED'], {
      message: 'El dictamen docente debe ser APPROVED o CHANGES_REQUESTED',
    }),
    observation: z
      .string()
      .trim()
      .min(5, { message: 'La observación docente debe tener al menos 5 caracteres' })
      .max(2000, { message: 'La observación no puede exceder 2000 caracteres' }),
  })
  .strict();

export type RespondReviewRequest = z.infer<typeof RespondReviewRequestSchema>;

/**
 * Esquema de validación para la re-solicitud estudiantil tras CHANGES_REQUESTED.
 * Modo estricto (.strict()) para impedir inyección de campos no permitidos.
 */
export const ResubmitReviewRequestSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(10, { message: 'La descripción de ajustes debe tener al menos 10 caracteres' })
      .max(2000, { message: 'La descripción no puede exceder 2000 caracteres' }),
    evidenceUrl: z
      .string()
      .trim()
      .url({ message: 'El enlace de evidencia debe ser una URL válida' })
      .max(500, { message: 'El enlace no puede exceder 500 caracteres' })
      .optional(),
  })
  .strict();

export type ResubmitReviewRequest = z.infer<typeof ResubmitReviewRequestSchema>;

/**
 * Esquema de serialización de una acción de revisión devuelta por la API.
 */
export const ReviewActionResponseSchema = z.object({
  id: z.string().uuid({ message: 'El identificador de acción debe ser un UUID válido' }),
  reviewRequestId: z
    .string()
    .uuid({ message: 'El identificador de revisión debe ser un UUID válido' }),
  sequenceNumber: z.number().int().min(1, { message: 'El número de secuencia debe ser >= 1' }),
  actorId: z.string().min(1, { message: 'El identificador del actor no puede estar vacío' }),
  actorRole: z.enum(['student', 'teacher'], { message: 'El rol debe ser student o teacher' }),
  actionType: ReviewActionTypeSchema,
  status: ReviewStatusSchema,
  comment: z.string().min(1, { message: 'El comentario no puede estar vacío' }),
  evidenceUrl: z.string().url().optional(),
  createdAt: z.string().datetime({ message: 'La fecha de creación debe ser ISO-8601 UTC' }),
});

export type ReviewActionResponse = z.infer<typeof ReviewActionResponseSchema>;

/**
 * Esquema de serialización de una entrada del historial cronológico (timeline).
 */
export const ReviewTimelineEntryResponseSchema = z.object({
  sequenceNumber: z.number().int().min(0, { message: 'El número de secuencia debe ser >= 0' }),
  actionType: z.enum(['INITIAL_REQUEST', 'TEACHER_RESPONSE', 'STUDENT_RESUBMISSION']),
  actorId: z.string().min(1, { message: 'El identificador del actor no puede estar vacío' }),
  actorRole: z.enum(['student', 'teacher']),
  status: ReviewStatusSchema,
  comment: z.string().min(1, { message: 'El comentario no puede estar vacío' }),
  evidenceUrl: z.string().url().optional(),
  createdAt: z.string().datetime({ message: 'La fecha de creación debe ser ISO-8601 UTC' }),
});

export type ReviewTimelineEntryResponse = z.infer<typeof ReviewTimelineEntryResponseSchema>;

/**
 * Esquema de serialización para el resumen de una solicitud de revisión.
 */
export const ReviewRequestSummaryResponseSchema = z.object({
  id: z.string().uuid({ message: 'El identificador de revisión debe ser un UUID válido' }),
  projectId: z.string().uuid({ message: 'El identificador de proyecto debe ser un UUID válido' }),
  requesterId: z
    .string()
    .min(1, { message: 'El identificador del solicitante no puede estar vacío' }),
  title: z.string().min(1, { message: 'El título no puede estar vacío' }),
  description: z.string().min(1, { message: 'La descripción no puede estar vacía' }),
  evidenceUrl: z.string().url().optional(),
  status: ReviewStatusSchema,
  createdAt: z.string().datetime({ message: 'La fecha de creación debe ser ISO-8601 UTC' }),
  updatedAt: z.string().datetime({ message: 'La fecha de actualización debe ser ISO-8601 UTC' }),
});

export type ReviewRequestSummaryResponse = z.infer<typeof ReviewRequestSummaryResponseSchema>;

/**
 * Esquema de serialización para el detalle completo de una revisión, incluyendo acciones e historial cronológico derivado.
 */
export const ReviewDetailResponseSchema = ReviewRequestSummaryResponseSchema.extend({
  actions: z.array(ReviewActionResponseSchema),
  timeline: z.array(ReviewTimelineEntryResponseSchema),
});

export type ReviewDetailResponse = z.infer<typeof ReviewDetailResponseSchema>;

/**
 * Esquema de serialización para la lista de revisiones de un proyecto.
 */
export const ReviewListResponseSchema = z.array(ReviewRequestSummaryResponseSchema);

export type ReviewListResponse = z.infer<typeof ReviewListResponseSchema>;
