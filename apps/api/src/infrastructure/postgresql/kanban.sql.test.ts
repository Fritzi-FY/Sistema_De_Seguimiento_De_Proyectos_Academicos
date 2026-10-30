import { ciSqlProfile, assertCiSqlTarget } from '../../testing/sql-ci.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Client, type ClientConfig } from 'pg';
import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createApp } from '../http/app.js';
import { SqlSession, sqlRequestScope, PersistenceTransactionError } from './session.js';
import { KanbanSqlStore } from './kanban-store.js';
import {
  PostgresqlTaskCreationAdapter,
  PostgresqlTaskUpdateAdapter,
  PostgresqlTaskMoveAdapter,
  PostgresqlBoardColumnDeletionAdapter,
} from './kanban.transactions.js';
import type {
  BoardResponse,
  ProjectResponse,
  TaskResponse,
  MembershipResponse,
  TaskActivityEvent,
  PaginatedTasksResponse,
} from '@is488/shared';

const enabled = process.env.IS488_KANBAN_SQL_TEST === '1';
const ci = ciSqlProfile();
const config: ClientConfig = {
  host: '127.0.0.1',
  port: ci ? 5432 : 55490,
  database: ci?.database ?? 'is488_dev',
  user: ci?.runtime ?? 'is488_dev_runtime',
  password: ci?.rolePassword,
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4002-8222-222222222222';
const outsider = '44444444-4444-4444-8444-444444444444';
const fixtureProjects: string[] = [];
const evidence: Record<string, unknown>[] = [];
let admin: Client;
let originalProjects: Record<string, unknown>[];
let originalMemberships: Record<string, unknown>[];
const app = () =>
  createApp({ nodeEnv: 'test', persistence: { mode: 'postgres', connection: config } });
type Api = ReturnType<typeof app>;
async function request<T>(
  api: Api,
  method: string,
  path: string,
  body?: unknown,
  expected = 200,
  actor = owner,
  role = 'student',
): Promise<T> {
  const response = await api.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Dev-User-Id': actor,
      'X-Dev-User-Role': role,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.status).toBe(expected);
  return (await response.json()) as T;
}
async function fixture() {
  const api = app();
  const project = await request<ProjectResponse>(
    api,
    'POST',
    '/api/projects',
    {
      title: 'SQL Kanban fixture ' + randomUUID(),
      courseCode: 'IS488',
      startDate: '2026-10-28T00:00:00.000Z',
      targetDate: '2026-12-31T00:00:00.000Z',
    },
    201,
  );
  fixtureProjects.push(project.id);
  await request<MembershipResponse>(
    api,
    'POST',
    `/api/projects/${project.id}/members`,
    { userId: member, role: 'collaborator' },
    201,
  );
  const board = await request<BoardResponse>(api, 'GET', `/api/projects/${project.id}/board`);
  return { api, project, board, path: `/api/projects/${project.id}` };
}
async function task(
  f: Awaited<ReturnType<typeof fixture>>,
  column = f.board.columns[0]!.id,
  title = 'SQL synthetic task',
) {
  return request<TaskResponse>(
    f.api,
    'POST',
    f.path + '/tasks',
    { title, columnId: column, assigneeIds: [member], labels: ['SQL'] },
    201,
  );
}
async function list(f: Awaited<ReturnType<typeof fixture>>) {
  return request<PaginatedTasksResponse>(f.api, 'GET', f.path + '/tasks');
}
async function history(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  return request<TaskActivityEvent[]>(f.api, 'GET', f.path + '/tasks/' + id + '/activity');
}
function scoped<T>(work: () => Promise<T>, override: ClientConfig = {}, actor = owner) {
  const session = new SqlSession({ ...config, ...override }, () => actor);
  return sqlRequestScope.run(session, async () => {
    try {
      return await work();
    } finally {
      expect(await session.close()).toBe(true);
    }
  });
}
describe.skipIf(!enabled)('PostgreSQL Kanban, only authorized is488_dev', () => {
  beforeAll(async () => {
    admin = new Client({
      ...config,
      user: ci?.admin ?? 'is488_migration_admin',
      password: ci?.adminPassword,
    });
    admin.on('error', () => {});
    await admin.connect();
    const row = (
      await admin.query(
        "SELECT current_database() AS database,inet_server_port() AS port,current_setting('data_directory') AS directory",
      )
    ).rows[0];
    expect(row.database).toBe(config.database);
    if (ci) await assertCiSqlTarget(admin);
    else {
      expect(row.port).toBe(55490);
      expect(String(row.directory).replaceAll('\\', '/').toLowerCase()).toBe(
        'c:/users/fritz/appdata/local/temp/is488-migrator-d5974a0c7b7444ff9f9d85079bc86898',
      );
    }
    expect(
      (
        await admin.query('SELECT version FROM is488_migrations.versions ORDER BY version')
      ).rows.map((r) => r.version),
    ).toEqual([1, 2, 3, 4]);
    originalProjects = (await admin.query('SELECT * FROM public.projects ORDER BY id')).rows;
    originalMemberships = (
      await admin.query('SELECT * FROM public.project_memberships ORDER BY id')
    ).rows;
  });
  afterAll(async () => {
    if (!admin) return;
    try {
      expect(
        (
          await admin.query('SELECT * FROM public.projects WHERE id=ANY($1::uuid[]) ORDER BY id', [
            originalProjects.map((p) => p.id),
          ])
        ).rows,
      ).toEqual(originalProjects);
      expect(
        (
          await admin.query(
            'SELECT * FROM public.project_memberships WHERE id=ANY($1::uuid[]) ORDER BY id',
            [originalMemberships.map((p) => p.id)],
          )
        ).rows,
      ).toEqual(originalMemberships);
      mkdirSync('evidence/kanban-postgresql', { recursive: true });
      writeFileSync(
        'evidence/kanban-postgresql/sql-tests.json',
        JSON.stringify(
          {
            at: new Date().toISOString(),
            database: config.database,
            otherDatabasesModified: false,
            originalProjectsAndMembershipsPreserved: true,
            fixtureProjectsRetained: fixtureProjects,
            observations: evidence,
          },
          null,
          2,
        ),
      );
    } finally {
      await admin.end();
    }
  });

  it('creates exactly one default board under concurrent independent apps', async () => {
    const api = app();
    const project = await request<ProjectResponse>(
      api,
      'POST',
      '/api/projects',
      {
        title: 'Concurrent default board ' + randomUUID(),
        courseCode: 'IS488',
        startDate: '2026-10-28T00:00:00.000Z',
        targetDate: '2026-12-31T00:00:00.000Z',
      },
      201,
    );
    fixtureProjects.push(project.id);
    const boards = await Promise.all(
      Array.from({ length: 4 }, () =>
        request<BoardResponse>(app(), 'GET', `/api/projects/${project.id}/board`),
      ),
    );
    expect(new Set(boards.map((b) => b.id)).size).toBe(1);
    expect(boards[0]!.columns.map((c) => c.name)).toEqual([
      'Por hacer',
      'En progreso',
      'Completado',
    ]);
    expect(
      (
        await admin.query(
          'SELECT count(*)::int AS n FROM public.board_columns WHERE project_id=$1',
          [project.id],
        )
      ).rows[0].n,
    ).toBe(3);
  });

  it('creates, edits, clears fields and keeps no-op timestamps/history stable', async () => {
    const f = await fixture();
    const created = await task(f);
    expect((await history(f, created.id)).map((e) => e.action)).toEqual(['CREATED']);
    const edited = await request<TaskResponse>(f.api, 'PATCH', f.path + '/tasks/' + created.id, {
      title: 'Updated synthetic task',
      description: 'description',
      dueDate: '2026-12-20T00:00:00.000Z',
      labels: ['review'],
      assigneeIds: [],
    });
    expect(edited.id).toBe(created.id);
    expect(edited.assigneeIds).toEqual([]);
    const cleared = await request<TaskResponse>(f.api, 'PATCH', f.path + '/tasks/' + created.id, {
      description: '',
      dueDate: null,
      labels: [],
    });
    expect(cleared.description).toBeUndefined();
    expect(cleared.dueDate).toBeUndefined();
    expect(cleared.labels).toEqual([]);
    const prior = await history(f, created.id);
    const noop = await request<TaskResponse>(f.api, 'PATCH', f.path + '/tasks/' + created.id, {
      title: cleared.title,
    });
    expect(noop.updatedAt).toBe(cleared.updatedAt);
    expect(await history(f, created.id)).toEqual(prior);
    expect(prior.filter((e) => e.action === 'UPDATED')).toHaveLength(2);
  });

  it('rejects inactive/nonmember assignees, structural edits and cross-project destinations without effects', async () => {
    const f = await fixture(),
      other = await fixture();
    const created = await task(f);
    const before = await list(f);
    const events = await history(f, created.id);
    await request(
      f.api,
      'PATCH',
      f.path + '/tasks/' + created.id,
      { assigneeIds: [outsider] },
      400,
    );
    await request(
      f.api,
      'PATCH',
      f.path + '/tasks/' + created.id,
      { columnId: f.board.columns[1]!.id },
      400,
    );
    await request(
      f.api,
      'POST',
      f.path + '/tasks/' + created.id + '/move',
      { destinationColumnId: other.board.columns[0]!.id, destinationIndex: 0 },
      400,
    );
    await request(
      f.api,
      'POST',
      f.path + '/tasks',
      { title: 'Bad assignment', columnId: f.board.columns[0]!.id, assigneeIds: [outsider] },
      400,
    );
    expect(await list(f)).toEqual(before);
    expect(await history(f, created.id)).toEqual(events);
  });

  it('serializes creation and moves across sessions with clamping and contiguous order', async () => {
    const f = await fixture();
    const tasks = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        request<TaskResponse>(
          app(),
          'POST',
          f.path + '/tasks',
          { title: 'Concurrent SQL task ' + i, columnId: f.board.columns[0]!.id },
          201,
        ),
      ),
    );
    expect((await list(f)).items.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
    await Promise.all(
      tasks.map((t) =>
        request(app(), 'POST', f.path + '/tasks/' + t.id + '/move', {
          destinationColumnId: f.board.columns[1]!.id,
          destinationIndex: 999,
        }),
      ),
    );
    const moved = await list(f);
    expect(moved.items.every((t) => t.columnId === f.board.columns[1]!.id)).toBe(true);
    expect(moved.items.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
    for (const t of tasks)
      expect((await history(f, t.id)).filter((e) => e.action === 'MOVED')).toHaveLength(1);
    const first = moved.items[0]!;
    const before = await history(f, first.id);
    await request(f.api, 'POST', f.path + '/tasks/' + first.id + '/move', {
      destinationColumnId: first.columnId,
      destinationIndex: 0,
    });
    expect(await history(f, first.id)).toEqual(before);
    await request(f.api, 'POST', f.path + '/tasks/' + first.id + '/move', {
      destinationColumnId: first.columnId,
      destinationIndex: 999,
    });
    expect((await list(f)).items.map((t) => t.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it('atomically reallocates columns, retains historical references and enforces 1/10 limits', async () => {
    const f = await fixture();
    const a = await task(f),
      b = await task(f, f.board.columns[1]!.id);
    await request(f.api, 'DELETE', f.path + '/board/columns/' + a.columnId, undefined, 409);
    await request(
      f.api,
      'DELETE',
      f.path + '/board/columns/' + a.columnId + '?targetColumnId=' + b.columnId,
    );
    const tasks = (await list(f)).items;
    expect(tasks.map((t) => t.orderIndex)).toEqual([0, 1]);
    expect(tasks.find((t) => t.id === a.id)!.orderIndex).toBe(1);
    expect(
      (await history(f, a.id)).some(
        (e) => e.action === 'COLUMN_DELETED_REALLOCATION' && e.fromColumnId === a.columnId,
      ),
    ).toBe(true);
    const board = await request<BoardResponse>(f.api, 'GET', f.path + '/board');
    expect(board.columns.map((c) => c.orderIndex)).toEqual([0, 1]);
    for (let i = board.columns.length; i < 10; i++)
      await request(
        f.api,
        'POST',
        f.path + '/board/columns',
        { name: 'SQL column ' + i, category: 'TODO' },
        201,
      );
    await request(
      f.api,
      'POST',
      f.path + '/board/columns',
      { name: 'Too many', category: 'TODO' },
      400,
    );
    const empty = await fixture();
    await request(empty.api, 'DELETE', empty.path + '/board/columns/' + empty.board.columns[0]!.id);
    await request(empty.api, 'DELETE', empty.path + '/board/columns/' + empty.board.columns[1]!.id);
    await request(
      empty.api,
      'DELETE',
      empty.path + '/board/columns/' + empty.board.columns[2]!.id,
      undefined,
      400,
    );
  });

  it('performs AND filters and literal substring search in one SQL page/count snapshot', async () => {
    const f = await fixture();
    await task(f, f.board.columns[0]!.id, 'Literal %_ SQL Alpha');
    await task(f, f.board.columns[1]!.id, 'Different SQL Beta');
    const query = `/tasks?search=${encodeURIComponent('%_')}&label=SQL&assigneeId=${member}&columnId=${f.board.columns[0]!.id}&priority=MEDIUM&limit=1`;
    const result = await request<PaginatedTasksResponse>(f.api, 'GET', f.path + query);
    expect(result.totalItems).toBe(1);
    expect(result.items[0]!.title).toContain('%_');
    const beyond = await request<PaginatedTasksResponse>(f.api, 'GET', f.path + query + '&page=2');
    expect(beyond.items).toEqual([]);
    expect(beyond.totalItems).toBe(1);
    const none = await request<PaginatedTasksResponse>(
      f.api,
      'GET',
      f.path + '/tasks?search=NoSuchSyntheticValue',
    );
    expect(none.totalPages).toBe(0);
  });

  it('keeps horizontal isolation and does not expand teacher mutation/history permissions', async () => {
    const f = await fixture();
    const t = await task(f);
    for (const actor of [outsider, '33333333-3333-4333-8333-333333333333']) {
      const role = actor === outsider ? 'student' : 'teacher';
      await request(f.api, 'GET', f.path + '/tasks', undefined, 404, actor, role);
      await request(
        f.api,
        'GET',
        f.path + '/tasks/' + t.id + '/activity',
        undefined,
        404,
        actor,
        role,
      );
      await request(
        f.api,
        'PATCH',
        f.path + '/tasks/' + t.id,
        { title: 'Unauthorized change' },
        404,
        actor,
        role,
      );
    }
  });

  it('denies runtime DDL, ledger access and mutation of immutable activity', async () => {
    const f = await fixture();
    const t = await task(f);
    const c = new Client(config);
    await c.connect();
    try {
      for (const sql of [
        'CREATE TABLE public.forbidden_runtime_probe(id int)',
        'SELECT * FROM is488_migrations.versions',
        `UPDATE public.task_activity SET actor_id='forbidden' WHERE task_id='${t.id}'`,
        `DELETE FROM public.task_activity WHERE task_id='${t.id}'`,
      ])
        await expect(c.query(sql)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await c.end();
    }
    expect((await history(f, t.id)).map((e) => e.action)).toEqual(['CREATED']);
  });

  it('rolls back state and activity together on failures after either stage', async () => {
    const f = await fixture();
    const t = await task(f);
    const before = await list(f),
      events = await history(f, t.id);
    for (const failAt of ['after_state', 'after_events'] as const) {
      const store = new KanbanSqlStore(async (stage) => {
        if (stage === failAt) throw new Error('Synthetic SQL atomicity fault');
      });
      await expect(
        scoped(() =>
          new PostgresqlTaskUpdateAdapter(store).executeAtomicTaskUpdate({
            projectId: f.project.id,
            taskId: t.id,
            actorId: owner,
            patch: { title: 'Must roll back' },
            timestamp: new Date().toISOString(),
          }),
        ),
      ).rejects.toMatchObject({ outcome: 'rolled_back' });
      expect(await list(f)).toEqual(before);
      expect(await history(f, t.id)).toEqual(events);
    }
  });

  it('coordinates assignee eligibility with concurrent membership retirement', async () => {
    const f = await fixture();
    const t = await request<TaskResponse>(
      f.api,
      'POST',
      f.path + '/tasks',
      { title: 'Assignment race task', columnId: f.board.columns[0]!.id },
      201,
    );
    let entered!: () => void, release!: () => void;
    const ready = new Promise<void>((r) => (entered = r)),
      gate = new Promise<void>((r) => (release = r));
    const store = new KanbanSqlStore(async (stage) => {
      if (stage === 'after_state') {
        entered();
        await gate;
      }
    });
    const assigning = scoped(() =>
      new PostgresqlTaskUpdateAdapter(store).executeAtomicTaskUpdate({
        projectId: f.project.id,
        taskId: t.id,
        actorId: owner,
        patch: { assigneeIds: [member] },
        timestamp: new Date().toISOString(),
      }),
    );
    await ready;
    const memberships = await request<MembershipResponse[]>(f.api, 'GET', f.path + '/members');
    const membership = memberships.find((m) => m.userId === member)!;
    const retiring = request(
      f.api,
      'DELETE',
      f.path + '/members/' + member + '?membershipId=' + membership.id,
    );
    try {
      let waiting = false;
      for (let i = 0; i < 60; i++) {
        const n = (
          await admin.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname='is488_dev' AND wait_event_type='Lock'",
          )
        ).rows[0].n;
        if (n) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
    } finally {
      release();
    }
    await assigning;
    await retiring;
    await request(f.api, 'PATCH', f.path + '/tasks/' + t.id, { assigneeIds: [member] }, 400);
    expect((await history(f, t.id)).filter((e) => e.action === 'UPDATED')).toHaveLength(1);
    evidence.push({
      case: 'assignment-retirement serialization',
      projectId: f.project.id,
      retirementWaitedForAssignment: true,
      subsequentAssignmentStatus: 400,
    });
  });

  for (const deliverCommit of [true, false])
    it(`keeps lost COMMIT ${deliverCommit ? 'response' : 'dispatch'} unknown without retry or compensating rollback`, async () => {
      const f = await fixture(),
        id = randomUUID();
      const sockets = new Set<Socket>();
      let commit = false,
        dropped = false,
        commands = Buffer.alloc(0);
      const proxy = createServer((peer) => {
        const backend = connect({ host: '127.0.0.1', port: config.port ?? 55490 });
        sockets.add(peer);
        sockets.add(backend);
        peer.on('data', (b) => {
          commands = Buffer.concat([commands, Buffer.from(b)]);
          if (commands.includes(Buffer.from('COMMIT\0'))) commit = true;
          if (commit && !deliverCommit && !dropped) {
            dropped = true;
            peer.destroy();
            backend.destroy();
          } else backend.write(b);
        });
        backend.on('data', (b) => {
          if (
            commit &&
            deliverCommit &&
            !dropped &&
            Buffer.from(b).includes(Buffer.from('COMMIT\0'))
          ) {
            dropped = true;
            peer.destroy();
            backend.destroy();
          } else peer.write(b);
        });
        peer.on('error', () => {});
        backend.on('error', () => peer.destroy());
        peer.on('close', () => backend.destroy());
        backend.on('close', () => peer.destroy());
      });
      proxy.listen(0, '127.0.0.1');
      await once(proxy, 'listening');
      try {
        const work = scoped(
          () =>
            new PostgresqlTaskCreationAdapter().executeAtomicTaskCreation({
              id,
              projectId: f.project.id,
              columnId: f.board.columns[0]!.id,
              title: 'Transport uncertainty task',
              priority: 'MEDIUM',
              labels: [],
              creatorId: owner,
              assigneeIds: [],
              timestamp: new Date().toISOString(),
            }),
          { port: (proxy.address() as { port: number }).port },
        );
        await expect(work).rejects.toBeInstanceOf(PersistenceTransactionError);
        await expect(work).rejects.toMatchObject({ outcome: 'unknown' });
        expect(dropped).toBe(true);
        expect(commands.toString().includes('ROLLBACK')).toBe(false);
        const rows = (await admin.query('SELECT id FROM public.tasks WHERE id=$1', [id])).rows;
        expect(rows.length).toBe(deliverCommit ? 1 : 0);
        expect(
          (await admin.query('SELECT id FROM public.task_activity WHERE task_id=$1', [id])).rows
            .length,
        ).toBe(deliverCommit ? 1 : 0);
        evidence.push({
          case: 'lost task COMMIT',
          deliverCommit,
          taskId: id,
          outcome: 'unknown',
          observedApplied: !!rows.length,
          historicalRollbackConfirmed: false,
        });
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>((r, e) => proxy.close((error) => (error ? e(error) : r())));
      }
    });

  it('keeps durable columns, assignments and immutable activity in a new app instance', async () => {
    const f = await fixture();
    const t = await task(f);
    await request(f.api, 'POST', f.path + '/tasks/' + t.id + '/move', {
      destinationColumnId: f.board.columns[1]!.id,
      destinationIndex: 999,
    });
    await request(f.api, 'PATCH', f.path + '/board/columns/' + f.board.columns[1]!.id, {
      name: 'Persisted SQL column',
      color: '#112233',
    });
    const before = {
      board: await request<BoardResponse>(f.api, 'GET', f.path + '/board'),
      tasks: await list(f),
      events: await history(f, t.id),
    };
    const fresh = app();
    expect({
      board: await request(fresh, 'GET', f.path + '/board'),
      tasks: await request(fresh, 'GET', f.path + '/tasks'),
      events: await request(fresh, 'GET', f.path + '/tasks/' + t.id + '/activity'),
    }).toEqual(before);
    evidence.push({ case: 'new app instance persistence', projectId: f.project.id, taskId: t.id });
  });

  it('rolls back creation, movement and column reallocation after event persistence fails', async () => {
    const f = await fixture(),
      t = await task(f);
    const before = {
      board: await request<BoardResponse>(f.api, 'GET', f.path + '/board'),
      tasks: await list(f),
      events: await history(f, t.id),
    };
    const timestamp = new Date().toISOString();
    const failure = () =>
      new KanbanSqlStore(async (stage) => {
        if (stage === 'after_events') throw new Error('Synthetic atomicity fault');
      });
    const id = randomUUID();
    for (const work of [
      () =>
        new PostgresqlTaskCreationAdapter(failure()).executeAtomicTaskCreation({
          id,
          projectId: f.project.id,
          columnId: t.columnId,
          title: 'Must not persist',
          priority: 'MEDIUM',
          labels: [],
          creatorId: owner,
          assigneeIds: [member],
          timestamp,
        }),
      () =>
        new PostgresqlTaskMoveAdapter(failure()).executeAtomicTaskMove({
          taskId: t.id,
          projectId: f.project.id,
          destinationColumnId: f.board.columns[1]!.id,
          destinationIndex: 0,
          actorId: owner,
          timestamp,
        }),
      () =>
        new PostgresqlBoardColumnDeletionAdapter(failure()).executeAtomicColumnDeletion({
          projectId: f.project.id,
          columnId: t.columnId,
          targetColumnId: f.board.columns[1]!.id,
          actorId: owner,
          timestamp,
        }),
    ]) {
      await expect(scoped<unknown>(work)).rejects.toMatchObject({ outcome: 'rolled_back' });
      expect({
        board: await request(f.api, 'GET', f.path + '/board'),
        tasks: await list(f),
        events: await history(f, t.id),
      }).toEqual(before);
      expect((await admin.query('SELECT id FROM public.tasks WHERE id=$1', [id])).rows).toEqual([]);
    }
  });

  it('database foreign keys and checks reject cross-project columns and negative positions', async () => {
    const f = await fixture(),
      other = await fixture();
    const c = new Client(config);
    await c.connect();
    try {
      const sql =
        "INSERT INTO public.tasks(id,project_id,column_id,title,priority,order_index,creator_id,created_at,updated_at) VALUES($1,$2,$3,'Constraint probe','MEDIUM',$4,$5,now(),now())";
      await expect(
        c.query(sql, [randomUUID(), f.project.id, other.board.columns[0]!.id, 0, owner]),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        c.query(sql, [randomUUID(), f.project.id, f.board.columns[0]!.id, -1, owner]),
      ).rejects.toMatchObject({ code: '23514' });
    } finally {
      await c.end();
    }
    expect((await list(f)).totalItems).toBe(0);
  });

  it('preserves repeated assignees and their order through creation, editing and SQL reads', async () => {
    const f = await fixture();
    const original = [member, owner, member];
    const t = await request<TaskResponse>(
      f.api,
      'POST',
      f.path + '/tasks',
      {
        title: 'Ordered repeated assignees',
        columnId: f.board.columns[0]!.id,
        assigneeIds: original,
      },
      201,
    );
    expect(t.assigneeIds).toEqual(original);
    expect((await list(f)).items.find((item) => item.id === t.id)!.assigneeIds).toEqual(original);
    const changed = [owner, member, member, owner];
    const edited = await request<TaskResponse>(f.api, 'PATCH', f.path + '/tasks/' + t.id, {
      assigneeIds: changed,
    });
    expect(edited.assigneeIds).toEqual(changed);
    const fresh = app();
    const reread = await request<PaginatedTasksResponse>(
      fresh,
      'GET',
      f.path + '/tasks?assigneeId=' + member,
    );
    expect(reread.totalItems).toBe(1);
    expect(reread.items[0]!.assigneeIds).toEqual(changed);
    const events = await history(f, t.id);
    const update = events.find((event) => event.action === 'UPDATED');
    expect(update?.details?.assigneeIds).toEqual({ from: original, to: changed });
    evidence.push({
      case: 'ordered repeated assignees',
      projectId: f.project.id,
      taskId: t.id,
      original,
      changed,
      observed: reread.items[0]!.assigneeIds,
    });
  });
});
