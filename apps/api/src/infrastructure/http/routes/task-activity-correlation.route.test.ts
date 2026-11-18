import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client, type ClientConfig } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskActivityListResponseSchema,
  type BoardResponse,
  type ProjectResponse,
  type TaskResponse,
  type TaskActivityEvent,
} from '@is488/shared';
import { createApp, type AppOptions } from '../app.js';
import { InMemoryKanbanProjectStorage } from '../../adapters/repositories/in-memory-kanban-project.storage.js';
import { KanbanSqlStore } from '../../postgresql/kanban-store.js';
import { notificationSqlTestTarget } from '../../../testing/notification-sql-test-config.js';

const sqlEnabled = process.env.IS488_KANBAN_CORRELATION_HTTP_SQL_TEST === '1';
const target = Object.freeze(notificationSqlTestTarget(sqlEnabled));
if (sqlEnabled) assert.ok(['127.0.0.1', '::1'].includes(target.host));
const base: ClientConfig = {
  host: target.host,
  port: target.port,
  user: process.env.IS488_SQL_ADMIN_USER ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const correlation = 'abcdefab-1234-4abc-8def-123456789abc';
const stamp = '2026-11-15T12:00:00.123Z';
const operations = ['create', 'update', 'move', 'reallocate'] as const;
type Operation = (typeof operations)[number];
type Api = ReturnType<typeof createApp>;
const identity = (actor = member) => ({ 'X-Dev-User-Id': actor, 'X-Dev-User-Role': 'student' });

async function send(
  api: Api,
  method: string,
  path: string,
  body?: unknown,
  headers = new Headers(identity()),
) {
  headers = new Headers(headers);
  headers.set('Content-Type', 'application/json');
  const response = await api.request(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(response.headers.has('X-Persistence-Close')).toBe(false);
  return response;
}

for (const postgres of [false, true]) {
  describe.skipIf(postgres && !sqlEnabled)(
    `Kanban correlation HTTP + ${postgres ? 'PostgreSQL' : 'memory'}`,
    () => {
      let admin: Client | undefined;
      let data: Client | undefined;
      let evidence: string;
      let baseline: { databases: string[]; roles: string[] };
      const suffix = randomUUID().replaceAll('-', '');
      const database = 'is488_test_http_activity_' + suffix;
      const migrator = 'is488_ham_' + suffix;
      const runtime = 'is488_har_' + suffix;
      const createdRoles: string[] = [];
      let databaseCreated = false;

      async function validate(client: Client) {
        expect(
          (
            await client.query(
              "SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory",
            )
          ).rows[0],
        ).toEqual({ host: target.host, port: target.port, directory: target.directory });
      }
      async function inventory() {
        return {
          databases: (
            await admin!.query('SELECT datname FROM pg_database ORDER BY datname')
          ).rows.map((row) => row.datname as string),
          roles: (await admin!.query('SELECT rolname FROM pg_roles ORDER BY rolname')).rows.map(
            (row) => row.rolname as string,
          ),
        };
      }
      function makeApp(storage: InMemoryKanbanProjectStorage, options: AppOptions = {}) {
        return createApp({
          nodeEnv: 'test',
          clock: { now: () => new Date(stamp), isoString: () => stamp },
          ...(postgres
            ? {
                persistence: {
                  mode: 'postgres' as const,
                  connection: { ...base, database, user: runtime },
                },
              }
            : { kanbanStorage: storage }),
          ...options,
        });
      }
      async function fixture(options: AppOptions = {}) {
        if (postgres) await validate(data!);
        const storage = new InMemoryKanbanProjectStorage();
        const api = makeApp(storage, options);
        const own = new Headers(identity(owner));
        const created = await send(
          api,
          'POST',
          '/api/projects',
          {
            title: 'Correlation HTTP fixture',
            courseCode: 'IS488',
            startDate: stamp,
            targetDate: stamp,
          },
          own,
        );
        expect(created.status).toBe(201);
        const project = (await created.json()) as ProjectResponse;
        const path = '/api/projects/' + project.id;
        expect(
          (
            await send(
              api,
              'POST',
              path + '/members',
              { userId: member, role: 'collaborator' },
              own,
            )
          ).status,
        ).toBe(201);
        const board = (await (
          await send(api, 'GET', path + '/board', undefined, own)
        ).json()) as BoardResponse;
        const tasks: TaskResponse[] = [];
        for (const title of ['First source task', 'Second source task']) {
          const response = await send(
            api,
            'POST',
            path + '/tasks',
            { title, columnId: board.columns[0]!.id },
            own,
          );
          expect(response.status).toBe(201);
          tasks.push((await response.json()) as TaskResponse);
        }
        return {
          api,
          storage,
          project,
          path,
          board,
          tasks,
          reader: () => (postgres ? makeApp(storage, options) : api),
        };
      }
      type Fixture = Awaited<ReturnType<typeof fixture>>;
      let f: Fixture;
      function spec(value: Fixture, operation: Operation) {
        const first = value.tasks[0]!;
        if (operation === 'create')
          return {
            method: 'POST',
            path: value.path + '/tasks',
            body: { title: 'New task', columnId: value.board.columns[0]!.id },
          };
        if (operation === 'update')
          return {
            method: 'PATCH',
            path: value.path + '/tasks/' + first.id,
            body: { title: 'Changed task' },
          };
        if (operation === 'move')
          return {
            method: 'POST',
            path: value.path + '/tasks/' + first.id + '/move',
            body: { destinationColumnId: value.board.columns[1]!.id, destinationIndex: 0 },
          };
        return {
          method: 'DELETE',
          path:
            value.path +
            '/board/columns/' +
            value.board.columns[0]!.id +
            '?targetColumnId=' +
            value.board.columns[1]!.id,
          body: undefined,
        };
      }
      async function mutate(operation: Operation, headers: Headers, body?: unknown) {
        const request = spec(f, operation);
        return send(f.api, request.method, request.path, body ?? request.body, headers);
      }
      async function history(value: Fixture, taskId: string) {
        const response = await send(
          value.reader(),
          'GET',
          value.path + '/tasks/' + taskId + '/activity',
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        return TaskActivityListResponseSchema.parse(await response.json());
      }
      async function snapshot(value: Fixture) {
        if (!postgres) return value.storage.getSnapshot(value.project.id);
        const rows: Record<string, unknown[]> = {};
        for (const table of ['boards', 'board_columns', 'tasks', 'task_assignees', 'task_activity'])
          rows[table] = (
            await data!.query(
              `SELECT to_jsonb(t) AS row FROM public.${table} t WHERE project_id=$1 ORDER BY to_jsonb(t)::text`,
              [value.project.id],
            )
          ).rows;
        return rows;
      }
      async function persisted(value: Fixture, events: TaskActivityEvent[]) {
        for (const event of events) {
          if (postgres) {
            expect(
              (
                await data!.query(
                  'SELECT id,task_id,project_id,actor_id,action,created_at,correlation_id FROM public.task_activity WHERE id=$1',
                  [event.id],
                )
              ).rows[0],
            ).toEqual({
              id: event.id,
              task_id: event.taskId,
              project_id: value.project.id,
              actor_id: event.actorId,
              action: event.action,
              created_at: new Date(stamp),
              correlation_id: event.correlationId ?? null,
            });
          } else expect(value.storage.getSnapshot(value.project.id).events).toContainEqual(event);
        }
      }

      beforeAll(async () => {
        if (!postgres) return;
        admin = new Client(base);
        await admin.connect();
        await validate(admin);
        baseline = await inventory();
        const root = fileURLToPath(
          new URL('../../../../../../.local-dev/correlate-kanban-task-activity/', import.meta.url),
        );
        mkdirSync(root, { recursive: true });
        evidence = mkdtempSync(join(root, 'http-sql-'));
        writeFileSync(
          join(evidence, 'resources.json'),
          JSON.stringify({ target, database, migrator, runtime }, null, 2),
        );
        for (const role of [migrator, runtime]) {
          await validate(admin);
          await admin.query(
            'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
          );
          createdRoles.push(role);
        }
        await validate(admin);
        await admin.query('CREATE DATABASE ' + database + ' OWNER ' + migrator);
        databaseCreated = true;
        data = new Client({ ...base, database });
        await data.connect();
        await validate(data);
        await data.query('REVOKE TEMPORARY ON DATABASE ' + database + ' FROM PUBLIC,' + runtime);
        const runner = new URL('../../../../migrations/runner.ts', import.meta.url).href;
        const options = {
          connection: { ...base, database, user: migrator },
          runtimeRole: runtime,
          directory: fileURLToPath(new URL('../../../../migrations', import.meta.url)),
          auditFile: join(evidence, 'migrations.jsonl'),
        };
        await validate(admin);
        const { stdout } = await promisify(execFile)(
          process.execPath,
          [
            '--input-type=module',
            '--eval',
            `import assert from 'node:assert/strict'; import {Client} from 'pg'; import {run} from ${JSON.stringify(runner)};
        const options=JSON.parse(process.argv[1]),target=JSON.parse(process.argv[2]);
        const client=new Client({...options.connection,user:process.argv[3]});await client.connect();
        try{assert.deepEqual((await client.query("SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory")).rows[0],target);}finally{await client.end();}
        const result=await run('apply',options);assert.equal(result.closeConfirmed,true);console.log(JSON.stringify(result.applied));`,
            JSON.stringify(options),
            JSON.stringify({ host: target.host, port: target.port, directory: target.directory }),
            base.user!,
          ],
          { timeout: 30000, windowsHide: true },
        );
        expect(JSON.parse(stdout.trim())).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        console.info(
          JSON.stringify({ suite: 'kanban-correlation-http-sql', evidence, target, database }),
        );
      }, 60000);
      beforeEach(async () => {
        f = await fixture();
      });
      afterAll(async () => {
        if (!postgres || !admin) return;
        await data?.end();
        try {
          if (databaseCreated) {
            await validate(admin);
            await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)');
          }
          for (const role of createdRoles.reverse()) {
            await validate(admin);
            await admin.query('DROP ROLE ' + role);
          }
          await validate(admin);
          expect(await inventory()).toEqual(baseline);
          writeFileSync(
            join(evidence, 'summary.json'),
            JSON.stringify(
              {
                target,
                database,
                migrator,
                runtime,
                applied: [1, 2, 3, 4, 5, 6, 7, 8],
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

      it.each(operations)(
        'propagates normalized correlation and exact %s audit fields',
        async (operation) => {
          const response = await mutate(
            operation,
            new Headers({
              ...identity(),
              'x-correlation-id': correlation.toUpperCase(),
              Authorization: 'Bearer synthetic-private-token',
              Cookie: 'private-cookie=synthetic-private-value',
              'X-Request-ID': 'untrusted-request-metadata',
            }),
          );
          expect(response.status).toBe(operation === 'create' ? 201 : 200);
          expect(response.headers.get('Cache-Control')).toBe('no-store');
          const body = (await response.json()) as TaskResponse;
          const ids =
            operation === 'create'
              ? [body.id]
              : f.tasks.slice(0, operation === 'reallocate' ? 2 : 1).map((task) => task.id);
          const events: TaskActivityEvent[] = [];
          for (const id of ids) {
            const list = await history(f, id);
            const event = list.find((event) => event.correlationId === correlation)!;
            expect(event).toMatchObject({
              taskId: id,
              projectId: f.project.id,
              actorId: member,
              createdAt: stamp,
              correlationId: correlation,
              action: {
                create: 'CREATED',
                update: 'UPDATED',
                move: 'MOVED',
                reallocate: 'COLUMN_DELETED_REALLOCATION',
              }[operation],
            });
            expect(JSON.stringify(list)).not.toMatch(
              /synthetic-private|untrusted-request-metadata|Authorization|Cookie/,
            );
            if (operation !== 'create')
              expect(list.some((event) => !Object.hasOwn(event, 'correlationId'))).toBe(true);
            events.push(event);
          }
          expect(new Set(events.map((event) => event.id)).size).toBe(ids.length);
          await persisted(f, events);
        },
      );

      const unusable = [
        undefined,
        '',
        'private-invalid-token',
        correlation + 'x',
        correlation + ', ' + randomUUID(),
        correlation + ', ' + correlation,
      ];
      for (const [index, value] of unusable.entries())
        it.each(operations)(`omits unusable header variant ${index} for %s`, async (operation) => {
          const headers = new Headers(identity());
          if (value !== undefined) {
            if (index === 5) {
              headers.append('X-Correlation-ID', correlation);
              headers.append('X-Correlation-ID', correlation);
            } else headers.set('X-Correlation-ID', value);
          }
          headers.set('X-Request-ID', correlation);
          const response = await mutate(operation, headers);
          expect(response.status).toBe(operation === 'create' ? 201 : 200);
          const body = (await response.json()) as TaskResponse;
          const ids =
            operation === 'create'
              ? [body.id]
              : f.tasks.slice(0, operation === 'reallocate' ? 2 : 1).map((task) => task.id);
          for (const id of ids) {
            const events = await history(f, id);
            expect(events.every((event) => !Object.hasOwn(event, 'correlationId'))).toBe(true);
            expect(JSON.stringify(events)).not.toContain('private-invalid-token');
            await persisted(f, events);
          }
        });

      for (const field of ['actorId', 'requesterId', 'correlationId'])
        it.each(['create', 'update', 'move'] as const)(
          `rejects body ${field} injection for %s`,
          async (operation) => {
            const before = await snapshot(f);
            const response = await mutate(
              operation,
              new Headers({ ...identity(), 'X-Correlation-ID': correlation }),
              { ...spec(f, operation).body, [field]: outsider },
            );
            expect(response.status).toBe(400);
            expect(await snapshot(f)).toEqual(before);
          },
        );
      it('does not obtain column deletion identity or correlation from an unused body', async () => {
        const response = await mutate('reallocate', new Headers(identity()), {
          actorId: outsider,
          correlationId: correlation,
        });
        expect(response.status).toBe(200);
        for (const task of f.tasks) {
          const event = (await history(f, task.id)).find(
            (event) => event.action === 'COLUMN_DELETED_REALLOCATION',
          )!;
          expect(event.actorId).toBe(member);
          expect(event).not.toHaveProperty('correlationId');
          await persisted(f, [event]);
        }
      });
      for (const authenticated of [false, true])
        it.each(operations)(
          `denies %s with matching correlation when ${authenticated ? 'outsider' : 'unauthenticated'}`,
          async (operation) => {
            expect(
              (
                await mutate(
                  'update',
                  new Headers({ ...identity(), 'X-Correlation-ID': correlation }),
                )
              ).status,
            ).toBe(200);
            const before = await snapshot(f);
            const headers = new Headers(authenticated ? identity(outsider) : {});
            headers.set('X-Correlation-ID', correlation);
            const response = await mutate(operation, headers);
            expect(response.status).toBe(authenticated ? 404 : 401);
            expect(await snapshot(f)).toEqual(before);
            const historyResponse = await send(
              f.reader(),
              'GET',
              f.path + '/tasks/' + f.tasks[0]!.id + '/activity',
              undefined,
              headers,
            );
            expect(historyResponse.status).toBe(authenticated ? 404 : 401);
            if (authenticated)
              expect(historyResponse.headers.get('Cache-Control')).toBe('no-store');
          },
        );
      it('rejects cross-project resources and histories regardless of matching correlation', async () => {
        const other = await fixture();
        const before = await snapshot(f),
          foreign = await snapshot(other);
        const headers = new Headers({ ...identity(), 'X-Correlation-ID': correlation });
        expect(
          (
            await send(
              f.api,
              'GET',
              f.path + '/tasks/' + other.tasks[0]!.id + '/activity',
              undefined,
              headers,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await send(
              f.api,
              'PATCH',
              f.path + '/tasks/' + other.tasks[0]!.id,
              { title: 'Unauthorized resource' },
              headers,
            )
          ).status,
        ).toBe(404);
        expect(await snapshot(f)).toEqual(before);
        expect(await snapshot(other)).toEqual(foreign);
      });
      it('does not emit events for no-op edits or moves', async () => {
        const before = await snapshot(f),
          headers = new Headers({ ...identity(), 'X-Correlation-ID': correlation });
        expect((await mutate('update', headers, { title: f.tasks[0]!.title })).status).toBe(200);
        expect(
          (
            await mutate('move', headers, {
              destinationColumnId: f.board.columns[0]!.id,
              destinationIndex: 0,
            })
          ).status,
        ).toBe(200);
        expect(await snapshot(f)).toEqual(before);
      });
      it.each(operations)('preserves business rejection and state for %s', async (operation) => {
        const before = await snapshot(f),
          headers = new Headers({ ...identity(), 'X-Correlation-ID': 'private-invalid-token' });
        const request = spec(f, operation);
        const response = await send(
          f.api,
          request.method,
          operation === 'reallocate' ? request.path.split('?')[0]! : request.path,
          operation === 'create'
            ? { ...request.body, title: '' }
            : operation === 'update'
              ? { dueDate: 'invalid' }
              : operation === 'move'
                ? { ...request.body, destinationIndex: -1 }
                : undefined,
          headers,
        );
        expect(response.status).toBe(operation === 'reallocate' ? 409 : 400);
        expect(await response.text()).not.toContain('private-invalid-token');
        expect(await snapshot(f)).toEqual(before);
      });
      it('keeps the actor from the supplied session middleware despite forged headers', async () => {
        const session = await fixture({
          authentication: async (c, next) => {
            c.set('user', { userId: owner, role: 'student' });
            await next();
          },
        });
        const response = await send(
          session.api,
          'PATCH',
          session.path + '/tasks/' + session.tasks[0]!.id,
          { title: 'Session actor edit' },
          new Headers({
            ...identity(outsider),
            'X-Correlation-ID': correlation.toUpperCase(),
            Cookie: 'session=synthetic-session',
          }),
        );
        expect(response.status).toBe(200);
        const event = (await history(session, session.tasks[0]!.id)).find(
          (event) => event.correlationId === correlation,
        )!;
        expect(event.actorId).toBe(owner);
        await persisted(session, [event]);
      });
      if (postgres)
        it.each(operations)(
          'rolls back %s HTTP state and events after actual SQL insertion',
          async (operation) => {
            const before = await snapshot(f);
            const append = KanbanSqlStore.prototype.appendEvents;
            const fault = vi
              .spyOn(KanbanSqlStore.prototype, 'appendEvents')
              .mockImplementation(async function (this: KanbanSqlStore, session, events) {
                await append.call(this, session, events);
                throw new Error('synthetic-private-token');
              });
            try {
              const response = await mutate(
                operation,
                new Headers({ ...identity(), 'X-Correlation-ID': correlation }),
              );
              expect(response.status).toBe(500);
              expect(await response.json()).toEqual({ error: 'Internal Server Error' });
            } finally {
              fault.mockRestore();
            }
            expect(await snapshot(f)).toEqual(before);
          },
        );
    },
  );
}
