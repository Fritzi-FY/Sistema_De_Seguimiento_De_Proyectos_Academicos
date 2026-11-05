import { describe, it, expect } from 'vitest';
import { LoginRequestSchema, CurrentUserSchema } from './identity-access.contract.js';
describe('identity contracts', () => {
  it('normalizes email and rejects privilege, UUID and remember-me input', () => {
    const input = { email: ' Student@synthetic.example.test ', password: 'synthetic-password' };
    expect(LoginRequestSchema.parse(input).email).toBe('student@synthetic.example.test');
    for (const extra of [{ role: 'admin' }, { userId: crypto.randomUUID() }, { rememberMe: true }])
      expect(LoginRequestSchema.safeParse({ ...input, ...extra }).success).toBe(false);
  });
  it('requires UUID, server role, deadline and excludes secrets from me', () => {
    const user = {
      userId: crypto.randomUUID(),
      role: 'student',
      email: 's@synthetic.example.test',
      name: 'Synthetic',
      expiresAt: '2026-11-01T12:00:00.000Z',
    };
    expect(CurrentUserSchema.safeParse(user).success).toBe(true);
    for (const change of [{ token: 'secret' }, { role: 'owner' }, { userId: 'email' }])
      expect(CurrentUserSchema.safeParse({ ...user, ...change }).success).toBe(false);
  });
});
