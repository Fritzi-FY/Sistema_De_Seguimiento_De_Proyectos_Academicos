import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client } from 'pg';
import { resolve } from 'node:path';

const entry = new URL('../../../../scripts/review-notification-inbox.e2e.mjs', import.meta.url)
  .href;
const configuration = new URL(
  '../../../../scripts/review-notification-inbox-target.mjs',
  import.meta.url,
).href;
const directory = resolve('synthetic-inbox-cluster');

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('IS488_CI_SQL', '0');
  vi.stubEnv('IS488_SQL_HOST', '127.0.0.1');
  vi.stubEnv('IS488_SQL_PORT', '60001');
  vi.stubEnv('IS488_SQL_DATA_DIR', directory);
  vi.stubEnv('IS488_MIGRATION_TEST_DIR', undefined);
  vi.stubEnv('IS488_SQL_ADMIN_USER', 'synthetic_test_admin');
  vi.stubEnv('IS488_PLAYWRIGHT_MODULE', undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('Inbox E2E entry point configuration before database or browser access', () => {
  it.each([
    ['IS488_SQL_HOST', undefined, 'IS488_SQL_HOST'],
    ['IS488_SQL_HOST', '', 'IS488_SQL_HOST'],
    ['IS488_SQL_HOST', '192.0.2.1', 'loopback'],
    ['IS488_SQL_PORT', undefined, 'IS488_SQL_PORT'],
    ['IS488_SQL_PORT', '', 'IS488_SQL_PORT'],
    ['IS488_SQL_PORT', '0', 'IS488_SQL_PORT'],
    ['IS488_SQL_PORT', '65536', 'IS488_SQL_PORT'],
    ['IS488_SQL_PORT', '60001x', 'IS488_SQL_PORT'],
    ['IS488_SQL_DATA_DIR', undefined, 'IS488_SQL_DATA_DIR'],
    ['IS488_SQL_DATA_DIR', '', 'IS488_SQL_DATA_DIR'],
    ['IS488_SQL_DATA_DIR', 'relative-cluster', 'absolute path'],
    ['IS488_SQL_ADMIN_USER', undefined, 'IS488_SQL_ADMIN_USER'],
    ['IS488_SQL_ADMIN_USER', ' ', 'IS488_SQL_ADMIN_USER'],
    ['IS488_CI_SQL', '1', 'local SQL profile'],
  ])('rejects %s=%s before connecting', async (variable, value, message) => {
    vi.stubEnv(variable!, value);
    const connect = vi.spyOn(Client.prototype, 'connect').mockImplementation(() => {
      throw new Error('Unexpected database connection');
    });
    await expect(import(entry)).rejects.toThrow(message);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each(['127.0.0.1', '::1'])('uses explicit destination %s in the API URL', async (host) => {
    vi.stubEnv('IS488_SQL_HOST', host);
    const { inboxE2eSqlTarget, inboxE2eDatabaseUrl } = await import(configuration);
    const target = inboxE2eSqlTarget();
    expect(target).toEqual({ host, port: 60001, directory });
    expect(Object.isFrozen(target)).toBe(true);
    const url = new URL(inboxE2eDatabaseUrl(target, 'synthetic_runtime', 'synthetic_inbox'));
    expect(url.hostname).toBe(host === '::1' ? '[::1]' : host);
    expect(url.port).toBe('60001');
    expect(url.username).toBe('synthetic_runtime');
    expect(url.pathname).toBe('/synthetic_inbox');
  });

  it('accepts the existing explicit directory alias without a default', async () => {
    vi.stubEnv('IS488_SQL_DATA_DIR', undefined);
    vi.stubEnv('IS488_MIGRATION_TEST_DIR', directory);
    const { inboxE2eSqlTarget } = await import(configuration);
    expect(inboxE2eSqlTarget().directory).toBe(directory);
  });
});
