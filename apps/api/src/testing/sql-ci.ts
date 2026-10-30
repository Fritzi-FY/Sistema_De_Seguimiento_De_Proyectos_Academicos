import assert from 'node:assert/strict';
import type { Client, ClientConfig } from 'pg';

export function ciSqlProfile() {
  if (process.env.IS488_CI_SQL !== '1') return undefined;
  assert.equal(process.env.CI, 'true');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const run = process.env.IS488_CI_RUN ?? '';
  assert.match(run, /^\d+-\d+$/);
  const rolePassword = process.env.IS488_CI_ROLE_PASSWORD ?? '';
  assert.match(rolePassword, /^[a-f0-9]{64}$/);
  const adminPassword = process.env.IS488_CI_ADMIN_PASSWORD;
  assert.ok(adminPassword);
  return {
    run,
    admin: 'is488_ci_admin',
    adminPassword,
    rolePassword,
    database: 'is488_ci_kanban',
    migrator: 'is488_ci_kanban_migrator',
    runtime: 'is488_ci_kanban_runtime',
    directory: '/var/lib/postgresql/18/ci',
  };
}

export function ciAdminConnection(port = 55490): ClientConfig | undefined {
  const ci = ciSqlProfile();
  return (
    ci && {
      host: '127.0.0.1',
      port,
      user: ci.admin,
      database: 'postgres',
      password: ci.adminPassword,
      connectionTimeoutMillis: 3000,
    }
  );
}

export function ciRolePasswordClause() {
  const ci = ciSqlProfile();
  return ci ? " PASSWORD '" + ci.rolePassword + "'" : '';
}

export async function assertCiSqlTarget(client: Client, requireMarker = true) {
  const ci = ciSqlProfile();
  assert.ok(ci, 'Explicit CI SQL profile required');
  const row = (
    await client.query(`SELECT current_user AS actor,
    current_setting('data_directory') AS directory,
    current_setting('server_version_num')::int AS version,
    inet_server_addr()::text AS address, inet_server_port() AS port,
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname='is488_ci_control') AS marker`)
  ).rows[0];
  assert.equal(row.actor, ci.admin);
  assert.equal(row.directory, ci.directory);
  assert.ok(row.version >= 180000 && row.version < 190000);
  assert.equal(row.port, 5432);
  assert.ok(row.address && !['0.0.0.0', '::'].includes(row.address));
  if (requireMarker) assert.equal(row.marker, 'is488-ci:' + ci.run);
  else assert.equal(row.marker, null, 'Service must be fresh for this job');
}
