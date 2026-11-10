import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './runner.ts';
const enabled = process.env.IS488_TEACHER_SQL_TEST === '1';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8')) as {
  version: number;
}[];
const expectedCatalogVersions = manifest.map((m) => m.version).sort((a, b) => a - b);
if (enabled) {
  if (
    !/^\d+$/.test(process.env.IS488_SQL_PORT ?? '') ||
    Number(process.env.IS488_SQL_PORT) < 1 ||
    Number(process.env.IS488_SQL_PORT) > 65535
  )
    throw new Error('IS488_SQL_PORT is required when IS488_TEACHER_SQL_TEST=1');
  if (!(process.env.IS488_MIGRATION_TEST_DIR ?? process.env.IS488_SQL_DATA_DIR)?.trim())
    throw new Error(
      'IS488_MIGRATION_TEST_DIR or IS488_SQL_DATA_DIR is required when IS488_TEACHER_SQL_TEST=1',
    );
}
const base = {
  host: process.env.IS488_SQL_HOST ?? '127.0.0.1',
  port: Number(process.env.IS488_SQL_PORT),
  user: process.env.IS488_MIGRATION_ADMIN_USER ?? 'is488_migration_admin',
  database: 'postgres',
  connectionTimeoutMillis: 2000,
};
const normalize = (d: string) => d.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
async function fixture(
  work: (f: {
    migrator: Client;
    runtime: Client;
    options: Parameters<typeof run>[1];
    temp: string;
  }) => Promise<void>,
) {
  const expected = process.env.IS488_MIGRATION_TEST_DIR ?? process.env.IS488_SQL_DATA_DIR;
  assert.ok(expected, 'IS488_MIGRATION_TEST_DIR or IS488_SQL_DATA_DIR must be set');
  const admin = new Client(base);
  await admin.connect();
  const id = randomUUID().replaceAll('-', ''),
    db = 'is488_scope_' + id,
    m = 'is488_sm_' + id,
    r = 'is488_sr_' + id;
  let madeM = false,
    madeR = false,
    madeDb = false;
  let migrator: Client | undefined, runtime: Client | undefined;
  const temp = mkdtempSync(join(tmpdir(), 'is488-scope-fixtures-'));
  try {
    const guard = (
      await admin.query(
        "SELECT current_user AS actor,current_setting('data_directory') AS dir,inet_server_port() AS port",
      )
    ).rows[0];
    assert.equal(guard.actor, base.user);
    assert.equal(guard.port, base.port);
    assert.equal(normalize(guard.dir), normalize(expected));
    await admin.query('CREATE ROLE ' + m + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
    madeM = true;
    await admin.query('CREATE ROLE ' + r + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT');
    madeR = true;
    await admin.query('CREATE DATABASE ' + db + ' OWNER ' + m);
    madeDb = true;
    await admin.query('REVOKE TEMPORARY ON DATABASE ' + db + ' FROM PUBLIC,' + r);
    migrator = new Client({ ...base, database: db, user: m });
    runtime = new Client({ ...base, database: db, user: r });
    await migrator.connect();
    await runtime.connect();
    const options = {
      connection: { ...base, database: db, user: m },
      runtimeRole: r,
      auditFile: join(temp, 'audit.jsonl'),
    };
    await work({ migrator, runtime, options, temp });
    if (process.env.IS488_SCOPE_EVIDENCE)
      writeFileSync(
        join(process.env.IS488_SCOPE_EVIDENCE, id + '.jsonl'),
        readFileSync(options.auditFile),
      );
  } finally {
    await runtime?.end();
    await migrator?.end();
    const guard = (
      await admin.query(
        "SELECT current_user AS actor,current_setting('data_directory') AS dir,inet_server_port() AS port",
      )
    ).rows[0];
    assert.equal(guard.actor, base.user);
    assert.equal(guard.port, base.port);
    assert.equal(normalize(guard.dir), normalize(expected));
    if (madeDb) await admin.query('DROP DATABASE ' + db + ' WITH (FORCE)');
    if (madeR) await admin.query('DROP ROLE ' + r);
    if (madeM) await admin.query('DROP ROLE ' + m);
    await admin.end();
    rmSync(temp, { recursive: true });
  }
}
const insert = `INSERT INTO public.projects VALUES ('11111111-1111-4111-8111-111111111111','Synthetic scoped project',NULL,'IS488','active','2026-10-26','2026-12-31','owner','2026-10-26','2026-10-26')`;
test(
  'SQL local: fresh product catalog applies two atomic versions and runtime cannot self-assign',
  { skip: !enabled },
  async () =>
    fixture(async (f) => {
      assert.deepEqual((await run('apply', f.options)).applied, expectedCatalogVersions);
      assert.equal((await run('apply', f.options)).outcome, 'unchanged');
      await f.runtime.query(insert);
      await f.migrator.query(
        "INSERT INTO public.teacher_project_assignments VALUES ('teacher','11111111-1111-4111-8111-111111111111')",
      );
      assert.equal(
        (await f.runtime.query('SELECT * FROM public.teacher_project_assignments')).rowCount,
        1,
      );
      for (const sql of [
        "INSERT INTO public.teacher_project_assignments VALUES ('self','11111111-1111-4111-8111-111111111111')",
        "UPDATE public.teacher_project_assignments SET teacher_user_id='self'",
        'DELETE FROM public.teacher_project_assignments',
        'REINDEX TABLE public.projects',
        'SELECT * FROM is488_migrations.versions',
        'CREATE TEMP TABLE forbidden(id int)',
      ])
        await assert.rejects(
          f.runtime.query(sql),
          (e: unknown) => (e as { code: string }).code === '42501',
        );
      await assert.rejects(
        f.migrator.query(
          "INSERT INTO public.teacher_project_assignments VALUES ('teacher','11111111-1111-4111-8111-111111111111')",
        ),
        (e: unknown) => (e as { code: string }).code === '23505',
      );
      await assert.rejects(
        f.migrator.query(
          "INSERT INTO public.teacher_project_assignments VALUES ('other','22222222-2222-4222-8222-222222222222')",
        ),
        (e: unknown) => (e as { code: string }).code === '23503',
      );
    }),
);
test(
  'SQL local: additive SEC migration conserves projects and rejects effective MAINTAIN/column grants',
  { skip: !enabled },
  async () =>
    fixture(async (f) => {
      const dir = join(f.temp, 'v1');
      mkdirSync(join(dir, 'sql'), { recursive: true });
      writeFileSync(
        join(dir, 'sql/0001_initial.sql'),
        readFileSync(join(root, 'sql/0001_initial.sql')),
      );
      writeFileSync(
        join(dir, 'manifest.json'),
        JSON.stringify([JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))[0]]),
      );
      await run('apply', { ...f.options, directory: dir });
      await f.runtime.query(insert);
      assert.deepEqual(
        (await run('apply', f.options)).applied,
        expectedCatalogVersions.filter((v) => v > 1),
      );
      assert.equal(
        (await f.runtime.query('SELECT title FROM public.projects')).rows[0].title,
        'Synthetic scoped project',
      );
      await f.migrator.query('GRANT MAINTAIN ON public.projects TO ' + f.options.runtimeRole);
      await assert.rejects(run('plan', f.options));
      await f.migrator.query('REVOKE MAINTAIN ON public.projects FROM ' + f.options.runtimeRole);
      await f.migrator.query(
        'GRANT UPDATE(teacher_user_id) ON public.teacher_project_assignments TO ' +
          f.options.runtimeRole,
      );
      await assert.rejects(run('plan', f.options));
      await f.migrator.query(
        'REVOKE UPDATE(teacher_user_id) ON public.teacher_project_assignments FROM ' +
          f.options.runtimeRole,
      );
      await f.migrator.query(
        'GRANT SELECT ON public.projects TO ' + f.options.runtimeRole + ' WITH GRANT OPTION',
      );
      await assert.rejects(run('plan', f.options));
      await f.migrator.query(
        'REVOKE GRANT OPTION FOR SELECT ON public.projects FROM ' + f.options.runtimeRole,
      );
      assert.equal((await run('plan', f.options)).pending.length, 0);
    }),
);
