import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { execFile, fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import {
  decodeReviewNotificationCursor,
  ReviewDetailResponseSchema,
  ReviewNotificationListResponseSchema,
  ReviewRequestSummaryResponseSchema,
} from '@is488/shared';
import { notificationSqlTestTarget } from '../../testing/notification-sql-test-config.js';

const enabled = process.env.IS488_INBOX_HTTP_SQL_TEST === '1';
const target = notificationSqlTestTarget(enabled);
const base = {
  host: target.host,
  port: target.port,
  user: process.env.IS488_SQL_ADMIN_USER ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const suffix = crypto.randomUUID().replaceAll('-', '');
const database = 'is488_test_inbox_http_' + suffix;
const migrator = 'is488_ihm_' + suffix;
const runtime = 'is488_ihr_' + suffix;
const student = '11111111-1111-4111-8111-111111111111';
const peer = '22222222-2222-4222-8222-222222222222';
const teacher = '33333333-3333-4333-8333-333333333333';
const endpoint = '/api/review-notifications';
const roles: string[] = [];
let databaseCreated = false;
let admin: Client;
let data: Client;
let api: ChildProcess | undefined;
let port: number;
let evidence: string;

async function validate(client: Client) {
  expect(
    (
      await client.query(
        "SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory",
      )
    ).rows[0],
  ).toEqual({ host: target.host, port: target.port, directory: target.directory });
}

async function startApi(executable: string) {
  await validate(admin);
  const child = fork(executable, [], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: {
      ...process.env,
      IS488_SQL_HOST: target.host,
      IS488_SQL_PORT: String(target.port),
      IS488_SQL_DATA_DIR: target.directory,
      IS488_NOTIFICATION_HTTP_DATABASE: database,
      IS488_NOTIFICATION_HTTP_USER: runtime,
    },
  });
  api = child;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const [message] = await Promise.race([
      once(child, 'message', { signal: controller.signal }),
      once(child, 'exit', { signal: controller.signal }).then(([code]) => {
        throw new Error('API exited before listening: ' + code);
      }),
    ]);
    port = Number(message.port);
  } catch (error) {
    if (child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    api = undefined;
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function stopApi() {
  const child = api;
  if (!child) return;
  if (child.exitCode !== null) {
    api = undefined;
    expect(child.exitCode).toBe(0);
    return;
  }
  const exited = once(child, 'exit');
  const timer = setTimeout(() => child.kill(), 10000);
  try {
    child.send('stop');
    const [code] = await exited;
    api = undefined;
    expect(code).toBe(0);
  } finally {
    clearTimeout(timer);
  }
}

async function http(
  url = endpoint,
  session = 'student',
  expected = 200,
  method = 'GET',
  body?: unknown,
) {
  const response = await fetch(`http://127.0.0.1:${port}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Cookie: 'test_session=' + session } : {}),
      'X-Dev-User-Id': peer,
      'X-Dev-User-Role': 'admin',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(expected);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return response.json();
}

async function project() {
  await validate(data);
  const id = crypto.randomUUID();
  await data.query(
    `INSERT INTO public.projects(id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at)
    VALUES($1,'Synthetic inbox HTTP','IS488','active',now(),now(),$2,now(),now())`,
    [id, student],
  );
  for (const [user, role] of [
    [student, 'owner'],
    [peer, 'collaborator'],
    [teacher, 'collaborator'],
  ])
    await data.query(
      `INSERT INTO public.project_memberships(id,project_id,user_id,role,status,joined_at,updated_at) VALUES($1,$2,$3,$4,'active',now(),now())`,
      [crypto.randomUUID(), id, user, role],
    );
  await data.query(
    'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
    [teacher, id],
  );
  return id;
}

async function review(projectId: string, session = 'student') {
  await validate(data);
  const result = ReviewRequestSummaryResponseSchema.parse(
    await http(`/api/projects/${projectId}/reviews`, session, 201, 'POST', {
      title: 'Synthetic inbox review',
      description: 'Synthetic HTTP review progress',
    }),
  );
  return `/api/projects/${projectId}/reviews/${result.id}`;
}

async function response(url: string, status = 'CHANGES_REQUESTED') {
  await validate(data);
  const result = ReviewRequestSummaryResponseSchema.parse(
    await http(url + '/response', 'teacher', 200, 'POST', {
      status,
      observation: 'Synthetic teacher response',
    }),
  );
  expect(result).not.toHaveProperty('responseActionId');
  return result;
}

async function complete(url: string) {
  for (const cycle of [1, 2]) {
    await response(url);
    await validate(data);
    await http(url + '/re-submit', 'student', 200, 'POST', {
      description: 'Synthetic complete corrections ' + cycle,
    });
  }
  await response(url, 'APPROVED');
  return ReviewDetailResponseSchema.parse(await http(url));
}

async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'projects',
    'project_memberships',
    'teacher_project_assignments',
    'teacher_review_requests',
    'teacher_review_actions',
    'internal_notifications',
  ])
    result[table] = (
      await data.query(
        `SELECT to_jsonb(entry) AS row FROM public.${table} entry ORDER BY to_jsonb(entry)::text`,
      )
    ).rows;
  return result;
}

describe.skipIf(!enabled)(
  'Student inbox HTTP: real local PostgreSQL, synthetic cookie sessions',
  () => {
    beforeAll(async () => {
      admin = new Client(base);
      await admin.connect();
      await validate(admin);
      evidence = fileURLToPath(
        new URL('../../../../../.local-dev/inbox-http-' + suffix, import.meta.url),
      );
      mkdirSync(evidence, { recursive: true });
      for (const role of [migrator, runtime]) {
        await validate(admin);
        await admin.query(
          'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
        );
        roles.push(role);
      }
      await validate(admin);
      await admin.query('CREATE DATABASE ' + database + ' OWNER ' + migrator);
      databaseCreated = true;
      await admin.query('REVOKE TEMPORARY ON DATABASE ' + database + ' FROM PUBLIC,' + runtime);
      await validate(admin);
      const options = {
        connection: { ...base, database, user: migrator },
        runtimeRole: runtime,
        directory: fileURLToPath(new URL('../../../migrations', import.meta.url)),
        auditFile: join(evidence, 'migration.jsonl'),
      };
      const runnerUrl = new URL('../../../migrations/runner.ts', import.meta.url).href;
      await promisify(execFile)(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          `import {Client} from 'pg'; import {run} from ${JSON.stringify(runnerUrl)};
       const options=JSON.parse(process.argv[1]),target=JSON.parse(process.argv[2]);
       const client=new Client({...options.connection,user:process.argv[3]});await client.connect();
       try {const row=(await client.query("SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory")).rows[0];
       if(row.host!==target.host||row.port!==target.port||row.directory!==target.directory)throw new Error('Migration target mismatch');}finally{await client.end();}
       await run('apply',options);`,
          JSON.stringify(options),
          JSON.stringify(target),
          base.user,
        ],
        { timeout: 20000, windowsHide: true },
      );
      data = new Client({ ...base, database });
      await data.connect();
      await validate(data);
      const executable = join(evidence, 'server.cjs');
      await build({
        entryPoints: [
          fileURLToPath(
            new URL('../../testing/notification-reviews-http-server.ts', import.meta.url),
          ),
        ],
        outfile: executable,
        bundle: true,
        external: ['pg', 'hono', 'hono/*', 'zod', 'jose'],
        platform: 'node',
        format: 'cjs',
      });
      await startApi(executable);
      console.info(
        JSON.stringify({
          suite: 'inbox-http',
          database,
          migrator,
          runtime,
          evidence,
          target: { host: target.host, port: target.port, directory: target.directory },
        }),
      );
    }, 40000);

    beforeEach(async () => {
      await validate(admin);
      await validate(data);
    });
    afterEach(async () => {
      await validate(data);
      await data.query(
        "UPDATE public.project_memberships SET status='removed',removed_at=statement_timestamp(),updated_at=statement_timestamp() WHERE status='active'",
      );
    });
    afterAll(async () => {
      await stopApi();
      if (data) await data.end();
      if (!admin) return;
      try {
        if (databaseCreated) {
          await validate(admin);
          await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)');
        }
        for (const role of roles.reverse()) {
          await validate(admin);
          await admin.query('DROP ROLE ' + role);
        }
        expect(
          (await admin.query('SELECT datname FROM pg_database WHERE datname=$1', [database])).rows,
        ).toEqual([]);
        expect(
          (
            await admin.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[])', [
              [migrator, runtime],
            ])
          ).rows,
        ).toEqual([]);
      } finally {
        await admin.end();
      }
    }, 20000);

    it('returns empty, 401/403/400 and no-store without touching business tables or trusting forged headers', async () => {
      const before = await snapshot();
      expect(await http()).toEqual({ items: [], nextCursor: null });
      await http(endpoint, '', 401);
      for (const session of ['teacher', 'changed'])
        await http(endpoint + '?cursor=invalid', session, 403);
      for (const query of ['cursor=invalid', 'studentId=' + peer, 'limit=0', 'limit=1&limit=2'])
        await http(endpoint + '?' + query, 'student', 400);
      expect(await snapshot()).toEqual(before);
    });

    it('preserves two corrections and approval after reassignment; GET is minimal, historical and read-only', async () => {
      const projectId = await project();
      const url = await review(projectId);
      const detail = await complete(url);
      expect(detail.status).toBe('APPROVED');
      expect(detail.timeline.map((action) => action.sequenceNumber)).toEqual([0, 1, 2, 3, 4, 5]);
      await validate(data);
      await data.query('DELETE FROM public.teacher_project_assignments WHERE project_id=$1', [
        projectId,
      ]);
      await data.query(
        'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
        ['replacement-' + crypto.randomUUID(), projectId],
      );
      const before = await snapshot();
      const page = ReviewNotificationListResponseSchema.parse(await http());
      expect(page.items).toHaveLength(3);
      expect(page.items.map((item) => item.status)).toEqual([
        'APPROVED',
        'CHANGES_REQUESTED',
        'CHANGES_REQUESTED',
      ]);
      expect(new Set(page.items.map((item) => item.responseActionId))).toEqual(
        new Set(
          detail.actions
            .filter((action) => action.actionType === 'TEACHER_RESPONSE')
            .map((action) => action.id),
        ),
      );
      expect(await http(endpoint, 'peer')).toEqual({ items: [], nextCursor: null });
      expect(await http(url)).toEqual(detail);
      expect(await snapshot()).toEqual(before);
    });

    it('revalidates withdrawal between HTTP pages and fills from still authorized projects using the original exact cursor', async () => {
      const retainedProject = await project();
      const retainedUrl = await review(retainedProject);
      await response(retainedUrl, 'APPROVED');
      const withdrawnProject = await project();
      const url = await review(withdrawnProject);
      const detail = await complete(url);
      const peerUrl = await review(withdrawnProject, 'peer');
      await response(peerUrl, 'APPROVED');
      const beforeFirst = await snapshot();
      const first = ReviewNotificationListResponseSchema.parse(await http(endpoint + '?limit=1'));
      expect(first.items).toHaveLength(1);
      expect(first.items[0]!.projectId).toBe(withdrawnProject);
      expect(first.items[0]!.responseActionId).toBe(detail.actions.at(-1)!.id);
      expect(first.nextCursor).not.toBeNull();
      const raw = (
        await data.query(
          `SELECT id,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt" FROM public.internal_notifications WHERE id=$1`,
          [first.items[0]!.id],
        )
      ).rows[0];
      expect(decodeReviewNotificationCursor(first.nextCursor!)).toEqual(raw);
      expect(await snapshot()).toEqual(beforeFirst);
      await validate(data);
      await data.query(
        "UPDATE public.project_memberships SET status='removed',removed_at=statement_timestamp(),updated_at=statement_timestamp() WHERE project_id=$1 AND user_id=$2 AND status='active'",
        [withdrawnProject, student],
      );
      const beforeNext = await snapshot();
      const next = ReviewNotificationListResponseSchema.parse(
        await http(endpoint + '?limit=1&cursor=' + first.nextCursor),
      );
      expect(next.items).toHaveLength(1);
      expect(next.items[0]!.projectId).toBe(retainedProject);
      expect(next.items.every((item) => item.projectId !== withdrawnProject)).toBe(true);
      expect(next.nextCursor).toBeNull();
      expect(await snapshot()).toEqual(beforeNext);
      expect(
        (
          await data.query('SELECT id FROM public.internal_notifications WHERE project_id=$1', [
            withdrawnProject,
          ])
        ).rows,
      ).toHaveLength(4);
      writeFileSync(
        join(evidence, 'withdrawal-pages.json'),
        JSON.stringify({ first, next, cursorPosition: raw }, null, 2),
      );
    });

    it('paginates all stored response identities without duplicates and preserves exact timestamp strings over HTTP', async () => {
      const url = await review(await project());
      await complete(url);
      const full = ReviewNotificationListResponseSchema.parse(await http());
      const collected: typeof full.items = [];
      let cursor: string | undefined;
      do {
        const page = ReviewNotificationListResponseSchema.parse(
          await http(endpoint + '?limit=1' + (cursor ? '&cursor=' + cursor : '')),
        );
        collected.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && collected.length < 5);
      expect(collected).toEqual(full.items);
      expect(new Set(collected.map((item) => item.id)).size).toBe(3);
      for (const item of collected) {
        const raw = (
          await data.query(
            `SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS value FROM public.internal_notifications WHERE id=$1`,
            [item.id],
          )
        ).rows[0].value;
        expect(item.createdAt).toBe(raw);
        expect(item.createdAt).toMatch(/\.\d{6}Z$/);
      }
    });

    it('returns a sanitized 500 on a real SELECT failure without a partial page, false empty or writes', async () => {
      const url = await review(await project());
      await complete(url);
      const before = await snapshot();
      await validate(data);
      await data.query('REVOKE SELECT ON public.internal_notifications FROM ' + runtime);
      try {
        expect(await http(endpoint, 'student', 500)).toEqual({ error: 'Internal Server Error' });
        expect(await snapshot()).toEqual(before);
      } finally {
        await validate(data);
        await data.query('GRANT SELECT ON public.internal_notifications TO ' + runtime);
      }
      expect(ReviewNotificationListResponseSchema.parse(await http()).items).toHaveLength(3);
    });

    it('preserves HTTP 200, review and history after INSERT failure; GET does not repair missing notifications', async () => {
      const url = await review(await project());
      await validate(data);
      await data.query(`CREATE FUNCTION public.fail_inbox_test_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic insert failure'; END; $$;
      CREATE TRIGGER fail_inbox_test_notification BEFORE INSERT ON public.internal_notifications FOR EACH ROW EXECUTE FUNCTION public.fail_inbox_test_notification()`);
      try {
        const result = await response(url, 'APPROVED');
        expect(result.status).toBe('APPROVED');
        const detail = ReviewDetailResponseSchema.parse(await http(url));
        expect(detail.status).toBe('APPROVED');
        expect(detail.actions).toHaveLength(1);
        expect(detail.timeline.map((action) => action.sequenceNumber)).toEqual([0, 1]);
        const before = await snapshot();
        expect(await http()).toEqual({ items: [], nextCursor: null });
        expect(await http()).toEqual({ items: [], nextCursor: null });
        expect(await http(url)).toEqual(detail);
        expect(await snapshot()).toEqual(before);
        expect(
          (
            await data.query('SELECT id FROM public.internal_notifications WHERE review_id=$1', [
              detail.id,
            ])
          ).rows,
        ).toEqual([]);
      } finally {
        await validate(data);
        await data.query(
          'DROP TRIGGER fail_inbox_test_notification ON public.internal_notifications; DROP FUNCTION public.fail_inbox_test_notification()',
        );
      }
    });

    it('conflicting responses do not duplicate notifications and reading does not re-emit', async () => {
      const url = await review(await project());
      await response(url, 'APPROVED');
      const before = await snapshot();
      await validate(data);
      await http(url + '/response', 'teacher', 409, 'POST', {
        status: 'APPROVED',
        observation: 'Repeated synthetic response',
      });
      const first = await http();
      expect(ReviewNotificationListResponseSchema.parse(first).items).toHaveLength(1);
      expect(await http()).toEqual(first);
      expect(await snapshot()).toEqual(before);
      const allowed = (
        await data.query(
          `SELECT privilege,has_table_privilege($1,'public.internal_notifications',privilege) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) privilege`,
          [runtime],
        )
      ).rows;
      expect(allowed.filter((row) => row.allowed).map((row) => row.privilege)).toEqual([
        'SELECT',
        'INSERT',
      ]);
    });
  },
);
