import process from 'node:process';
import console from 'node:console';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { createSpikeAuth, createSpikeOptions } from './auth.ts';
import { getMigrations } from 'better-auth/db/migration';
import { hashPassword } from 'better-auth/crypto';
import { run } from '../../migrations/runner.ts';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const stateDir = join(root, '.local-dev/auth-spike');
const data = join(stateDir, 'pgdata');
const stateFile = join(stateDir, 'state.json');
const marker = join(stateDir, 'target.json');
const pgBin = 'C:/Program Files/PostgreSQL/18/bin';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { Client, Pool } = require('pg');
const sqlRole = (name) => {
  assert.match(name, /^[a-z_][a-z0-9_]{0,62}$/);
  return '"' + name + '"';
};
function command(file, args) {
  const r = spawnSync(file, args, {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 180000,
    ...(file.endsWith('pg_ctl.exe') ? { stdio: 'ignore' } : {}),
  });
  if (r.status !== 0) throw new Error('Local command failed: ' + file);
  return r.stdout;
}
async function connect(config) {
  const client = new Client({ ...config, connectionTimeoutMillis: 3000 });
  await client.connect();
  return client;
}
async function prepare() {
  assert.equal(process.platform, 'win32');
  assert.equal(resolve(root).toLowerCase(), 'c:\\users\\fritz\\is488-identity-access');
  if (existsSync(stateFile)) {
    console.log('Spike already provisioned; no mutations repeated.');
    return;
  }
  if (existsSync(marker))
    throw new Error('Previous preparation exists: inspect its stage before any mutation retry.');
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(
    marker,
    JSON.stringify({
      scope: 'synthetic-auth-spike',
      data,
      port: 55510,
      stage: 'preparation-started',
    }),
  );
  const adminPassword = randomBytes(32).toString('hex'),
    migratorPassword = randomBytes(32).toString('hex'),
    runtimePassword = randomBytes(32).toString('hex');
  const adminConfig = {
    host: '127.0.0.1',
    port: 55510,
    database: 'postgres',
    user: 'is488_auth_spike_admin',
    password: adminPassword,
  };
  writeFileSync(
    join(stateDir, 'bootstrap.json'),
    JSON.stringify({ adminConfig, migratorPassword, runtimePassword }),
  );
  const temporaryPassword = join(stateDir, 'init-password.txt');
  writeFileSync(temporaryPassword, adminPassword + '\n');
  try {
    command(join(pgBin, 'initdb.exe'), [
      '-D',
      data,
      '-U',
      adminConfig.user,
      '--auth-host=scram-sha-256',
      '--auth-local=scram-sha-256',
      '--encoding=UTF8',
      '--no-locale',
      '--pwfile=' + temporaryPassword,
    ]);
  } finally {
    unlinkSync(temporaryPassword);
  }
  writeFileSync(
    join(data, 'postgresql.auto.conf'),
    "listen_addresses = '127.0.0.1'\nport = 55510\n",
  );
  command(join(pgBin, 'pg_ctl.exe'), [
    'start',
    '-D',
    data,
    '-l',
    join(stateDir, 'postgres.log'),
    '-w',
    '-t',
    '120',
  ]);
  const admin = await connect(adminConfig);
  const migrator = 'is488_auth_spike_migrator',
    runtime = 'is488_auth_spike_runtime',
    database = 'is488_auth_spike';
  const migrationConfig = { ...adminConfig, database, user: migrator, password: migratorPassword };
  const runtimeConfig = { ...adminConfig, database, user: runtime, password: runtimePassword };
  try {
    const actual = (
      await admin.query(
        "SELECT current_user AS actor,inet_server_port() AS port,current_setting('data_directory') AS directory",
      )
    ).rows[0];
    assert.equal(actual.actor, adminConfig.user);
    assert.equal(actual.port, 55510);
    assert.equal(resolve(actual.directory).toLowerCase(), resolve(data).toLowerCase());
    for (const [role, password] of [
      [migrator, migratorPassword],
      [runtime, runtimePassword],
    ])
      await admin.query(
        'CREATE ROLE ' +
          sqlRole(role) +
          " LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '" +
          password +
          "'",
      );
    await admin.query('CREATE DATABASE ' + sqlRole(database) + ' OWNER ' + sqlRole(migrator));
    await admin.query(
      'REVOKE TEMPORARY ON DATABASE ' + sqlRole(database) + ' FROM PUBLIC,' + sqlRole(runtime),
    );
    const pool = new Pool(migrationConfig);
    const secret = randomBytes(48).toString('hex'),
      origin = 'https://localhost:8791';
    try {
      const plan = await getMigrations(createSpikeOptions(pool, { secret, origin }));
      assert.equal(plan.unsafeChanges.length, 0);
      const generated = await plan.compileMigrations();
      const prefix = 'create schema if not exists "public";';
      assert.ok(generated.startsWith(prefix), 'Expected reviewed public-schema prefix');
      writeFileSync(join(stateDir, 'better-auth-generated.sql'), generated);
      const compiled = generated.slice(prefix.length);
      const schema =
        compiled +
        `\nCREATE TABLE public.spike_role_grants (user_id uuid PRIMARY KEY REFERENCES public.spike_auth_user(id), role text NOT NULL CHECK(role IN ('student','teacher','admin')), active boolean NOT NULL, granted_by text NOT NULL);\nCREATE TABLE public.spike_auth_mail (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, url text NOT NULL);\n`;
      const catalog = join(stateDir, 'catalog');
      mkdirSync(join(catalog, 'sql'), { recursive: true });
      const canonical = join(root, 'apps/api/migrations');
      const manifest = JSON.parse(readFileSync(join(canonical, 'manifest.json'), 'utf8'));
      for (const migration of manifest)
        copyFileSync(join(canonical, 'sql', migration.name), join(catalog, 'sql', migration.name));
      const name = '0005_identity_access_spike.sql';
      writeFileSync(join(catalog, 'sql', name), schema);
      manifest.push({
        version: 5,
        name,
        sha256: createHash('sha256').update(schema).digest('hex'),
      });
      writeFileSync(join(catalog, 'manifest.json'), JSON.stringify(manifest, null, 2));
      const migration = await run('apply', {
        connection: migrationConfig,
        runtimeRole: runtime,
        directory: catalog,
        auditFile: join(stateDir, 'migrations.jsonl'),
      });
      assert.equal(migration.transactionOutcome, 'committed');
      assert.deepEqual(migration.applied, [1, 2, 3, 4, 5]);
      for (const table of [
        'spike_auth_user',
        'spike_auth_account',
        'spike_auth_session',
        'spike_auth_verification',
        'spike_auth_rate_limit',
      ])
        await pool.query(
          'GRANT SELECT,INSERT,UPDATE,DELETE ON public.' + table + ' TO ' + sqlRole(runtime),
        );
      await pool.query('GRANT SELECT ON public.spike_role_grants TO ' + sqlRole(runtime));
      await pool.query('GRANT INSERT ON public.spike_auth_mail TO ' + sqlRole(runtime));
      const auth = createSpikeAuth(pool, { secret, origin });
      const context = await auth.$context;
      const fixtures = {};
      for (const [key, email, role] of [
        ['student', 'student@synthetic.example.test', 'student'],
        ['teacher', 'teacher@synthetic.example.test', 'teacher'],
      ]) {
        const password = randomBytes(24).toString('hex');
        const user = await context.internalAdapter.createUser(
          { name: 'Synthetic ' + key, email, emailVerified: false },
          { method: 'admin' },
        );
        assert.match(user.id, /^[a-f0-9-]{36}$/);
        await context.internalAdapter.linkAccount({
          userId: user.id,
          providerId: 'credential',
          accountId: user.id,
          password: await hashPassword(password),
        });
        await pool.query('INSERT INTO public.spike_role_grants VALUES ($1,$2,true,$3)', [
          user.id,
          role,
          'explicit-local-spike-operator',
        ]);
        fixtures[key] = { userId: user.id, email, password, role };
      }
      const project = randomUUID(),
        membership = randomUUID();
      await pool.query(
        `INSERT INTO public.projects VALUES ($1,'Synthetic authentication project',NULL,'IS488','active','2026-01-01','2026-12-31',$2,'2026-01-01','2026-01-01')`,
        [project, fixtures.student.userId],
      );
      await pool.query(
        `INSERT INTO public.project_memberships VALUES ($1,$2,$3,'owner','active','2026-01-01','2026-01-01',NULL)`,
        [membership, project, fixtures.student.userId],
      );
      writeFileSync(
        stateFile,
        JSON.stringify(
          { adminConfig, migrationConfig, runtimeConfig, secret, origin, fixtures, project, data },
          null,
          2,
        ),
      );
      writeFileSync(
        join(stateDir, '.dev.vars'),
        'SPIKE_DB_PASSWORD=' + runtimePassword + '\nSPIKE_SECRET=' + secret + '\n',
      );
      writeFileSync(
        join(stateDir, 'wrangler.jsonc'),
        JSON.stringify(
          {
            name: 'is488-auth-local-spike',
            main: '../../apps/api/spikes/identity-access/worker.ts',
            compatibility_date: '2024-09-23',
            compatibility_flags: ['nodejs_compat'],
            workers_dev: false,
            preview_urls: false,
            vars: { SPIKE_ORIGIN: origin },
            assets: { directory: './build/web', binding: 'ASSETS', run_worker_first: true },
          },
          null,
          2,
        ),
      );
      writeFileSync(
        marker,
        JSON.stringify({
          scope: 'synthetic-auth-spike',
          data,
          port: 55510,
          stage: 'provisioned',
          library: 'better-auth@1.7.14',
        }),
      );
      console.log(
        'Exclusive synthetic cluster provisioned; catalog 0001-0005 committed; two local operator-approved UUID accounts. Credentials remain in ignored local state.',
      );
    } finally {
      await pool.end();
    }
  } finally {
    await admin.end();
  }
}
await prepare();
