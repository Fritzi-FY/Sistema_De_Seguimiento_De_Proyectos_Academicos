import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { assertSqlTestConfiguration } from './sql-ci.js';

export function notificationSqlTestTarget(enabled: boolean, restart = false) {
  const host = process.env.IS488_SQL_HOST ?? '';
  const port = Number(process.env.IS488_SQL_PORT);
  const directory = process.env.IS488_SQL_DATA_DIR ?? process.env.IS488_MIGRATION_TEST_DIR ?? '';
  const pgCtl = process.env.IS488_SQL_PG_CTL ?? '';
  if (enabled) {
    assert.notEqual(
      process.env.IS488_CI_SQL,
      '1',
      'Notification SQL suites require a local profile',
    );
    assertSqlTestConfiguration(true);
    assert.ok(host.trim(), 'IS488_SQL_HOST is required when notification SQL tests are enabled');
    assert.ok(isAbsolute(directory), 'SQL data directory must be an explicit absolute path');
    if (restart) {
      assert.ok(
        isAbsolute(pgCtl),
        'IS488_SQL_PG_CTL must be an explicit absolute executable path for restart tests',
      );
      assert.ok(statSync(pgCtl).isFile(), 'IS488_SQL_PG_CTL must name an existing file');
    }
  }
  return { host, port, directory, pgCtl };
}
