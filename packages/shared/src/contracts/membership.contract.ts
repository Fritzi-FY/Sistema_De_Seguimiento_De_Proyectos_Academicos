import { z } from 'zod';

/**
 * Esquema de validación para la solicitud de agregar un nuevo miembro a un proyecto.
 *
 * Restricción de negocio: el campo `role` acepta únicamente el valor `'collaborator'`.
 * El rol `'owner'` se asigna exclusivamente de forma interna por `CreateProjectUseCase`
 * y nunca debe poder enviarse desde el cliente.
 */
export const AddMemberRequestSchema = z.object({
  userId: z.string().uuid({ message: 'El identificador de usuario debe ser un UUID válido' }),
  role: z.literal('collaborator').refine((v) => v === 'collaborator', {
    message: "El rol solo puede ser 'collaborator'. El rol 'owner' es asignado internamente.",
  }),
});

export type AddMemberRequest = z.infer<typeof AddMemberRequestSchema>;

/**
 * Esquema de validación para la representación serializada de una membresía devuelta por la API.
 * Incluye todos los campos de la entidad ProjectMembership.
 */
export const MembershipResponseSchema = z
  .object({
    id: z.string().uuid({ message: 'El identificador de membresía debe ser un UUID válido' }),
    projectId: z.string().uuid({ message: 'El identificador de proyecto debe ser un UUID válido' }),
    userId: z.string().min(1, { message: 'El identificador de usuario no puede estar vacío' }),
    role: z.enum(['owner', 'collaborator'] as const, {
      message: 'El rol debe ser "owner" o "collaborator"',
    }),
    status: z.enum(['active', 'removed'] as const, {
      message: 'El estado debe ser "active" o "removed"',
    }),
    removedAt: z.string().datetime().nullable(),
    joinedAt: z
      .string()
      .datetime({ message: 'La fecha de incorporación debe ser una cadena ISO-8601 válida' }),
    updatedAt: z
      .string()
      .datetime({ message: 'La fecha de actualización debe ser una cadena ISO-8601 válida' }),
  })
  .superRefine((m, ctx) => {
    if (
      (m.status === 'active' && m.removedAt !== null) ||
      (m.status === 'removed' && (m.removedAt === null || m.removedAt !== m.updatedAt))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['removedAt'],
        message: 'removedAt must match membership status and updatedAt',
      });
    }
  });

export type MembershipResponse = z.infer<typeof MembershipResponseSchema>;

/**
 * Esquema de validación para el listado de membresías activas de un proyecto.
 */
export const MemberListResponseSchema = z.array(MembershipResponseSchema);

export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

export const RemoveMemberQuerySchema = z.object({ membershipId: z.string().uuid() });
