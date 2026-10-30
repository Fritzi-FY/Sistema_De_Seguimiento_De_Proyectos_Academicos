import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { run } from '../migrations/runner.ts';
import {
  ciSqlProfile,
  ciAdminConnection,
  ciRolePasswordClause,
  assertCiSqlTarget,
} from '../src/testing/sql-ci.ts';

const ci = ciSqlProfile();
if (!ci) throw new Error('CI-only preparation requires explicit profile');
const evidence = process.env.IS488_CI_EVIDENCE;
if (!evidence) throw new Error('CI evidence directory required');
mkdirSync(evidence, { recursive: true });
const admin = new Client(ciAdminConnection());
await admin.connect();
try {
  await assertCiSqlTarget(admin, false);
  await admin.query('CREATE DATABASE is488_ci_control');
  await admin.query("COMMENT ON DATABASE is488_ci_control IS 'is488-ci:" + ci.run + "'");
  for (const role of [ci.migrator, ci.runtime])
    await admin.query(
      'CREATE ROLE ' +
        role +
        ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT' +
        ciRolePasswordClause(),
    );
  await admin.query('CREATE DATABASE ' + ci.database + ' OWNER ' + ci.migrator);
  await admin.query('REVOKE TEMPORARY ON DATABASE ' + ci.database + ' FROM PUBLIC,' + ci.runtime);
  const connection = {
    ...ciAdminConnection(),
    database: ci.database,
    user: ci.migrator,
    password: ci.rolePassword,
  };
  const result = await run('apply', {
    connection,
    runtimeRole: ci.runtime,
    auditFile: join(evidence, 'kanban-migrations.jsonl'),
  });
  if (result.transactionOutcome !== 'committed' || result.applied.join(',') !== '1,2,3,4')
    throw new Error('Full migration catalog was not confirmed');
  const seed = new Client(connection);
  await seed.connect();
  try {
    await seed.query('BEGIN');
    const project = randomUUID();
    await seed.query(
      `INSERT INTO public.projects VALUES ($1,'CI preserved synthetic project',NULL,'IS488','active','2026-01-01','2026-12-31','ci-seed-owner','2026-01-01','2026-01-01')`,
      [project],
    );
    await seed.query(
      `INSERT INTO public.project_memberships VALUES ($1,$2,'ci-seed-owner','owner','active','2026-01-01','2026-01-01',NULL)`,
      [randomUUID(), project],
    );
    await seed.query('COMMIT');
  } finally {
    await seed.end();
  }
  console.log(
    'Fresh CI service verified; migrations 0001-0004 and synthetic preservation seed confirmed.',
  );
} finally {
  await admin.end();
}
