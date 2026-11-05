import { describe, it, expect, vi } from 'vitest';
import type { IdentitySessionPort } from '@is488/shared';
import { authRoute, sessionFetch } from './session-worker.js';
import { createApp } from '../http/app.js';

const origin = 'https://localhost:8792';
const request = (path: string, body: unknown) =>
  new Request(origin + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
const port = (): IdentitySessionPort => ({
  current: vi.fn().mockResolvedValue(null),
  login: vi.fn().mockResolvedValue(new Response('{}')),
  logout: vi.fn().mockResolvedValue(new Response('{}')),
  requestVerification: vi.fn(),
  confirmVerification: vi.fn().mockResolvedValue(true),
});
describe('session boundary', () => {
  it('fails closed without settings or with dev mode outside explicit development', async () => {
    expect((await sessionFetch(new Request(origin + '/api/projects'), {})).status).toBe(503);
    expect(
      (
        await sessionFetch(new Request(origin + '/api/projects'), {
          AUTH_MODE: 'dev',
          NODE_ENV: 'production',
        })
      ).status,
    ).toBe(503);
  });
  it('rejects dev/Access identity headers and cross-origin product mutations before SQL', async () => {
    const env = { AUTH_ORIGIN: origin, AUTH_SECRET: 'x'.repeat(48) };
    for (const header of ['X-Dev-User-Id', 'Cf-Access-Jwt-Assertion'])
      expect(
        (
          await sessionFetch(
            new Request(origin + '/api/projects', { headers: { [header]: 'forged' } }),
            env,
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await sessionFetch(
          new Request(origin + '/api/projects', {
            method: 'POST',
            headers: { origin: 'https://attacker.test' },
          }),
          env,
        )
      ).status,
    ).toBe(403);
  });
  it('does not fall back to dev-auth when an injected authority supplies no identity', async () => {
    const app = createApp({
      nodeEnv: 'development',
      authentication: async (_c, next) => {
        await next();
      },
    });
    expect(
      (
        await app.request('/api/projects', {
          headers: {
            'X-Dev-User-Id': '11111111-1111-4111-8111-111111111111',
            'X-Dev-User-Role': 'admin',
          },
        })
      ).status,
    ).toBe(401);
  });
  it('strictly validates login and bounds bodies without Content-Length', async () => {
    const identity = port();
    expect(
      (
        await authRoute(
          request('/api/auth/sign-in/email', {
            email: 's@synthetic.example.test',
            password: 'x',
            role: 'admin',
          }),
          identity,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await authRoute(
          request('/api/auth/sign-in/email', {
            email: 's@synthetic.example.test',
            password: 'x'.repeat(9000),
          }),
          identity,
        )
      ).status,
    ).toBe(413);
    expect(identity.login).not.toHaveBeenCalled();
  });
  it('does not expose native signup, admin, profile or verification GET mutations', async () => {
    const identity = port();
    for (const path of ['sign-up/email', 'update-user', 'admin/set-role'])
      expect((await authRoute(request('/api/auth/' + path, {}), identity)).status).toBe(404);
    expect(
      (await authRoute(new Request(origin + '/api/auth/verify-email?token=x'), identity)).status,
    ).toBe(404);
  });
  it('does not claim logout after a failed transport', async () => {
    const identity = port();
    vi.mocked(identity.logout).mockRejectedValue(new Error('transport'));
    await expect(authRoute(request('/api/auth/sign-out', {}), identity)).rejects.toThrow(
      'transport',
    );
  });
});
