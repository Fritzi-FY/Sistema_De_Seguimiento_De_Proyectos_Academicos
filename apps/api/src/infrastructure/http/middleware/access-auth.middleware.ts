import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { AuthMiddleware, AuthUserContext } from './auth.middleware.js';
export type SyntheticActor = 'O' | 'O2' | 'C' | 'X' | 'T';
export interface AccessProfile {
  issuer: string;
  audience: string;
  actors: Readonly<Record<string, AuthUserContext & { actor: SyntheticActor }>>;
}
export function createAccessAuth(
  profile: AccessProfile,
  transport: typeof fetch = fetch,
): AuthMiddleware {
  const issuer = new URL(profile.issuer);
  const actors = Object.values(profile.actors);
  if (
    issuer.protocol !== 'https:' ||
    !!issuer.port ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash ||
    issuer.pathname !== '/' ||
    !issuer.hostname.endsWith('.cloudflareaccess.com') ||
    !profile.audience ||
    actors.length !== 5 ||
    new Set(actors.map((a) => a.actor)).size !== 5 ||
    new Set(actors.map((a) => a.userId)).size !== 5 ||
    actors.some(
      (a) =>
        !['O', 'O2', 'C', 'X', 'T'].includes(a.actor) ||
        a.role !== (a.actor === 'T' ? 'teacher' : 'student') ||
        !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(a.userId),
    )
  )
    throw new Error('Invalid synthetic Access profile');
  let cached: ReturnType<typeof createLocalJWKSet> | undefined,
    expires = 0;

  async function keys() {
    if (cached && Date.now() < expires) return cached;
    const pending = (async () => {
      const controller = new AbortController();
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const work = (async () => {
          const response = await transport(new URL('/cdn-cgi/access/certs', issuer), {
            signal: controller.signal,
            redirect: 'error',
          });
          if (
            !response.ok ||
            !response.body ||
            Number(response.headers.get('content-length') ?? 0) > 65536
          )
            throw new Error('JWKS rejected');
          const reader = response.body.getReader();
          activeReader = reader;
          let total = 0;
          const chunks: Uint8Array[] = [];
          try {
            for (;;) {
              const part = await reader.read();
              if (part.done) break;
              total += part.value.byteLength;
              if (total > 65536) throw new Error('JWKS too large');
              chunks.push(part.value);
            }
          } finally {
            void reader.cancel().catch(() => {});
          }
          const data = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
          }
          const jwks = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(data),
          ) as JSONWebKeySet;
          if (!Array.isArray(jwks.keys) || jwks.keys.length > 32) throw new Error('Invalid keys');
          return createLocalJWKSet(jwks);
        })();
        cached = await Promise.race([
          work,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(new Error('JWKS deadline'));
            }, 2000);
          }),
        ]);
        expires = Date.now() + 300000;
        return cached;
      } finally {
        if (timer) clearTimeout(timer);
        void activeReader?.cancel().catch(() => {});
      }
    })();
    return pending;
  }
  return async (c, next) => {
    if ([...c.req.raw.headers.keys()].some((k) => k.toLowerCase().startsWith('x-dev-')))
      return c.json({ error: 'Unauthorized' }, 401);
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token || token.length > 16384) return c.json({ error: 'Unauthorized' }, 401);
    let actor: AuthUserContext | undefined;
    try {
      const { payload } = await jwtVerify(token, await keys(), {
        issuer: profile.issuer,
        audience: profile.audience,
        algorithms: ['RS256'],
        requiredClaims: ['exp', 'iat', 'iss', 'aud'],
        clockTolerance: 0,
      });
      const common = payload.common_name;
      const entry =
        typeof common === 'string' && Object.hasOwn(profile.actors, common)
          ? profile.actors[common]
          : undefined;
      if (!entry) throw new Error('Unknown actor');
      actor = { userId: entry.userId, role: entry.role };
    } catch {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    c.set('user', actor);
    await next();
  };
}
