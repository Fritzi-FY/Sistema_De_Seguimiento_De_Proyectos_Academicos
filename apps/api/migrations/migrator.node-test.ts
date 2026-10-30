import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client, type ClientConfig } from 'pg';
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { run, LOCK, catalog, type Options, type MigrationError } from './runner.ts';

const enabled = process.env.IS488_MIGRATOR_TEST === '1';
const adminConfig: ClientConfig = {
  host: '127.0.0.1',
  port: 55490,
  user: 'is488_migration_admin',
  database: 'postgres',
  connectionTimeoutMillis: 2000,
};
const directory = dirname(fileURLToPath(import.meta.url));
let admin: Client;
let fixtureRoot: string;
let initialDirectory: string;
const resources: { db: string; migrator: string; runtime: string }[] = [];
const clients: Client[] = [];
before(async () => {
  if (!enabled) return;
  assert.match(
    process.env.IS488_MIGRATION_TEST_DIR ?? '',
    /[\\/]Temp[\\/]is488-migrator-[a-f0-9]{32}$/,
  );
  admin = new Client(adminConfig);
  await admin.connect();
  const r = await admin.query(
    "SELECT current_user AS actor,current_setting('data_directory') AS dir,inet_server_port() AS port",
  );
  assert.equal(r.rows[0].actor, 'is488_migration_admin');
  assert.equal(r.rows[0].port, 55490);
  assert.equal(
    r.rows[0].dir.replaceAll('\\', '/').toLowerCase(),
    process.env.IS488_MIGRATION_TEST_DIR!.replaceAll('\\', '/').toLowerCase(),
  );
  fixtureRoot = mkdtempSync(join(tmpdir(), 'is488-migration-fixtures-'));
  initialDirectory = join(fixtureRoot, 'initial');
  mkdirSync(join(initialDirectory, 'sql'), { recursive: true });
  writeFileSync(
    join(initialDirectory, 'sql/0001_initial.sql'),
    readFileSync(join(directory, 'sql/0001_initial.sql')),
  );
  writeFileSync(
    join(initialDirectory, 'manifest.json'),
    JSON.stringify([JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))[0]]),
  );
});
after(async () => {
  if (!enabled) return;
  await Promise.all(clients.map((c) => c.end().catch(() => {})));
  if (admin) {
    for (const r of resources) {
      await admin.query('DROP DATABASE IF EXISTS ' + r.db + ' WITH (FORCE)');
      await admin.query('DROP ROLE ' + r.runtime);
      await admin.query('DROP ROLE ' + r.migrator);
    }
    const r = await admin.query(
      "SELECT datname FROM pg_database WHERE datname LIKE 'is488_mtest_%'",
    );
    assert.equal(r.rowCount, 0);
    await admin.end();
  }
  if (fixtureRoot && process.env.IS488_MIGRATION_TEST_EVIDENCE) {
    const destination = process.env.IS488_MIGRATION_TEST_EVIDENCE;
    mkdirSync(destination, { recursive: true });
    for (const file of readdirSync(fixtureRoot).filter((n) => n.endsWith('.jsonl')))
      copyFileSync(join(fixtureRoot, file), join(destination, file));
  }
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true });
});
async function fixture() {
  const id = randomUUID().replaceAll('-', '');
  const db = 'is488_mtest_' + id,
    migrator = 'is488_m_' + id,
    runtime = 'is488_r_' + id;
  await admin.query(
    'CREATE ROLE ' + migrator + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  );
  await admin.query(
    'CREATE ROLE ' + runtime + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
  );
  resources.push({ db, migrator, runtime });
  await admin.query('CREATE DATABASE ' + db + ' OWNER ' + migrator);
  await admin.query('REVOKE TEMPORARY ON DATABASE ' + db + ' FROM PUBLIC,' + runtime);
  const connection = { ...adminConfig, database: db, user: migrator };
  const options: Options = {
    directory: initialDirectory,
    connection,
    runtimeRole: runtime,
    auditFile: join(fixtureRoot, id + '.jsonl'),
    lockMs: 500,
    statementMs: 2000,
  };
  return { options, db, migrator, runtime };
}
async function client(c: ClientConfig) {
  const v = new Client(c);
  clients.push(v);
  await v.connect();
  return v;
}
async function rejected(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: unknown) => e instanceof Error && e.message === code);
}
function evolved(sql: string) {
  const dir = mkdtempSync(join(fixtureRoot, 'catalog-'));
  mkdirSync(join(dir, 'sql'));
  const first = readFileSync(join(directory, 'sql/0001_initial.sql'));
  writeFileSync(join(dir, 'sql/0001_initial.sql'), first);
  writeFileSync(join(dir, 'sql/0002_evolve.sql'), sql);
  const checksum = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify([
      { version: 1, name: '0001_initial.sql', sha256: checksum(first) },
      { version: 2, name: '0002_evolve.sql', sha256: checksum(sql) },
    ]),
  );
  return dir;
}
const synthetic = `INSERT INTO public.projects VALUES ('11111111-1111-4111-8111-111111111111','Synthetic project',NULL,'IS488','active','2026-10-26','2026-12-31','synthetic-owner','2026-10-26','2026-10-26')`;

test(
  'primera aplicación, plan sin DDL, reejecución e integridad ledger',
  { skip: !enabled },
  async () => {
    const f = await fixture(),
      c = await client(f.options.connection);
    assert.equal((await run('plan', f.options)).outcome, 'planned');
    assert.equal(
      (await c.query("SELECT to_regclass('is488_migrations.versions') AS ledger")).rows[0].ledger,
      null,
    );
    const result = await run('apply', f.options);
    assert.deepEqual(result.applied, [1]);
    assert.equal(result.closeConfirmed, true);
    assert.equal((await run('apply', f.options)).outcome, 'unchanged');
    const r = await c.query('SELECT version,checksum FROM is488_migrations.versions');
    assert.equal(r.rowCount, 1);
    assert.equal(r.rows[0].checksum, catalog()[0].sha256);
    const events = readFileSync(f.options.auditFile, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    assert.ok(
      events.findIndex((e) => e.event === 'commit_dispatch') <
        events.findIndex((e) => e.event === 'commit_confirmed'),
    );
    assert.ok(!readFileSync(f.options.auditFile, 'utf8').includes('password'));
  },
);
test('evolución conserva datos sintéticos y nuevo checksum', { skip: !enabled }, async () => {
  const f = await fixture();
  await run('apply', f.options);
  const c = await client(f.options.connection);
  await c.query(synthetic);
  const opts = {
    ...f.options,
    directory: evolved('ALTER TABLE public.projects ADD COLUMN local_note text;'),
  };
  assert.deepEqual((await run('apply', opts)).applied, [2]);
  assert.equal(
    (await c.query('SELECT title,local_note FROM public.projects')).rows[0].title,
    'Synthetic project',
  );
  assert.equal(
    (await c.query('SELECT count(*)::int AS n FROM is488_migrations.versions')).rows[0].n,
    2,
  );
  assert.equal((await run('apply', opts)).outcome, 'unchanged');
});
test('fallo intermedio revierte DDL y ledger de esa versión', { skip: !enabled }, async () => {
  const f = await fixture();
  await run('apply', f.options);
  const c = await client(f.options.connection);
  await c.query(synthetic);
  await rejected(
    run('apply', {
      ...f.options,
      directory: evolved('ALTER TABLE public.projects ADD COLUMN partial text; SELECT 1/0;'),
    }),
    'migration_rolled_back',
  );
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND column_name='partial'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await c.query('SELECT count(*)::int AS n FROM is488_migrations.versions')).rows[0].n,
    1,
  );
  assert.equal((await c.query('SELECT count(*)::int AS n FROM public.projects')).rows[0].n, 1);
});
test(
  'dos primeras aplicaciones concurrentes crean una sola versión',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    const dir = evolved('SELECT 1;');
    const first =
      readFileSync(join(dir, 'sql/0001_initial.sql'), 'utf8') + '\nSELECT pg_sleep(0.5);';
    writeFileSync(join(dir, 'sql/0001_initial.sql'), first);
    rmSync(join(dir, 'sql/0002_evolve.sql'));
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify([
        {
          version: 1,
          name: '0001_initial.sql',
          sha256: createHash('sha256').update(first).digest('hex'),
        },
      ]),
    );
    const c = await client(f.options.connection);
    const work = Promise.all([
      run('apply', { ...f.options, directory: dir, lockMs: 2000 }),
      run('apply', {
        ...f.options,
        directory: dir,
        lockMs: 2000,
        auditFile: join(fixtureRoot, randomUUID() + '.jsonl'),
      }),
    ]);
    let overlap = false;
    for (let i = 0; i < 60; i++) {
      const observed = await c.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND application_name='is488-product-migrator' AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_lock%'",
      );
      if (observed.rowCount) {
        overlap = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    const r = await work;
    assert.ok(overlap, 'independent session observed an advisory-lock waiter');
    assert.deepEqual(r.map((v) => v.outcome).sort(), ['committed', 'unchanged']);
    assert.equal(
      (await c.query('SELECT count(*)::int AS n FROM is488_migrations.versions')).rows[0].n,
      1,
    );
  },
);
test('mismo lock bloquea apply y reconcile con espera acotada', { skip: !enabled }, async () => {
  const f = await fixture(),
    holder = await client(f.options.connection);
  await holder.query('SELECT pg_advisory_lock($1,$2)', [...LOCK]);
  for (const mode of ['apply', 'reconcile'] as const) {
    const start = Date.now();
    await rejected(run(mode, { ...f.options, lockMs: 100 }), 'lock_timeout');
    assert.ok(Date.now() - start < 3000);
  }
  assert.equal(
    (await holder.query("SELECT to_regclass('is488_migrations.versions') AS ledger")).rows[0]
      .ledger,
    null,
  );
  await holder.query('SELECT pg_advisory_unlock($1,$2)', [...LOCK]);
});
test('rechaza base existente sin baseline aprobado', { skip: !enabled }, async () => {
  const f = await fixture(),
    c = await client(f.options.connection);
  await c.query('CREATE TABLE public.legacy(id integer)');
  for (const mode of ['plan', 'apply', 'reconcile'] as const)
    await rejected(run(mode, f.options), 'baseline_required');
  assert.equal(
    (await c.query("SELECT to_regclass('is488_migrations.versions') AS ledger")).rows[0].ledger,
    null,
  );
});
test('rechaza checksum de archivo, huecos y versión no listada', { skip: !enabled }, async () => {
  const f = await fixture(),
    dir = evolved('ALTER TABLE public.projects ADD COLUMN note text;');
  writeFileSync(join(dir, 'sql/0002_evolve.sql'), 'SELECT 1;');
  await rejected(run('apply', { ...f.options, directory: dir }), 'catalog_checksum_mismatch');
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  manifest[1].version = 3;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  await rejected(run('plan', { ...f.options, directory: dir }), 'invalid_catalog');
});
test('rechaza ledger desconocido, alterado y drift de esquema', { skip: !enabled }, async () => {
  const f = await fixture();
  await run('apply', f.options);
  const c = await client(f.options.connection);
  await c.query("UPDATE is488_migrations.versions SET checksum='altered'");
  await rejected(run('apply', f.options), 'ledger_mismatch');
  await c.query('UPDATE is488_migrations.versions SET checksum=$1', [catalog()[0].sha256]);
  await c.query(
    "INSERT INTO is488_migrations.versions(version,name,checksum,fingerprint,runner) VALUES(99,'unknown','x','x','test')",
  );
  await rejected(run('plan', f.options), 'ledger_mismatch');
  await c.query('DELETE FROM is488_migrations.versions WHERE version=99');
  await c.query('ALTER TABLE public.projects ADD COLUMN unexpected text');
  await rejected(run('reconcile', f.options), 'schema_drift');
});
test(
  'runtime arw permitido, ledger/DDL/DELETE denegados, sin asumir migrador',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    await run('apply', f.options);
    const c = await client({ ...f.options.connection, user: f.runtime });
    await c.query(synthetic);
    assert.equal((await c.query('SELECT count(*)::int AS n FROM public.projects')).rows[0].n, 1);
    await c.query("UPDATE public.projects SET title='Updated synthetic'");
    for (const sql of [
      'DELETE FROM public.projects',
      'CREATE TABLE public.forbidden(id int)',
      'CREATE TEMP TABLE forbidden_temp(id int)',
      'SELECT * FROM is488_migrations.versions',
      "INSERT INTO is488_migrations.versions VALUES(9,'x','x','x',now(),'x')",
      'ALTER TABLE public.projects ADD COLUMN forbidden text',
      'SET ROLE ' + f.migrator,
    ])
      await assert.rejects(c.query(sql), (e: unknown) => (e as { code: string }).code === '42501');
  },
);
test(
  'rechaza roles administrativos y evidencia no escribible antes de DDL',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    await rejected(
      run('apply', {
        ...f.options,
        connection: { ...f.options.connection, user: 'is488_migration_admin' },
      }),
      'unsafe_roles',
    );
    await assert.rejects(
      run('apply', { ...f.options, auditFile: join(fixtureRoot, 'missing', 'audit.jsonl') }),
    );
    const c = await client(f.options.connection);
    assert.equal(
      (await c.query("SELECT to_regclass('is488_migrations.versions') AS ledger")).rows[0].ledger,
      null,
    );
  },
);
test(
  'pérdida real de respuesta COMMIT: unknown, lote detenido, reconciliación nueva sin reapply',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    const sockets = new Set<Socket>();
    let dropped = false;
    const server = createServer((peer) => {
      const backend = connect({ host: '127.0.0.1', port: 55490 });
      sockets.add(peer);
      sockets.add(backend);
      let commit = false;
      let commands = Buffer.alloc(0),
        responses = Buffer.alloc(0);
      peer.on('data', (b) => {
        commands = Buffer.concat([commands, typeof b === 'string' ? Buffer.from(b) : b]);
        if (commands.includes(Buffer.from('COMMIT\0'))) commit = true;
        backend.write(b);
      });
      backend.on('data', (b) => {
        responses = Buffer.concat([responses, typeof b === 'string' ? Buffer.from(b) : b]);
        if (commit && !dropped && responses.includes(Buffer.from('COMMIT\0'))) {
          dropped = true;
          peer.destroy();
          backend.destroy();
        } else peer.write(b);
      });
      peer.on('error', () => {});
      backend.on('error', () => peer.destroy());
      peer.on('close', () => backend.destroy());
      backend.on('close', () => peer.destroy());
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const port = (server.address() as { port: number }).port;
      const opts = {
        ...f.options,
        connection: { ...f.options.connection, port },
        directory: evolved('ALTER TABLE public.projects ADD COLUMN never_applied text;'),
      };
      await assert.rejects(run('apply', opts), (error: unknown) => {
        assert.ok(error instanceof Error && error.message === 'commit_unknown');
        const detail = error as MigrationError;
        assert.equal(detail.transactionOutcome, 'unknown');
        assert.equal(detail.diagnostic?.stage, 'commit');
        assert.equal(typeof detail.closeConfirmed, 'boolean');
        assert.ok(detail.timings?.commitDispatchedAt);
        assert.equal(detail.timings?.commitConfirmedAt, undefined);
        return true;
      });
      assert.equal(dropped, true);
      const observer = await client(f.options.connection);
      assert.equal(
        (await observer.query('SELECT count(*)::int AS n FROM is488_migrations.versions')).rows[0]
          .n,
        1,
      );
      await rejected(run('apply', opts), 'reconciliation_required');
      const reconciled = await run('reconcile', opts);
      assert.equal(reconciled.outcome, 'observed');
      assert.deepEqual(reconciled.observed, [1]);
      assert.equal(
        (
          await observer.query(
            "SELECT count(*)::int AS n FROM information_schema.columns WHERE column_name='never_applied'",
          )
        ).rows[0].n,
        0,
      );
      const events = readFileSync(opts.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.ok(events.some((e) => e.event === 'reconciled_applied'));
      assert.equal(events.filter((e) => e.event === 'transaction_dispatch').length, 1);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    }
  },
);
test(
  'COMMIT no recibido por servidor: reconciliación ausente mantiene bloqueo sin reaplicar',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    const sockets = new Set<Socket>();
    let dropped = false;
    const server = createServer((peer) => {
      const backend = connect({ host: '127.0.0.1', port: 55490 });
      sockets.add(peer);
      sockets.add(backend);
      let input = Buffer.alloc(0);
      peer.on('data', (b) => {
        input = Buffer.concat([input, typeof b === 'string' ? Buffer.from(b) : b]);
        if (!dropped && input.includes(Buffer.from('COMMIT\0'))) {
          dropped = true;
          peer.destroy();
          backend.destroy();
        } else backend.write(b);
      });
      backend.on('data', (b) => peer.write(b));
      peer.on('error', () => {});
      backend.on('error', () => peer.destroy());
      peer.on('close', () => backend.destroy());
      backend.on('close', () => peer.destroy());
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const opts = {
        ...f.options,
        connection: { ...f.options.connection, port: (server.address() as { port: number }).port },
      };
      await rejected(run('apply', opts), 'commit_unknown');
      assert.ok(dropped);
      const r = await run('reconcile', opts);
      assert.deepEqual(r.observed, []);
      await rejected(run('apply', opts), 'reconciliation_required');
      const c = await client(f.options.connection);
      assert.equal(
        (await c.query("SELECT to_regclass('public.projects') AS tbl")).rows[0].tbl,
        null,
      );
      const events = readFileSync(opts.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      assert.ok(events.some((e) => e.event === 'reconciled_absent'));
      assert.equal(events.filter((e) => e.event === 'transaction_dispatch').length, 1);
    } finally {
      for (const s of sockets) s.destroy();
      await new Promise<void>((r, e) => server.close((err) => (err ? e(err) : r())));
    }
  },
);
test('statement timeout revierte la versión con límite finito', { skip: !enabled }, async () => {
  const f = await fixture();
  await run('apply', f.options);
  const start = Date.now();
  await rejected(
    run('apply', {
      ...f.options,
      statementMs: 100,
      directory: evolved(
        'ALTER TABLE public.projects ADD COLUMN timed_out text; SELECT pg_sleep(1);',
      ),
    }),
    'migration_rolled_back',
  );
  assert.ok(Date.now() - start < 3000);
  const c = await client(f.options.connection);
  assert.equal(
    (
      await c.query(
        "SELECT count(*)::int AS n FROM information_schema.columns WHERE column_name='timed_out'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await c.query('SELECT count(*)::int AS n FROM is488_migrations.versions')).rows[0].n,
    1,
  );
});

test(
  'migration 2 keeps the 15s bound with 130ms roundtrips and batched ACL checks',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    const latencyDirectory = mkdtempSync(join(fixtureRoot, 'latency-v2-'));
    const latencyCatalog = catalog(directory).filter((m) => m.version <= 2);
    assert.deepEqual(
      latencyCatalog.map((m) => m.version),
      [1, 2],
    );
    mkdirSync(join(latencyDirectory, 'sql'));
    for (const migration of latencyCatalog)
      copyFileSync(
        join(directory, 'sql', migration.name),
        join(latencyDirectory, 'sql', migration.name),
      );
    writeFileSync(join(latencyDirectory, 'manifest.json'), JSON.stringify(latencyCatalog));
    await run('apply', f.options);
    const original = Client.prototype.query;
    let inTransaction = false,
      transactionQueries = 0;
    Client.prototype.query = async function (this: Client, sql: string, ...args: unknown[]) {
      const matches = (this as unknown as { database: string }).database === f.db;
      if (matches && inTransaction) {
        transactionQueries++;
        await new Promise((resolve) => setTimeout(resolve, 130));
      }
      const result = await (
        original as unknown as (this: Client, sql: string, ...args: unknown[]) => Promise<unknown>
      ).call(this, sql, ...args);
      if (matches && sql === 'BEGIN') inTransaction = true;
      if (matches && (sql === 'COMMIT' || sql === 'ROLLBACK')) inTransaction = false;
      return result;
    } as typeof Client.prototype.query;
    let result;
    try {
      result = await run('apply', { ...f.options, directory: latencyDirectory });
    } finally {
      Client.prototype.query = original;
    }
    assert.deepEqual(result.applied, [2]);
    assert.equal(result.transactionOutcome, 'committed');
    assert.ok(result.timings.transactionMs! < 15000);
    assert.ok(result.timings.preparationMs! < 15000);
    assert.ok(transactionQueries < 30);
    assert.ok(result.timings.phases.some((p) => p.stage === 'validate_runtime'));
    assert.ok(result.timings.beginConfirmedAt);
    assert.ok(result.timings.commitConfirmedAt);
  },
);

test(
  'original SQLSTATE and timing survive rollback without leaking server messages',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    await run('apply', f.options);
    const opts = {
      ...f.options,
      directory: evolved(
        'ALTER TABLE public.projects ADD COLUMN failed_probe text; SELECT 1/0; -- PRIVATE_DIAGNOSTIC_PAYLOAD',
      ),
    };
    await assert.rejects(run('apply', opts), (error: unknown) => {
      const e = error as MigrationError;
      assert.equal(e.outcome, 'migration_rolled_back');
      assert.equal(e.transactionOutcome, 'rolled_back');
      assert.equal(e.diagnostic?.sqlState, '22012');
      assert.equal(e.diagnostic?.errorType, 'DatabaseError');
      assert.equal(e.diagnostic?.stage, 'migration_sql');
      assert.equal(e.closeConfirmed, true);
      assert.equal(e.transportError, undefined);
      assert.ok(e.timings?.beginDispatchedAt);
      assert.ok(e.timings);
      assert.ok(e.timings.preparationMs !== undefined && e.timings.preparationMs >= 0);
      assert.equal(e.timings?.commitDispatchedAt, undefined);
      assert.equal(JSON.stringify(e).includes('PRIVATE_DIAGNOSTIC_PAYLOAD'), false);
      return true;
    });
    const audit = readFileSync(opts.auditFile, 'utf8');
    assert.equal(audit.includes('PRIVATE_DIAGNOSTIC_PAYLOAD'), false);
    assert.match(audit, /operation_failed/);
  },
);

test('confirmed commit and failed close remain separate', { skip: !enabled }, async () => {
  const f = await fixture();
  const original = Client.prototype.end;
  let injected = false;
  Client.prototype.end = async function (this: Client) {
    await (original as unknown as (this: Client) => Promise<void>).call(this);
    if (!injected && (this as unknown as { database: string }).database === f.db) {
      injected = true;
      throw new Error('PRIVATE_CLOSE_PAYLOAD');
    }
  } as typeof Client.prototype.end;
  let result;
  try {
    result = await run('apply', f.options);
  } finally {
    Client.prototype.end = original;
  }
  assert.equal(injected, true);
  assert.equal(result.outcome, 'committed');
  assert.equal(result.transactionOutcome, 'committed');
  assert.equal(result.closeConfirmed, false);
  assert.equal(result.closeError?.stage, 'close');
  assert.equal(JSON.stringify(result).includes('PRIVATE_CLOSE_PAYLOAD'), false);
});

test(
  'absent migration 2 after lost COMMIT stays unknown and blocked after observing migration 1',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    await run('apply', f.options);
    const sockets = new Set<Socket>();
    let dropped = false;
    const proxy = createServer((peer) => {
      const backend = connect({ host: '127.0.0.1', port: 55490 });
      sockets.add(peer);
      sockets.add(backend);
      let input = Buffer.alloc(0);
      peer.on('data', (b) => {
        input = Buffer.concat([input, typeof b === 'string' ? Buffer.from(b) : b]);
        if (!dropped && input.includes(Buffer.from('COMMIT\0'))) {
          dropped = true;
          peer.destroy();
          backend.destroy();
        } else backend.write(b);
      });
      backend.on('data', (b) => peer.write(b));
      peer.on('error', () => {});
      backend.on('error', () => peer.destroy());
      peer.on('close', () => backend.destroy());
      backend.on('close', () => peer.destroy());
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const opts = {
      ...f.options,
      directory,
      connection: { ...f.options.connection, port: (proxy.address() as { port: number }).port },
    };
    try {
      await assert.rejects(run('apply', opts), (error: unknown) => {
        const e = error as MigrationError;
        assert.equal(e.outcome, 'commit_unknown');
        assert.equal(e.transactionOutcome, 'unknown');
        assert.equal(e.diagnostic?.stage, 'commit');
        assert.equal(e.rollbackError, undefined);
        return true;
      });
      assert.ok(dropped);
      const reconciled = await run('reconcile', opts);
      assert.deepEqual(reconciled.observed, [1]);
      assert.equal(reconciled.outcome, 'observed');
      await rejected(run('apply', opts), 'reconciliation_required');
      const events = readFileSync(opts.auditFile, 'utf8')
        .trim()
        .split('\n')
        .map((s) => JSON.parse(s));
      assert.ok(events.some((e) => e.event === 'reconciled_absent' && e.version === 2));
      assert.equal(
        events.some((e) => e.event === 'rollback_confirmed' && e.version === 2),
        false,
      );
      assert.equal(
        events.filter((e) => e.event === 'transaction_dispatch' && e.version === 2).length,
        1,
      );
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        proxy.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);

test(
  'batched ACL query rejects real MAINTAIN, column and delegation privileges',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    await run('apply', { ...f.options, directory });
    const c = await client(f.options.connection);
    for (const [grant, revoke, failure] of [
      [
        'GRANT MAINTAIN ON public.projects TO ',
        'REVOKE MAINTAIN ON public.projects FROM ',
        'unsafe_runtime_acl',
      ],
      [
        'GRANT SELECT(version) ON is488_migrations.versions TO ',
        'REVOKE SELECT(version) ON is488_migrations.versions FROM ',
        'unsafe_column_acl',
      ],
      [
        'GRANT UPDATE(title) ON public.projects TO ',
        'REVOKE UPDATE(title) ON public.projects FROM ',
        'unsafe_column_grant_option',
      ],
    ]) {
      await c.query(
        grant + f.runtime + (failure === 'unsafe_column_grant_option' ? ' WITH GRANT OPTION' : ''),
      );
      await rejected(run('plan', { ...f.options, directory }), failure);
      await c.query(revoke + f.runtime);
    }
    assert.equal((await run('plan', { ...f.options, directory })).outcome, 'planned');
  },
);

test(
  'server transaction timeout retains original SQLSTATE separately from rollback and close',
  { skip: !enabled },
  async () => {
    const f = await fixture();
    await run('apply', f.options);
    const original = Client.prototype.query;
    let inTransaction = false;
    Client.prototype.query = async function (this: Client, sql: string, ...args: unknown[]) {
      const matches = (this as unknown as { database: string }).database === f.db;
      if (matches && inTransaction) await new Promise((resolve) => setTimeout(resolve, 1100));
      const result = await (
        original as unknown as (this: Client, sql: string, ...args: unknown[]) => Promise<unknown>
      ).call(this, sql, ...args);
      if (matches && sql === 'BEGIN') inTransaction = true;
      if (matches && (sql === 'COMMIT' || sql === 'ROLLBACK')) inTransaction = false;
      return result;
    } as typeof Client.prototype.query;
    try {
      await assert.rejects(run('apply', { ...f.options, directory }), (error: unknown) => {
        const e = error as MigrationError;
        assert.equal(e.sessionError?.sqlState, '25P04');
        assert.equal(e.sessionError?.errorType, 'DatabaseError');
        assert.equal(e.transactionOutcome, 'unknown');
        assert.ok(e.rollbackError);
        assert.equal(e.closeConfirmed, true);
        assert.ok(e.timings!.transactionMs! >= 15000);
        return true;
      });
    } finally {
      Client.prototype.query = original;
    }
    const reconciled = await run('reconcile', { ...f.options, directory });
    assert.deepEqual(reconciled.observed, [1]);
    await rejected(run('apply', { ...f.options, directory }), 'reconciliation_required');
  },
);
