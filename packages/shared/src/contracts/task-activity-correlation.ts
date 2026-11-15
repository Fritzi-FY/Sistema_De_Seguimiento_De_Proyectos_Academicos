import { z } from 'zod';

export const TaskActivityCorrelationIdSchema = z.string().length(36).uuid().toLowerCase();

export function normalizeTaskActivityCorrelation(value: unknown): { correlationId?: string } {
  const parsed = TaskActivityCorrelationIdSchema.safeParse(value);
  return parsed.success ? { correlationId: parsed.data } : {};
}
