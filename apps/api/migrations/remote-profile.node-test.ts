import type { TLSSocket } from 'node:tls';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rootCertificates } from 'node:tls';
import { createHash, X509Certificate } from 'node:crypto';
import {
  prepareConnection,
  verifyIdentity,
  verifyExternalTls,
  type RemoteProfile,
} from './remote-profile.ts';
const ca = rootCertificates.find((c) => {
  const p = new X509Certificate(c);
  return p.ca && Date.parse(p.validTo) > Date.now() && Date.parse(p.validFrom) < Date.now();
})!;
const profile: RemoteProfile = {
  kind: 'remote',
  approvalId: 'synthetic-approval',
  projectId: 'synthetic-project',
  branchId: 'synthetic-branch',
  host: 'ep-synthetic.us-east-2.aws.neon.tech',
  port: 5432,
  database: 'synthetic_db',
  migrator: 'migrator',
  runtime: 'runtime',
  versions: [180006],
  ca,
  caSha256: createHash('sha256').update(ca).digest('hex'),
};
const config = { host: profile.host, port: 5432, database: profile.database, user: 'migrator' };
test('remote TLS is exact-target opt-in, local guard remains and no connection is opened', () => {
  assert.throws(() => prepareConnection(config, 'runtime'));
  const c = prepareConnection(config, 'runtime', profile);
  assert.equal(typeof c.ssl, 'object');
  assert.deepEqual(c.ssl, { ca, servername: profile.host, rejectUnauthorized: true });
  for (const p of [
    { ...profile, host: 'ep-other.neon.tech' },
    { ...profile, caSha256: '0'.repeat(64) },
    { ...profile, port: 5433 },
    { ...profile, kind: 'local' },
  ])
    assert.throws(() => prepareConnection(config, 'runtime', p as RemoteProfile));
  assert.throws(() =>
    prepareConnection(
      { ...config, connectionString: 'postgres://localhost/x' },
      'runtime',
      profile,
    ),
  );
  assert.throws(() =>
    prepareConnection({ ...config, host: 'ep-synthetic-pooler.neon.tech' }, 'runtime', {
      ...profile,
      host: 'ep-synthetic-pooler.neon.tech',
    }),
  );
});
test('remote identity requires TLS/version/actor while local identity requires loopback', () => {
  const row = {
    database: config.database,
    actor: 'migrator',
    effective: 'migrator',
    tls: true,
    version: 180006,
  };
  verifyIdentity(row, config, profile);
  for (const bad of [
    { ...row, tls: false },
    { ...row, version: 160000 },
    { ...row, effective: 'admin' },
  ])
    assert.throws(() => verifyIdentity(bad, config, profile));
  assert.throws(() => verifyIdentity({ ...row, address: '10.0.0.1' }, config));
});
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, catalog } from './runner.ts';
test('local audit identity remains compatible with pre-remote pending evidence, before connection', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'is488-profile-audit-'));
  try {
    const connection = {
      host: '127.0.0.1',
      port: 55491,
      database: 'synthetic_db',
      user: 'migrator',
    };
    const target = createHash('sha256')
      .update(
        JSON.stringify([
          connection.host,
          connection.port,
          connection.database,
          connection.user,
          'runtime',
        ]),
      )
      .digest('hex');
    const file = join(dir, 'audit');
    writeFileSync(
      file,
      JSON.stringify({
        target,
        attempt: 'previous-local-attempt',
        event: 'transaction_dispatch',
        version: 1,
        checksum: catalog()[0]!.sha256,
      }) + '\n',
    );
    await assert.rejects(
      run('apply', { connection, runtimeRole: 'runtime', auditFile: file }),
      (e: unknown) => e instanceof Error && e.message === 'reconciliation_required',
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('Neon proxy exception requires exact approved target and live external TLS evidence', () => {
  const host = 'ep-icy-meadow-b4zhj5uj.c-6.us-east-2.aws.neon.tech';
  const p: RemoteProfile = {
    ...profile,
    host,
    database: 'is488_epic002_validation',
    neonProxy: { host },
  };
  const c = { ...config, host, database: p.database };
  prepareConnection(c, 'runtime', p);
  const row = {
    database: p.database,
    actor: c.user,
    effective: c.user,
    version: 180006,
    tls: false,
  };
  assert.throws(() => verifyIdentity(row, c, p));
  const evidence = {
    host,
    protocol: 'TLSv1.3',
    authorized: true as const,
    fingerprint256: 'test-observation',
  };
  verifyIdentity(row, c, p, evidence);
  assert.throws(() => verifyIdentity(row, c, p, { ...evidence, host: 'wrong.neon.tech' }));
  assert.throws(() =>
    prepareConnection({ ...c, host: 'ep-other.neon.tech' }, 'runtime', {
      ...p,
      host: 'ep-other.neon.tech',
    }),
  );
});

test('external TLS rejects plaintext, untrusted certificates, hostname mismatch and missing peer', () => {
  const host = 'ep-icy-meadow-b4zhj5uj.c-6.us-east-2.aws.neon.tech';
  const peer = {
    raw: new X509Certificate(ca).raw,
    fingerprint256: 'test-observation',
    subjectaltname: `DNS:${host}`,
  };
  const socket = {
    encrypted: true,
    authorized: true,
    authorizationError: undefined,
    getProtocol: () => 'TLSv1.3',
    getPeerCertificate: () => peer,
  };
  const check = (s: unknown) => verifyExternalTls(s as TLSSocket, host);
  assert.equal(check(socket).host, host);
  for (const bad of [
    { ...socket, encrypted: false },
    { ...socket, authorized: false, authorizationError: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' },
    { ...socket, getProtocol: () => 'TLSv1' },
    { ...socket, getPeerCertificate: () => ({ ...peer, subjectaltname: 'DNS:wrong.neon.tech' }) },
    { ...socket, getPeerCertificate: () => ({}) },
  ])
    assert.throws(() => check(bad));
});
