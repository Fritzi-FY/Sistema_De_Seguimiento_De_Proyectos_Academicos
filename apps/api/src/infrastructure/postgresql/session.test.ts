import { beforeEach, describe, expect, it, vi } from 'vitest';
const wire = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn(), end: vi.fn(), on: vi.fn() }));
vi.mock('pg', () => ({
  Client: class {
    connect = wire.connect;
    query = wire.query;
    end = wire.end;
    on = wire.on;
  },
}));
import { SqlSession } from './session.js';
import { createApp } from '../http/app.js';

beforeEach(() => {
  vi.resetAllMocks();
  wire.connect.mockResolvedValue(undefined);
  wire.query.mockResolvedValue({ rows: [], rowCount: 0 });
  wire.end.mockResolvedValue(undefined);
});
describe('SQL session failure boundaries (simulated)', () => {
  it('one lazy connection for BEGIN, both writes and COMMIT', async () => {
    const s = new SqlSession({});
    await s.transaction(async () => {
      await s.query('INSERT project');
      await s.query('INSERT owner');
    });
    expect(wire.connect).toHaveBeenCalledTimes(1);
    expect(wire.query.mock.calls.map((c) => c[0])).toEqual([
      'BEGIN',
      'SET LOCAL search_path TO pg_catalog, public',
      "SET LOCAL statement_timeout = '5s'",
      "SET LOCAL lock_timeout = '2s'",
      "SET LOCAL transaction_timeout = '10s'",
      'INSERT project',
      'INSERT owner',
      'COMMIT',
    ]);
    expect(await s.close()).toBe(true);
  });
  it('confirmed rollback differs from unconfirmed rollback', async () => {
    for (const rollbackFails of [false, true]) {
      wire.query.mockImplementation(async (text: string) => {
        if (text === 'INSERT owner' || (rollbackFails && text === 'ROLLBACK'))
          throw new Error('private failure');
        return { rows: [] };
      });
      const s = new SqlSession({});
      await expect(
        s.transaction(async () => {
          await s.query('INSERT owner');
        }),
      ).rejects.toMatchObject({ outcome: rollbackFails ? 'unknown' : 'rolled_back' });
      await s.close();
    }
  });
  it('unknown COMMIT never sends ROLLBACK or retries', async () => {
    wire.query.mockImplementation(async (text: string) => {
      if (text === 'COMMIT') throw new Error('lost reply');
      return { rows: [] };
    });
    const s = new SqlSession({});
    await expect(
      s.transaction(async () => {
        await s.query('INSERT');
      }),
    ).rejects.toMatchObject({ outcome: 'unknown' });
    expect(wire.query.mock.calls.filter((c) => c[0] === 'COMMIT')).toHaveLength(1);
    expect(wire.query.mock.calls.filter((c) => c[0] === 'ROLLBACK')).toHaveLength(0);
    await s.close();
  });
  it('failed close preserves committed outcome and reports close separately', async () => {
    const s = new SqlSession({});
    await expect(
      s.transaction(async () => {
        await s.query('INSERT');
      }),
    ).resolves.toBeUndefined();
    wire.end.mockRejectedValue(new Error('close failure'));
    expect(await s.close()).toBe(false);
    expect(wire.query.mock.calls.filter((c) => c[0] === 'ROLLBACK')).toHaveLength(0);
  });
  it('auth and malformed input do not open a SQL connection', async () => {
    const app = createApp({ nodeEnv: 'test', persistence: { mode: 'postgres', connection: {} } });
    expect((await app.request('/api/projects')).status).toBe(401);
    expect(
      (
        await app.request('/api/projects', {
          method: 'POST',
          headers: { 'X-Dev-User-Id': 'owner', 'Content-Type': 'application/json' },
          body: '{}',
        })
      ).status,
    ).toBe(400);
    expect(wire.connect).not.toHaveBeenCalled();
  });
  it('invalid mode and absent PostgreSQL configuration fail without Maps fallback', async () => {
    const app = createApp({ nodeEnv: 'test', persistenceFromEnvironment: true });
    for (const env of [{ PERSISTENCE_MODE: 'invalid' }, { PERSISTENCE_MODE: 'postgres' }]) {
      expect(
        (await app.request('/api/projects', { headers: { 'X-Dev-User-Id': 'owner' } }, env)).status,
      ).toBe(500);
    }
    expect(wire.connect).not.toHaveBeenCalled();
  });
  it('memory can be selected explicitly and rejects mixed SQL composition', async () => {
    const app = createApp({ nodeEnv: 'test', persistence: { mode: 'memory' } });
    expect(
      (await app.request('/api/projects', { headers: { 'X-Dev-User-Id': 'owner' } })).status,
    ).toBe(200);
    expect(wire.connect).not.toHaveBeenCalled();
    expect(() =>
      createApp({
        persistence: { mode: 'postgres', connection: {} },
        projectRepository: {
          save: vi.fn(),
          findById: vi.fn(),
          findAll: vi.fn(),
          findByUser: vi.fn(),
        },
      }),
    ).toThrow('joint composition');
  });
});
it('autonomous queries reset transaction-local settings and serialize concurrent units without nesting', async () => {
  let configured = false;
  wire.query.mockImplementation(async (text: string) => {
    if (text === 'BEGIN') configured = false;
    if (text.startsWith('SET LOCAL search_path')) configured = true;
    if (text.startsWith('SELECT')) expect(configured).toBe(true);
    if (text === 'COMMIT') configured = false;
    return { rows: [] };
  });
  const s = new SqlSession({});
  await Promise.all([s.query('SELECT 1'), s.query('SELECT 2')]);
  await s.transaction(() => s.transaction(() => s.query('SELECT 3')));
  expect(wire.query.mock.calls.filter((c) => c[0] === 'BEGIN')).toHaveLength(3);
  expect(wire.connect).toHaveBeenCalledTimes(1);
  await s.close();
});
it('unknown BEGIN poisons the session and prevents later dispatch without rollback', async () => {
  wire.query.mockRejectedValue(new Error('lost BEGIN'));
  const s = new SqlSession({});
  await expect(s.query('SELECT 1')).rejects.toMatchObject({ outcome: 'unknown' });
  const n = wire.query.mock.calls.length;
  await expect(s.query('INSERT')).rejects.toMatchObject({ outcome: 'unknown' });
  expect(wire.query).toHaveBeenCalledTimes(n);
  expect(wire.query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(false);
  await s.close();
});
it('HTTP keeps confirmed creation and IDs when SQL close fails separately', async () => {
  wire.end.mockRejectedValue(new Error('close unconfirmed'));
  const app = createApp({ nodeEnv: 'test', persistence: { mode: 'postgres', connection: {} } });
  const response = await app.request('/api/projects', {
    method: 'POST',
    headers: { 'X-Dev-User-Id': 'synthetic-owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Synthetic close boundary',
      courseCode: 'IS488',
      startDate: '2026-10-26T00:00:00.000Z',
      targetDate: '2026-12-31T00:00:00.000Z',
    }),
  });
  expect(response.status).toBe(201);
  expect(response.headers.get('X-Persistence-Close')).toBe('unconfirmed');
  expect(await response.json()).toMatchObject({
    creatorId: 'synthetic-owner',
    id: expect.any(String),
  });
  expect(wire.query.mock.calls.some((c) => c[0] === 'ROLLBACK')).toBe(false);
});
