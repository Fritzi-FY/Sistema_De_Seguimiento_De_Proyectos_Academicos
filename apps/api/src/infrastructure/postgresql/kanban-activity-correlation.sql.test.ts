import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client, type ClientConfig } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  TaskActivityListResponseSchema,
  type SystemClockPort,
  type TaskResponse,
} from '@is488/shared';
import { notificationSqlTestTarget } from '../../testing/notification-sql-test-config.js';
import { CreateTaskUseCase } from '../../application/use-cases/create-task.use-case.js';
import { UpdateTaskUseCase } from '../../application/use-cases/update-task.use-case.js';
import { MoveTaskUseCase } from '../../application/use-cases/move-task.use-case.js';
import { DeleteBoardColumnUseCase } from '../../application/use-cases/delete-board-column.use-case.js';
import { GetTaskActivityUseCase } from '../../application/use-cases/get-task-activity.use-case.js';
import { PostgresqlProjectRepository, PostgresqlMembershipRepository } from './repositories.js';
import {
  PostgresqlBoardRepository,
  PostgresqlTaskRepository,
  PostgresqlTaskActivityRepository,
} from './kanban.repositories.js';
import {
  PostgresqlTaskCreationAdapter,
  PostgresqlTaskUpdateAdapter,
  PostgresqlTaskMoveAdapter,
  PostgresqlBoardColumnDeletionAdapter,
} from './kanban.transactions.js';
import { KanbanSqlStore, type KanbanFaultStage } from './kanban-store.js';
import { SqlSession, sqlRequestScope } from './session.js';

const enabled = process.env.IS488_KANBAN_ACTIVITY_SQL_TEST === '1';
const target = Object.freeze(notificationSqlTestTarget(enabled));
if (enabled)
  assert.ok(['127.0.0.1', '::1'].includes(target.host), 'Explicit loopback SQL host required');
const base: ClientConfig = {
  host: target.host,
  port: target.port,
  user: process.env.IS488_SQL_ADMIN_USER ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const migrations = fileURLToPath(new URL('../../../migrations', import.meta.url));
const root = fileURLToPath(
  new URL('../../../../../.local-dev/correlate-kanban-task-activity/', import.meta.url),
);
const stamp = '2026-11-15T12:00:00.123Z';
const correlationId = 'abcdefab-1234-4abc-8def-123456789abc';
const operations = ['create', 'update', 'move', 'reallocate'] as const;
type Operation = (typeof operations)[number];
type Resource = {
  database: string;
  migrator: string;
  runtime: string;
  roles: string[];
  created: boolean;
  data: Client;
};
let admin: Client | undefined;
let evidence: string;
let active: Resource;
let upgrade: Resource;
let legacyBefore: unknown[];
let legacyLedger: unknown[];
let baseline: { databases: string[]; roles: string[] };
const resources: Resource[] = [];
const applied: { database: string; versions: number[] }[] = [];
const clock: SystemClockPort = { now: () => new Date(stamp), isoString: () => stamp };

async function validate(client: Client) {
  expect(
    (
      await client.query(
        "SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory",
      )
    ).rows[0],
  ).toEqual({ host: target.host, port: target.port, directory: target.directory });
}

async function inventory() {
  return {
    databases: (await admin!.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(
      (row) => row.datname as string,
    ),
    roles: (await admin!.query('SELECT rolname FROM pg_roles ORDER BY rolname')).rows.map(
      (row) => row.rolname as string,
    ),
  };
}

async function resource() {
  const suffix = randomUUID().replaceAll('-', '');
  const value: Resource = {
    database: 'is488_test_activity_' + suffix,
    migrator: 'is488_am_' + suffix,
    runtime: 'is488_ar_' + suffix,
    roles: [],
    created: false,
    data: new Client({ ...base, database: 'is488_test_activity_' + suffix }),
  };
  resources.push(value);
  writeFileSync(
    join(evidence, 'resources.json'),
    JSON.stringify(
      resources.map(({ data: _data, ...entry }) => entry),
      null,
      2,
    ),
  );
  for (const role of [value.migrator, value.runtime]) {
    await validate(admin!);
    await admin!.query(
      'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
    );
    value.roles.push(role);
  }
  await validate(admin!);
  await admin!.query('CREATE DATABASE ' + value.database + ' OWNER ' + value.migrator);
  value.created = true;
  await admin!.query(
    'REVOKE TEMPORARY ON DATABASE ' + value.database + ' FROM PUBLIC,' + value.runtime,
  );
  await value.data.connect();
  await validate(value.data);
  return value;
}

async function migrate(value: Resource, directory: string, label: string) {
  await validate(admin!);
  await validate(value.data);
  const runner = new URL('../../../migrations/runner.ts', import.meta.url).href;
  const options = {
    connection: { ...base, database: value.database, user: value.migrator },
    runtimeRole: value.runtime,
    directory,
    auditFile: join(evidence, label + '.jsonl'),
  };
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import assert from 'node:assert/strict'; import { Client } from 'pg'; import { run } from ${JSON.stringify(runner)};
     const options=JSON.parse(process.argv[1]), target=JSON.parse(process.argv[2]);
     const check=new Client({...options.connection,user:process.argv[3]}); await check.connect();
     try { assert.deepEqual((await check.query("SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory")).rows[0],target); }
     finally { await check.end(); }
     const result=await run('apply',options); assert.equal(result.closeConfirmed,true); console.log(JSON.stringify({applied:result.applied}));`,
      JSON.stringify(options),
      JSON.stringify({ host: target.host, port: target.port, directory: target.directory }),
      base.user!,
    ],
    { timeout: 30000, windowsHide: true },
  );
  const versions = JSON.parse(stdout.trim()).applied as number[];
  applied.push({ database: value.database, versions });
  return versions;
}

async function scoped<T>(value: Resource, actor: string, work: () => Promise<T>) {
  const session = new SqlSession(
    { ...base, database: value.database, user: value.runtime },
    () => actor,
  );
  try {
    return await sqlRequestScope.run(session, work);
  } finally {
    expect(await session.close()).toBe(true);
  }
}

function useCases(store = new KanbanSqlStore()) {
  const projects = new PostgresqlProjectRepository(),
    members = new PostgresqlMembershipRepository();
  return {
    create: new CreateTaskUseCase(
      new PostgresqlTaskCreationAdapter(store),
      projects,
      members,
      clock,
    ),
    update: new UpdateTaskUseCase(new PostgresqlTaskUpdateAdapter(store), projects, members, clock),
    move: new MoveTaskUseCase(new PostgresqlTaskMoveAdapter(store), projects, members, clock),
    reallocate: new DeleteBoardColumnUseCase(
      new PostgresqlBoardColumnDeletionAdapter(store),
      projects,
      members,
      clock,
    ),
    history: new GetTaskActivityUseCase(
      projects,
      members,
      new PostgresqlTaskRepository(),
      new PostgresqlTaskActivityRepository(),
    ),
  };
}

async function fixture() {
  await validate(active.data);
  const projectId = randomUUID(),
    owner = 'owner-' + randomUUID(),
    member = 'member-' + randomUUID();
  await active.data.query(
    `INSERT INTO public.projects(id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at) VALUES($1,'Synthetic activity','IS488','active',$2,$2,$3,$2,$2)`,
    [projectId, stamp, owner],
  );
  await active.data.query(
    `INSERT INTO public.project_memberships(id,project_id,user_id,role,status,joined_at,updated_at) VALUES($1,$2,$3,'collaborator','active',$4,$4)`,
    [randomUUID(), projectId, member, stamp],
  );
  const board = await scoped(active, owner, () =>
    new PostgresqlBoardRepository().findOrCreateDefaultBoard(projectId),
  );
  const create = (columnId: string, title: string) =>
    scoped(active, owner, () =>
      useCases().create.execute({ projectId, requesterId: owner, columnId, title }),
    );
  const tasks = [
    await create(board.columns[0]!.id, 'Source task one'),
    await create(board.columns[0]!.id, 'Source task two'),
    await create(board.columns[1]!.id, 'Existing target task'),
  ];
  return { projectId, owner, member, board, tasks };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function mutate(
  f: Fixture,
  operation: Operation,
  correlation?: string,
  actor = f.member,
  store?: KanbanSqlStore,
) {
  return scoped(active, actor, async () => {
    const cases = useCases(store),
      context = { projectId: f.projectId, correlationId: correlation };
    if (operation === 'create')
      return cases.create.execute({
        ...context,
        requesterId: actor,
        columnId: f.board.columns[0]!.id,
        title: 'New correlated task',
      });
    if (operation === 'update')
      return cases.update.execute({
        ...context,
        requesterId: actor,
        taskId: f.tasks[0]!.id,
        title: 'Edited correlated task',
      });
    if (operation === 'move')
      return cases.move.execute({
        ...context,
        requestingUserId: actor,
        taskId: f.tasks[0]!.id,
        destinationColumnId: f.board.columns[1]!.id,
        destinationIndex: 0,
      });
    return cases.reallocate.execute({
      ...context,
      requesterId: actor,
      columnId: f.board.columns[0]!.id,
      targetColumnId: f.board.columns[1]!.id,
    });
  });
}

async function history(f: Fixture) {
  return scoped(active, f.member, () =>
    new PostgresqlTaskActivityRepository().findByProjectId(f.projectId),
  );
}

async function snapshot(f: Fixture) {
  const result = {} as Record<string, unknown[]>;
  for (const table of ['boards', 'board_columns', 'tasks', 'task_assignees', 'task_activity']) {
    result[table] = (
      await active.data.query(
        `SELECT to_jsonb(t) AS row FROM public.${table} t WHERE project_id=$1 ORDER BY to_jsonb(t)::text`,
        [f.projectId],
      )
    ).rows;
  }
  return result;
}

describe.skipIf(!enabled)('Kanban activity correlation: real ephemeral PostgreSQL', () => {
  beforeAll(async () => {
    admin = new Client(base);
    await admin.connect();
    await validate(admin);
    baseline = await inventory();
    mkdirSync(root, { recursive: true });
    evidence = mkdtempSync(join(root, 'sql-'));
    const manifest = JSON.parse(readFileSync(join(migrations, 'manifest.json'), 'utf8')) as {
      version: number;
      name: string;
      sha256: string;
    }[];
    expect(manifest.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const entry of manifest)
      expect(
        createHash('sha256')
          .update(readFileSync(join(migrations, 'sql', entry.name)))
          .digest('hex'),
      ).toBe(entry.sha256);
    active = await resource();
    expect(await migrate(active, migrations, 'empty-0008')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    upgrade = await resource();
    const previous = join(evidence, 'catalog-0007');
    mkdirSync(join(previous, 'sql'), { recursive: true });
    writeFileSync(join(previous, 'manifest.json'), JSON.stringify(manifest.slice(0, 7)));
    for (const entry of manifest.slice(0, 7))
      copyFileSync(join(migrations, 'sql', entry.name), join(previous, 'sql', entry.name));
    expect(await migrate(upgrade, previous, 'legacy-0007')).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const project = randomUUID(),
      board = randomUUID(),
      column = randomUUID(),
      task = randomUUID();
    await validate(upgrade.data);
    await upgrade.data.query(
      `INSERT INTO public.projects(id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at) VALUES($1,'Historical project','IS488','active',$2,$2,'legacy-actor',$2,$2)`,
      [project, stamp],
    );
    await upgrade.data.query(
      'INSERT INTO public.boards(id,project_id,created_at,updated_at) VALUES($1,$2,$3,$3)',
      [board, project, stamp],
    );
    await upgrade.data.query(
      `INSERT INTO public.board_columns(id,project_id,board_id,name,category,order_index,created_at,updated_at) VALUES($1,$2,$3,'Historical column','TODO',0,$4,$4)`,
      [column, project, board, stamp],
    );
    await upgrade.data.query(
      `INSERT INTO public.tasks(id,project_id,column_id,title,priority,order_index,creator_id,created_at,updated_at) VALUES($1,$2,$3,'Historical task','MEDIUM',0,'legacy-actor',$4,$4)`,
      [task, project, column, stamp],
    );
    await upgrade.data.query(
      `INSERT INTO public.task_activity(id,project_id,task_id,actor_id,action,details,created_at) VALUES($1,$2,$3,'legacy-actor','CREATED','{"title":"Historical task"}',$4)`,
      [randomUUID(), project, task, stamp],
    );
    legacyBefore = (
      await upgrade.data.query('SELECT to_jsonb(a) AS row FROM public.task_activity a ORDER BY id')
    ).rows;
    legacyLedger = (
      await upgrade.data.query(
        'SELECT version,checksum FROM is488_migrations.versions ORDER BY version',
      )
    ).rows;
    expect(await migrate(upgrade, migrations, 'upgrade-0008')).toEqual([8]);
    console.info(
      JSON.stringify({
        suite: 'kanban-activity-correlation',
        evidence,
        target,
        databases: resources.map((r) => r.database),
      }),
    );
  }, 90000);

  beforeEach(async () => {
    await validate(admin!);
    await validate(active.data);
  });

  afterAll(async () => {
    for (const value of resources) await value.data.end();
    if (!admin) return;
    try {
      for (const value of resources.slice().reverse()) {
        if (value.created) {
          await validate(admin);
          await admin.query('DROP DATABASE ' + value.database + ' WITH (FORCE)');
        }
        for (const role of value.roles.slice().reverse()) {
          await validate(admin);
          await admin.query('DROP ROLE ' + role);
        }
      }
      await validate(admin);
      expect(await inventory()).toEqual(baseline);
      if (evidence)
        writeFileSync(
          join(evidence, 'summary.json'),
          JSON.stringify(
            {
              target,
              applied,
              resources: resources.map(({ data: _data, ...entry }) => entry),
              cleanup: 'confirmed',
              baselineInventoryPreserved: true,
            },
            null,
            2,
          ),
        );
    } finally {
      await admin.end();
    }
  }, 20000);

  it('applies 0008 from empty and preserves the first seven ledger checksums during upgrade', async () => {
    expect(
      (
        await active.data.query('SELECT version FROM is488_migrations.versions ORDER BY version')
      ).rows.map((row) => row.version),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const ledger = (
      await upgrade.data.query(
        'SELECT version,checksum FROM is488_migrations.versions ORDER BY version',
      )
    ).rows;
    expect(ledger.slice(0, 7)).toEqual(legacyLedger);
    expect(ledger[7]!.version).toBe(8);
    expect(
      (
        await active.data.query(
          `SELECT data_type,is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='task_activity' AND column_name='correlation_id'`,
        )
      ).rows,
    ).toEqual([{ data_type: 'uuid', is_nullable: 'YES' }]);
  });

  it('retains historical events exactly, with SQL NULL omitted by a fresh reader', async () => {
    expect(
      (
        await upgrade.data.query(
          "SELECT to_jsonb(a)-'correlation_id' AS row FROM public.task_activity a ORDER BY id",
        )
      ).rows,
    ).toEqual(legacyBefore);
    expect(
      (await upgrade.data.query('SELECT correlation_id FROM public.task_activity')).rows,
    ).toEqual([{ correlation_id: null }]);
    const projectId = (legacyBefore[0] as { row: { project_id: string } }).row.project_id;
    const events = await scoped(upgrade, 'legacy-actor', () =>
      new PostgresqlTaskActivityRepository().findByProjectId(projectId),
    );
    expect(events).toHaveLength(1);
    expect(events[0]).not.toHaveProperty('correlationId');
    expect(TaskActivityListResponseSchema.parse(events)).toEqual(events);
  });

  it('keeps activity append-only including the new column and forbids runtime ledger access', async () => {
    const client = new Client({ ...base, database: active.database, user: active.runtime });
    await client.connect();
    try {
      for (const sql of [
        'UPDATE public.task_activity SET correlation_id=NULL',
        'DELETE FROM public.task_activity',
        'TRUNCATE public.task_activity',
        'SELECT * FROM is488_migrations.versions',
      ])
        await expect(client.query(sql)).rejects.toMatchObject({ code: '42501' });
      expect(
        (
          await client.query(
            "SELECT has_table_privilege(current_user,'public.task_activity','SELECT') AS read, has_table_privilege(current_user,'public.task_activity','INSERT') AS append, has_table_privilege(current_user,'public.task_activity','UPDATE') AS update, has_table_privilege(current_user,'public.task_activity','DELETE') AS delete",
          )
        ).rows[0],
      ).toEqual({ read: true, append: true, update: false, delete: false });
    } finally {
      await client.end();
    }
  });

  it.each(operations)(
    'persists exact %s audit fields and reads them from a new adapter/connection',
    async (operation) => {
      const f = await fixture(),
        before = await history(f);
      const mutation = await mutate(f, operation, correlationId.toUpperCase());
      const events = (await history(f)).filter(
        (event) => !before.some((old) => old.id === event.id),
      );
      expect(events).toHaveLength(operation === 'reallocate' ? 2 : 1);
      expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
      const expectedTasks =
        operation === 'create'
          ? [(mutation as TaskResponse).id]
          : f.tasks.slice(0, operation === 'reallocate' ? 2 : 1).map((task) => task.id);
      expect(events.map((event) => event.taskId).sort()).toEqual(expectedTasks.sort());
      const action = {
        create: 'CREATED',
        update: 'UPDATED',
        move: 'MOVED',
        reallocate: 'COLUMN_DELETED_REALLOCATION',
      }[operation];
      for (const event of events) {
        expect(event).toMatchObject({
          actorId: f.member,
          projectId: f.projectId,
          action,
          createdAt: stamp,
          correlationId,
        });
        if (operation !== 'create')
          expect(
            f.tasks.slice(0, operation === 'reallocate' ? 2 : 1).map((task) => task.id),
          ).toContain(event.taskId);
        const stored = (
          await active.data.query(
            'SELECT task_id,actor_id,project_id,action,created_at,correlation_id FROM public.task_activity WHERE id=$1',
            [event.id],
          )
        ).rows[0];
        expect(stored).toEqual({
          task_id: event.taskId,
          actor_id: f.member,
          project_id: f.projectId,
          action,
          created_at: new Date(stamp),
          correlation_id: correlationId,
        });
      }
      expect(TaskActivityListResponseSchema.parse(events)).toEqual(events);
    },
  );

  for (const input of [undefined, 'invalid-correlation'])
    it.each(operations)(
      `omits ${input === undefined ? 'absent' : 'invalid'} correlation for %s without changing the mutation`,
      async (operation) => {
        const f = await fixture(),
          before = await history(f);
        await mutate(f, operation, input);
        const events = (await history(f)).filter(
          (event) => !before.some((old) => old.id === event.id),
        );
        expect(events).toHaveLength(operation === 'reallocate' ? 2 : 1);
        for (const event of events) {
          expect(event).not.toHaveProperty('correlationId');
          expect(
            (
              await active.data.query(
                'SELECT correlation_id FROM public.task_activity WHERE id=$1',
                [event.id],
              )
            ).rows[0],
          ).toEqual({ correlation_id: null });
        }
      },
    );

  it('keeps task state, timestamps and history stable for edit and move no-ops', async () => {
    const f = await fixture(),
      before = await snapshot(f);
    await scoped(active, f.member, async () => {
      const cases = useCases();
      expect(
        (
          await cases.update.execute({
            projectId: f.projectId,
            taskId: f.tasks[0]!.id,
            requesterId: f.member,
            title: f.tasks[0]!.title,
            correlationId,
          })
        ).activity,
      ).toBeNull();
      expect(
        (
          await cases.move.execute({
            projectId: f.projectId,
            taskId: f.tasks[0]!.id,
            requestingUserId: f.member,
            destinationColumnId: f.board.columns[0]!.id,
            destinationIndex: 0,
            correlationId,
          })
        ).activity,
      ).toBeNull();
    });
    expect(await snapshot(f)).toEqual(before);
  });

  it.each(operations)(
    'does not authorize %s through correlation matching another actor',
    async (operation) => {
      const f = await fixture();
      await mutate(f, 'update', correlationId);
      const before = await snapshot(f);
      await expect(mutate(f, operation, correlationId, 'outsider')).rejects.toMatchObject({
        statusCode: 404,
      });
      await expect(
        scoped(active, 'outsider', () =>
          useCases().history.execute({
            projectId: f.projectId,
            taskId: f.tasks[0]!.id,
            requesterId: 'outsider',
          }),
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(await snapshot(f)).toEqual(before);
    },
  );

  it('rejects cross-project task and column identifiers without effects', async () => {
    const f = await fixture(),
      other = await fixture(),
      before = await snapshot(f),
      foreign = await snapshot(other);
    await expect(
      scoped(active, f.member, () =>
        useCases().move.execute({
          projectId: f.projectId,
          taskId: other.tasks[0]!.id,
          requestingUserId: f.member,
          destinationColumnId: f.board.columns[1]!.id,
          destinationIndex: 0,
          correlationId,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      scoped(active, f.member, () =>
        useCases().reallocate.execute({
          projectId: f.projectId,
          columnId: f.board.columns[0]!.id,
          targetColumnId: other.board.columns[1]!.id,
          requesterId: f.member,
          correlationId,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await snapshot(f)).toEqual(before);
    expect(await snapshot(other)).toEqual(foreign);
  });

  for (const stage of ['after_state', 'after_events'] as KanbanFaultStage[])
    it.each(operations)(
      `rolls back %s state and correlated events after ${stage}`,
      async (operation) => {
        const f = await fixture(),
          before = await snapshot(f);
        const store = new KanbanSqlStore(async (current) => {
          if (current === stage) throw new Error('Synthetic transaction fault');
        });
        await expect(mutate(f, operation, correlationId, f.member, store)).rejects.toMatchObject({
          outcome: 'rolled_back',
        });
        expect(await snapshot(f)).toEqual(before);
      },
    );

  it('rolls back the column and all reassigned tasks when SQL rejects event persistence', async () => {
    const f = await fixture(),
      before = await snapshot(f);
    await validate(active.data);
    await active.data.query(
      `ALTER TABLE public.task_activity ADD CONSTRAINT test_correlation_fault CHECK(project_id <> '${f.projectId}'::uuid OR correlation_id IS DISTINCT FROM '${correlationId}'::uuid)`,
    );
    try {
      await expect(mutate(f, 'reallocate', correlationId)).rejects.toMatchObject({
        outcome: 'rolled_back',
        sqlState: '23514',
      });
    } finally {
      await validate(active.data);
      await active.data.query(
        'ALTER TABLE public.task_activity DROP CONSTRAINT test_correlation_fault',
      );
    }
    expect(await snapshot(f)).toEqual(before);
  });

  it('does not deduplicate separate effective changes sharing a UUID', async () => {
    const f = await fixture(),
      before = await history(f);
    await mutate(f, 'update', correlationId);
    await scoped(active, f.member, () =>
      useCases().update.execute({
        projectId: f.projectId,
        taskId: f.tasks[0]!.id,
        requesterId: f.member,
        title: 'Second effective edit',
        correlationId,
      }),
    );
    const events = (await history(f)).filter((event) => !before.some((old) => old.id === event.id));
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.correlationId === correlationId)).toBe(true);
    expect(new Set(events.map((event) => event.id)).size).toBe(2);
  });

  it('normalizes direct activity repository inputs consistently with persisted rows', async () => {
    const f = await fixture();
    for (const input of [correlationId.toUpperCase(), 'invalid-correlation']) {
      const saved = await scoped(active, f.member, () =>
        new PostgresqlTaskActivityRepository().recordEvent({
          projectId: f.projectId,
          taskId: f.tasks[0]!.id,
          actorId: f.member,
          action: 'UPDATED',
          createdAt: stamp,
          correlationId: input,
        }),
      );
      const read = (await history(f)).find((event) => event.id === saved.id);
      expect(read).toEqual(saved);
      if (input === 'invalid-correlation') expect(read).not.toHaveProperty('correlationId');
      else expect(read).toHaveProperty('correlationId', correlationId);
    }
  });
});
