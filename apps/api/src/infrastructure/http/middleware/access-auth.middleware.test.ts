import { it, expect } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Hono } from 'hono';
import { createAccessAuth, type AccessProfile } from './access-auth.middleware.js';
const profile: AccessProfile = {
  issuer: 'https://synthetic.cloudflareaccess.com',
  audience: 'synthetic-a',
  actors: Object.fromEntries(
    ['O', 'O2', 'C', 'X', 'T'].map((actor, i) => [
      'client-' + actor,
      {
        actor: actor as 'O' | 'O2' | 'C' | 'X' | 'T',
        userId: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
        role: actor === 'T' ? 'teacher' : 'student',
      },
    ]),
  ),
};
it('jose validates signature/claims and maps synthetic identity, ignoring client privilege claims', async () => {
  const key = await generateKeyPair('RS256');
  const jwk = await exportJWK(key.publicKey);
  jwk.kid = 'test';
  let calls = 0;
  const transport: typeof fetch = async () => {
    calls++;
    return Response.json({ keys: [jwk] });
  };
  const app = new Hono();
  app.use('*', createAccessAuth(profile, transport));
  app.get('/', (c) => c.json(c.get('user')));
  const sign = (patch: Record<string, unknown> = {}) =>
    new SignJWT({ common_name: 'client-O', role: 'admin', ...patch })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(profile.issuer)
      .setAudience(profile.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey);
  const token = await sign();
  const r = await app.request('/', { headers: { 'Cf-Access-Jwt-Assertion': token } });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ role: 'student' });
  for (const bad of [
    await new SignJWT({ common_name: 'client-O' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(profile.issuer)
      .setAudience(profile.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(new Uint8Array(32)),
    await new SignJWT({ common_name: 'client-O' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(profile.issuer)
      .setAudience(profile.audience)
      .setIssuedAt()
      .setNotBefore('10m')
      .setExpirationTime('20m')
      .sign(key.privateKey),
    await new SignJWT({ common_name: 'client-O' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(profile.issuer)
      .setAudience(profile.audience)
      .setIssuedAt()
      .sign(key.privateKey),
    '',
    token.slice(0, -16) + 'AAAAAAAAAAAAAAAA',
    await sign({ common_name: 'unknown' }),
    await new SignJWT({ common_name: 'client-O' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer('https://wrong.cloudflareaccess.com')
      .setAudience(profile.audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey),
    await new SignJWT({ common_name: 'client-O' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(profile.issuer)
      .setAudience('wrong')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey),
    await new SignJWT({ common_name: 'client-O' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setIssuer(profile.issuer)
      .setAudience(profile.audience)
      .setIssuedAt()
      .setExpirationTime(1)
      .sign(key.privateKey),
  ])
    expect((await app.request('/', { headers: { 'Cf-Access-Jwt-Assertion': bad } })).status).toBe(
      401,
    );
  expect(
    (
      await app.request('/', {
        headers: { 'Cf-Access-Jwt-Assertion': token, 'X-Dev-User-Role': 'admin' },
      })
    ).status,
  ).toBe(401);
  expect(calls).toBe(1);
});
it('rejects HS256 and oversized or never-ending JWKS within deadline', async () => {
  const token = await new SignJWT({ common_name: 'client-O' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(profile.issuer)
    .setAudience(profile.audience)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new Uint8Array(32));
  for (const transport of [
    async () => new Response('x'.repeat(65537)),
    async () => new Response(new ReadableStream({ start() {} })),
  ]) {
    const app = new Hono();
    app.use('*', createAccessAuth(profile, transport));
    app.get('/', (c) => c.json({ ok: true }));
    expect((await app.request('/', { headers: { 'Cf-Access-Jwt-Assertion': token } })).status).toBe(
      401,
    );
  }
}, 5000);
