import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'pg';
import {
  ciSqlProfile,
  ciAdminConnection,
  ciRolePasswordClause,
  assertCiSqlTarget,
} from './sql-ci.js';

afterEach(() => vi.unstubAllEnvs());
function profile() {
  vi.stubEnv('IS488_CI_SQL', '1');
  vi.stubEnv('CI', 'true');
  vi.stubEnv('GITHUB_ACTIONS', 'true');
  vi.stubEnv('IS488_CI_RUN', '123-1');
  vi.stubEnv('IS488_CI_ROLE_PASSWORD', 'a'.repeat(64));
  vi.stubEnv('IS488_CI_ADMIN_PASSWORD', 'synthetic-unit-only');
}
describe('CI SQL target guard (simulated, no database)', () => {
  it('keeps local defaults unless explicitly enabled and rejects incomplete CI identity', () => {
    vi.stubEnv('IS488_CI_SQL', '0');
    expect(ciSqlProfile()).toBeUndefined();
    expect(ciAdminConnection()).toBeUndefined();
    expect(ciRolePasswordClause()).toBe('');
    profile();
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    expect(() => ciSqlProfile()).toThrow();
    profile();
    vi.stubEnv('IS488_CI_ROLE_PASSWORD', '');
    expect(() => ciSqlProfile()).toThrow();
  });
  it('binds the service identity, directory, version, port and marker to the current run', async () => {
    profile();
    const row = {
      actor: 'is488_ci_admin',
      directory: '/var/lib/postgresql/18/ci',
      version: 180000,
      port: 5432,
      address: '172.18.0.2',
      marker: 'is488-ci:123-1',
    };
    const client = (overrides = {}) =>
      ({ query: async () => ({ rows: [{ ...row, ...overrides }] }) }) as unknown as Client;
    await expect(assertCiSqlTarget(client())).resolves.toBeUndefined();
    for (const invalid of [
      { actor: 'other' },
      { directory: '/existing/database' },
      { version: 170000 },
      { port: 55490 },
      { address: '0.0.0.0' },
      { marker: 'is488-ci:122-1' },
    ])
      await expect(assertCiSqlTarget(client(invalid))).rejects.toThrow();
    await expect(assertCiSqlTarget(client(), false)).rejects.toThrow();
    await expect(assertCiSqlTarget(client({ marker: null }), false)).resolves.toBeUndefined();
    expect(ciAdminConnection()).toMatchObject({
      host: '127.0.0.1',
      port: 55490,
      user: 'is488_ci_admin',
    });
  });
});
