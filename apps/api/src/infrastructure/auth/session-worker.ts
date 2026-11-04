import { Pool, type ClientConfig } from 'pg';
import {
  LoginRequestSchema,
  VerificationRequestSchema,
  VerificationConfirmSchema,
  type IdentitySessionPort,
  type IdentityMailPort,
} from '@is488/shared';
import { BetterAuthSessionAdapter } from './better-auth.adapter.js';
import { createApp } from '../http/app.js';

export interface SessionEnvironment {
  AUTH_MODE?: string;
  NODE_ENV?: string;
  AUTH_ORIGIN?: string;
  AUTH_SECRET?: string;
  AUTH_MAIL_MODE?: string;
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
  ASSETS?: { fetch(request: Request): Promise<Response> };
  VALIDATION_DEPLOYMENT?: string;
}
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
export async function authRoute(
  request: Request,
  identity: IdentitySessionPort,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === '/api/auth/me' && request.method === 'GET') {
    const user = await identity.current(request.headers);
    return user ? json(user) : json({ error: 'Unauthorized' }, 401);
  }
  if (request.method !== 'POST') return json({ error: 'Not Found' }, 404);
  if (path === '/api/auth/sign-out') {
    const response = await identity.logout(request.headers);
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'private, no-store');
    return new Response(response.body, { status: response.status, headers });
  }
  // Enforce the bound even when Content-Length is absent or inaccurate.
  const reader = request.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > 8192) {
        await reader.cancel();
        return json({ error: 'Payload too large' }, 413);
      }
      chunks.push(part.value);
    }
  }
  const data = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(data));
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  if (path === '/api/auth/sign-in/email') {
    const parsed = LoginRequestSchema.safeParse(body);
    return parsed.success
      ? identity.login(parsed.data, request.headers)
      : json({ error: 'Invalid request' }, 400);
  }
  if (path === '/api/auth/verification/request') {
    const parsed = VerificationRequestSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request' }, 400);
    await identity.requestVerification(parsed.data.email, request.headers);
    return json({ success: true });
  }
  if (path === '/api/auth/verification/confirm') {
    const parsed = VerificationConfirmSchema.safeParse(body);
    if (!parsed.success) return json({ error: 'Invalid request' }, 400);
    return (await identity.confirmVerification(parsed.data.token, request.headers))
      ? json({ success: true })
      : json({ error: 'Invalid verification' }, 400);
  }
  return json({ error: 'Not Found' }, 404);
}

export async function sessionFetch(request: Request, env: SessionEnvironment): Promise<Response> {
  const url = new URL(request.url);
  if (
    env.AUTH_MODE === 'dev' &&
    env.NODE_ENV === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    return createApp({ nodeEnv: 'development', persistenceFromEnvironment: true }).fetch(
      request,
      env,
    );
  if (env.AUTH_MODE && env.AUTH_MODE !== 'session')
    return json({ error: 'Authentication configuration required' }, 503);
  const origin = env.AUTH_ORIGIN;
  if (
    !origin ||
    new URL(origin).protocol !== 'https:' ||
    !env.AUTH_SECRET ||
    env.AUTH_SECRET.length < 32
  )
    return json({ error: 'Authentication configuration required' }, 503);
  if (url.origin !== origin) return json({ error: 'Origin rejected' }, 403);
  const api = url.pathname.startsWith('/api/');
  if (!api && !url.pathname.startsWith('/app'))
    return env.ASSETS ? env.ASSETS.fetch(request) : json({ error: 'Not Found' }, 404);
  if (
    [...request.headers.keys()].some(
      (key) => key.toLowerCase().startsWith('x-dev-') || key.toLowerCase().startsWith('cf-access-'),
    )
  )
    return json({ error: 'Unauthorized' }, 401);
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== origin)
    return json({ error: 'Origin rejected' }, 403);
  let connection: ClientConfig;
  if (env.HYPERDRIVE?.connectionString)
    connection = { connectionString: env.HYPERDRIVE.connectionString };
  else {
    if (
      env.NODE_ENV !== 'development' ||
      !env.DATABASE_URL ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(env.DATABASE_URL).hostname)
    )
      return json({ error: 'SQL configuration required' }, 503);
    connection = { connectionString: env.DATABASE_URL };
  }
  const pool = new Pool({
    ...connection,
    max: 2,
    connectionTimeoutMillis: 3000,
    query_timeout: 5000,
  });
  try {
    const mail: IdentityMailPort = {
      async sendVerification(email, link) {
        if (env.NODE_ENV !== 'development' || env.AUTH_MAIL_MODE !== 'local')
          throw new Error('Mail provider unavailable');
        await pool.query('INSERT INTO public.auth_local_mail(email,url) VALUES ($1,$2)', [
          email,
          link,
        ]);
      },
    };
    const identity = new BetterAuthSessionAdapter(pool, { origin, secret: env.AUTH_SECRET, mail });
    await identity.ready();
    if (url.pathname.startsWith('/api/auth/')) return await authRoute(request, identity);
    const user = await identity.current(request.headers);
    if (!user)
      return api ? json({ error: 'Unauthorized' }, 401) : Response.redirect(origin + '/', 303);
    if (!api) {
      if (!env.ASSETS) return json({ error: 'Not Found' }, 404);
      const asset = await env.ASSETS.fetch(new Request(origin + '/'));
      const headers = new Headers(asset.headers);
      headers.set('cache-control', 'private, no-store');
      return new Response(asset.body, { status: asset.status, headers });
    }
    return await createApp({
      nodeEnv: env.NODE_ENV,
      persistence: { mode: 'postgres', connection },
      authentication: async (c, next) => {
        c.set('user', user);
        c.header('cache-control', 'private, no-store');
        await next();
      },
    }).fetch(request);
  } catch (error) {
    console.error(
      JSON.stringify({
        stage: 'identity-request',
        type: error instanceof Error ? error.name : 'UnknownError',
      }),
    );
    return json({ error: 'Request failed' }, 500);
  } finally {
    try {
      await pool.end();
    } catch {
      console.error(JSON.stringify({ stage: 'identity-close', outcome: 'unconfirmed' }));
    }
  }
}
