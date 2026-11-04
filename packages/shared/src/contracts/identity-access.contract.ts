import { z } from 'zod';

export const LoginRequestSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(256),
  })
  .strict();
export const VerificationRequestSchema = z
  .object({ email: z.string().trim().toLowerCase().email().max(254) })
  .strict();
export const VerificationConfirmSchema = z.object({ token: z.string().min(1).max(4096) }).strict();
export const CurrentUserSchema = z
  .object({
    userId: z.string().uuid(),
    role: z.enum(['student', 'teacher', 'admin']),
    email: z.string().email(),
    name: z.string(),
    expiresAt: z.string().datetime(),
  })
  .strict();
export type CurrentUser = z.infer<typeof CurrentUserSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
