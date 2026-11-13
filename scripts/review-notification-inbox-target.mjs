import assert from 'node:assert/strict';
import process from 'node:process';
import { isAbsolute } from 'node:path';
import { URL } from 'node:url';
import { assertSqlTestConfiguration } from '../apps/api/src/testing/sql-ci.ts';

export function inboxE2eSqlTarget() {
  assert.notEqual(
    process.env.IS488_CI_SQL,
    '1',
    'Inbox E2E requires an explicit local SQL profile',
  );
  assertSqlTestConfiguration(true);
  const host = process.env.IS488_SQL_HOST ?? '';
  assert.ok(host.trim(), 'IS488_SQL_HOST is required for inbox E2E');
  assert.ok(['127.0.0.1', '::1'].includes(host), 'IS488_SQL_HOST must be a loopback address');
  const directory = process.env.IS488_SQL_DATA_DIR ?? process.env.IS488_MIGRATION_TEST_DIR ?? '';
  assert.ok(isAbsolute(directory), 'SQL data directory must be an explicit absolute path');
  return Object.freeze({ host, port: Number(process.env.IS488_SQL_PORT), directory });
}

export function inboxE2eDatabaseUrl(target, user, database) {
  const host = target.host === '::1' ? '[::1]' : target.host;
  const url = new URL(`postgresql://${host}`);
  url.port = String(target.port);
  url.username = user;
  url.pathname = '/' + database;
  return url.href;
}
