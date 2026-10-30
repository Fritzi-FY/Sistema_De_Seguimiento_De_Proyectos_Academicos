import { it, expect } from 'vitest';
import { createApp } from './app.js';
import { InMemoryTeacherProjectScopeAdapter } from '../adapters/repositories/in-memory-teacher-project-scope.adapter.js';
it('SEC-01 HTTP assignment is read-only; teacher owner retains relationship permissions', async () => {
  const grants = new Map<string, readonly string[]>();
  const app = createApp({
    nodeEnv: 'test',
    teacherProjectScope: new InMemoryTeacherProjectScopeAdapter(grants),
  });
  const hdr = (id: string) => ({
    'X-Dev-User-Id': id,
    'X-Dev-User-Role': 'teacher',
    'Content-Type': 'application/json',
  });
  const created = await app.request('/api/projects', {
    method: 'POST',
    headers: hdr('owner'),
    body: JSON.stringify({
      title: 'Synthetic SEC project',
      courseCode: 'IS488',
      startDate: '2026-10-26T00:00:00.000Z',
      targetDate: '2026-12-31T00:00:00.000Z',
    }),
  });
  expect(created.status).toBe(201);
  const p = (await created.json()) as { id: string };
  expect((await app.request('/api/projects/' + p.id, { headers: hdr('t') })).status).toBe(404);
  expect(await (await app.request('/api/projects', { headers: hdr('t') })).json()).toEqual([]);
  grants.set('t', [p.id]);
  expect((await app.request('/api/projects/' + p.id, { headers: hdr('t') })).status).toBe(200);
  expect(
    (
      await app.request('/api/projects/' + p.id + '/members', {
        method: 'POST',
        headers: hdr('t'),
        body: JSON.stringify({
          userId: '22222222-2222-4222-8222-222222222222',
          role: 'collaborator',
        }),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request('/api/projects/' + p.id + '/members', {
        method: 'POST',
        headers: hdr('owner'),
        body: JSON.stringify({
          userId: '22222222-2222-4222-8222-222222222222',
          role: 'collaborator',
        }),
      })
    ).status,
  ).toBe(201);
  grants.clear();
  expect((await app.request('/api/projects/' + p.id, { headers: hdr('t') })).status).toBe(404);
});
it('remote composition fails closed, never falls back to Maps/dev and rejects unapproved routes', async () => {
  const app = createApp({
    remoteValidation: 'A',
    authentication: async (c, next) => {
      c.set('user', { userId: 'synthetic', role: 'student' });
      await next();
    },
  });
  expect((await app.request('/api/projects')).status).toBe(503);
  expect(
    (await app.request('/api/projects', { headers: { 'X-Dev-User-Role': 'admin' } })).status,
  ).toBe(401);
  expect((await app.request('/api/openapi.json')).status).toBe(404);
  expect((await app.request('/api/projects/x/board')).status).toBe(404);
});
it('remote JWT rejection precedes any SQL connection even with a configured binding', async () => {
  const { createAccessAuth } = await import('./middleware/access-auth.middleware.js');
  const actors = Object.fromEntries(
    ['O', 'O2', 'C', 'X', 'T'].map((a, i) => [
      'client-' + a,
      {
        actor: a as 'O' | 'O2' | 'C' | 'X' | 'T',
        userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        role: a === 'T' ? 'teacher' : 'student',
      },
    ]),
  );
  const auth = createAccessAuth(
    { issuer: 'https://synthetic.cloudflareaccess.com', audience: 'synthetic-a', actors },
    async () => Response.json({ keys: [] }),
  );
  const app = createApp({ remoteValidation: 'A', authentication: auth });
  const response = await app.request(
    '/api/projects',
    { headers: { 'Cf-Access-Jwt-Assertion': 'invalid.jwt.token' } },
    {
      PERSISTENCE_MODE: 'postgres',
      HYPERDRIVE: {
        get connectionString(): string {
          throw new Error('Binding must not be read before auth');
        },
      },
    },
  );
  expect(response.status).toBe(401);
});
