import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { notificationSqlTestTarget } from './notification-sql-test-config.js';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('IS488_CI_SQL', '0');
  vi.stubEnv('IS488_SQL_HOST', '127.0.0.2');
  vi.stubEnv('IS488_SQL_PORT', '60001');
  vi.stubEnv('IS488_SQL_DATA_DIR', resolve('synthetic-test-cluster'));
  vi.stubEnv('IS488_MIGRATION_TEST_DIR', undefined);
  vi.stubEnv('IS488_SQL_PG_CTL', process.execPath);
  vi.stubEnv('IS488_NOTIFICATION_SQL_TEST', '1');
  vi.stubEnv('IS488_NOTIFICATION_HTTP_SQL_TEST', '1');
  vi.stubEnv('IS488_INBOX_SQL_TEST', '1');
  vi.stubEnv('IS488_INBOX_HTTP_SQL_TEST', '1');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Notification SQL test configuration without database access', () => {
  const suites = [
    {
      name: 'adapter',
      load: () => import('../infrastructure/postgresql/internal-review-notification.sql.test.js'),
    },
    {
      name: 'HTTP restart',
      load: () => import('../infrastructure/postgresql/review-notification-http.sql.test.js'),
    },
    {
      name: 'inbox reader',
      load: () => import('../infrastructure/postgresql/review-notification-reader.sql.test.js'),
    },
    {
      name: 'inbox HTTP',
      load: () => import('../infrastructure/postgresql/review-notification-inbox-http.sql.test.js'),
    },
  ];
  for (const suite of suites) {
    it.each([
      ['IS488_SQL_HOST', '', 'IS488_SQL_HOST'],
      ['IS488_SQL_PORT', '', 'IS488_SQL_PORT'],
      ['IS488_SQL_PORT', '65536', 'IS488_SQL_PORT'],
      ['IS488_SQL_DATA_DIR', '', 'IS488_SQL_DATA_DIR'],
      ['IS488_SQL_DATA_DIR', 'relative-cluster', 'absolute path'],
    ])(`${suite.name} rejects %s=%s before connecting`, async (variable, value, message) => {
      vi.stubEnv(variable, value);
      const connect = vi.spyOn(Client.prototype, 'connect');
      await expect(suite.load()).rejects.toThrow(message);
      expect(connect).not.toHaveBeenCalled();
    });
  }

  it.each(['', 'pg_ctl', resolve('nonexistent-pg_ctl')])(
    'HTTP restart rejects missing, relative or nonexistent executable: %s',
    async (executable) => {
      vi.stubEnv('IS488_SQL_PG_CTL', executable);
      const connect = vi.spyOn(Client.prototype, 'connect');
      await expect(suites[1]!.load()).rejects.toThrow();
      expect(connect).not.toHaveBeenCalled();
    },
  );

  it('uses only explicit session values, including the existing directory alias', () => {
    const expected = {
      host: '127.0.0.2',
      port: 60001,
      directory: resolve('synthetic-test-cluster'),
      pgCtl: process.execPath,
    };
    expect(notificationSqlTestTarget(true, true)).toEqual(expected);
    vi.stubEnv('IS488_SQL_DATA_DIR', undefined);
    vi.stubEnv('IS488_MIGRATION_TEST_DIR', expected.directory);
    expect(notificationSqlTestTarget(true, true)).toEqual(expected);
    vi.stubEnv('IS488_SQL_PG_CTL', undefined);
    expect(notificationSqlTestTarget(true).pgCtl).toBe('');
  });

  it('does not require local configuration when suites are disabled', () => {
    for (const variable of [
      'IS488_SQL_HOST',
      'IS488_SQL_PORT',
      'IS488_SQL_DATA_DIR',
      'IS488_SQL_PG_CTL',
    ])
      vi.stubEnv(variable, undefined);
    expect(() => notificationSqlTestTarget(false, true)).not.toThrow();
  });
});
