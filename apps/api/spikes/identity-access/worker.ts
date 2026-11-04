import { Pool } from 'pg';
import { createSpikeAuth } from './auth.js';
import { createApp } from '../../src/infrastructure/http/app.js';
import type { AuthMiddleware } from '../../src/infrastructure/http/middleware/auth.middleware.js';

interface SpikeEnv {
  SPIKE_ORIGIN: string;
  SPIKE_DB_PASSWORD: string;
  SPIKE_SECRET: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });

export default {
  async fetch(request: Request, env: SpikeEnv) {
    const path = new URL(request.url).pathname;
    if (path === '/spike-ready') return json({ ready: true });
    if (!path.startsWith('/api/') && path !== '/app') return env.ASSETS.fetch(request);
    const connection = {
      host: '127.0.0.1',
      port: 55510,
      database: 'is488_auth_spike',
      user: 'is488_auth_spike_runtime',
      password: env.SPIKE_DB_PASSWORD,
      connectionTimeoutMillis: 3000,
    };
    const pool = new Pool({ ...connection, max: 2 });
    try {
      if ([...request.headers.keys()].some((k) => k.toLowerCase().startsWith('x-dev-')))
        return json({ error: 'Unauthorized' }, 401);
      const auth = createSpikeAuth(pool, { secret: env.SPIKE_SECRET, origin: env.SPIKE_ORIGIN });
      await (await auth.$context).checkSchema?.();
      async function identity() {
        const value = await auth.api.getSession({ headers: request.headers });
        if (!value) return null;
        const grant = (
          await pool.query(
            'SELECT role FROM public.spike_role_grants WHERE user_id=$1 AND active',
            [value.user.id],
          )
        ).rows[0];
        return grant
          ? {
              userId: value.user.id,
              role: String(grant.role),
              email: value.user.email,
              name: value.user.name,
            }
          : null;
      }
      if (path === '/api/auth/me') {
        const user = await identity();
        return user ? json(user) : json({ error: 'Unauthorized' }, 401);
      }
      if (path.startsWith('/api/auth/')) {
        const permitted = [
          '/api/auth/sign-in/email',
          '/api/auth/sign-out',
          '/api/auth/send-verification-email',
          '/api/auth/verify-email',
          '/api/auth/sign-up/email',
          '/api/auth/update-user',
        ];
        if (!permitted.includes(path)) return json({ error: 'Not Found' }, 404);
        if (request.method === 'POST') {
          if (request.headers.get('origin') !== env.SPIKE_ORIGIN)
            return json({ error: 'Origin rejected' }, 403);
          if (Number(request.headers.get('content-length') ?? 0) > 8192)
            return json({ error: 'Payload too large' }, 413);
          const body = (await request.clone().json()) as Record<string, unknown>;
          if (['role', 'roles', 'userId'].some((key) => key in body))
            return json({ error: 'Privilege input rejected' }, 400);
          if (path === '/api/auth/sign-in/email') {
            const normalized = new Request(request, {
              body: JSON.stringify({ ...body, rememberMe: false }),
            });
            const response = await auth.handler(normalized);
            const headers = new Headers(response.headers);
            headers.set('cache-control', 'private, no-store');
            return new Response(JSON.stringify({ success: response.ok }), {
              status: response.status,
              headers,
            });
          }
        }
        return await auth.handler(request);
      }
      if (path === '/app') {
        if (!(await identity())) return Response.redirect(env.SPIKE_ORIGIN + '/', 303);
        const assets = await env.ASSETS.fetch(new Request(env.SPIKE_ORIGIN + '/'));
        const headers = new Headers(assets.headers);
        headers.set('cache-control', 'private, no-store');
        return new Response(assets.body, { status: assets.status, headers });
      }
      const authentication: AuthMiddleware = async (c, next) => {
        const user = await identity();
        if (!user) return c.json({ error: 'Unauthorized' }, 401);
        c.set('user', user);
        c.header('cache-control', 'private, no-store');
        await next();
      };
      return await createApp({
        nodeEnv: 'development',
        authentication,
        persistence: { mode: 'postgres', connection },
      }).fetch(request);
    } catch (error) {
      console.error(
        JSON.stringify({
          stage: 'spike-request',
          type: error instanceof Error ? error.name : 'UnknownError',
          code: (error as { code?: string }).code,
        }),
      );
      return json({ error: 'Spike request failed' }, 500);
    } finally {
      await pool.end();
    }
  },
};
