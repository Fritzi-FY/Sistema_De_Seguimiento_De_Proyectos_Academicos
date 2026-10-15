import { z } from 'zod';

/**
 * Esquema de validación para la respuesta del endpoint técnico de diagnóstico (/api/health).
 */
export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.string().datetime({ message: 'El timestamp debe ser una cadena ISO-8601 válida' }),
  version: z.string().min(1, { message: 'La versión del sistema no puede estar vacía' }),
});

/**
 * Tipo inferido de la respuesta de salud a partir del esquema Zod.
 */
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
