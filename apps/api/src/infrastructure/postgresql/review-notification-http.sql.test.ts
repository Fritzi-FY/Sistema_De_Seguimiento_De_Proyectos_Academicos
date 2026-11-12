import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { execFile, fork, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { ReviewDetailResponseSchema, ReviewRequestSummaryResponseSchema } from '@is488/shared';
import { notificationSqlTestTarget } from '../../testing/notification-sql-test-config.js';

const enabled = process.env.IS488_NOTIFICATION_HTTP_SQL_TEST === '1';
const target = notificationSqlTestTarget(enabled, true);
const base = {
  host: target.host,
  port: target.port,
  user: process.env.IS488_SQL_ADMIN_USER ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const suffix = crypto.randomUUID().replaceAll('-', '');
const database = 'is488_test_notification_http_' + suffix;
const migrator = 'is488_nhm_' + suffix;
const runtime = 'is488_nhr_' + suffix;
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreignProject = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const student = '11111111-1111-4111-8111-111111111111';
const peer = '22222222-2222-4222-8222-222222222222';
const teacher = '33333333-3333-4333-8333-333333333333';
const replacement = '44444444-4444-4444-8444-444444444444';
const path = `/api/projects/${projectId}/reviews`;
const initial = {
  title: 'Synthetic HTTP review',
  description: 'Synthetic progress with internal notifications.',
  evidenceUrl: 'https://example.org/progress',
};
const changes = { status: 'CHANGES_REQUESTED', observation: 'Synthetic corrections requested.' };
let admin: Client;
let data: Client;
let api: ChildProcess | undefined;
let address: { port: number; pid: number };
let evidenceDirectory: string;
let executable: string;
let diagnostic = '';
let databaseCreated = false;
const roles: string[] = [];

async function identity(client: Client) {
  const row = (
    await client.query(
      "SELECT host(inet_server_addr()) AS host,inet_server_port() AS port,current_setting('data_directory') AS directory,pg_postmaster_start_time()::text AS started",
    )
  ).rows[0];
  expect({ host: row.host, port: row.port, directory: row.directory }).toEqual({
    host: target.host,
    port: target.port,
    directory: target.directory,
  });
  return row;
}

async function startApi() {
  await identity(admin);
  const child = fork(executable, [], {
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
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
  child.stderr?.on('data', (chunk) => {
    diagnostic = (diagnostic + String(chunk)).slice(-16000);
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const [message] = await Promise.race([
      once(child, 'message', { signal: controller.signal }),
      once(child, 'exit', { signal: controller.signal }).then(([code]) => {
        throw new Error('HTTP API exited before listening: ' + code);
      }),
    ]);
    address = { port: Number(message.port), pid: Number(message.pid) };
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

async function pgCtl(operation: 'stop' | 'start') {
  const child = spawn(
    target.pgCtl,
    [
      operation,
      '-D',
      target.directory,
      ...(operation === 'stop' ? ['-m', 'fast'] : ['-l', join(evidenceDirectory, 'postgres.log')]),
      '-w',
      '-t',
      '60',
    ],
    { windowsHide: true, stdio: 'ignore' },
  );
  const [code] = await once(child, 'exit');
  expect(code, 'pg_ctl ' + operation + ' final exit code').toBe(0);
}

async function http(
  url: string,
  method = 'GET',
  body?: unknown,
  session = 'student',
  status = 200,
) {
  const response = await fetch(`http://127.0.0.1:${address.port}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(session ? { Cookie: 'test_session=' + session } : {}),
      'X-Dev-User-Id': teacher,
      'X-Dev-User-Role': 'teacher',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return response.json();
}

async function create() {
  return ReviewRequestSummaryResponseSchema.parse(
    await http(path, 'POST', initial, 'student', 201),
  );
}

const normalized = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
async function notifications(reviewId: string) {
  return normalized(
    (
      await data.query(
        `SELECT n.* FROM public.internal_notifications n
    JOIN public.teacher_review_actions a ON a.id=n.response_action_id WHERE n.review_id=$1 ORDER BY a.sequence_number`,
        [reviewId],
      )
    ).rows,
  );
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of [
    'teacher_review_requests',
    'teacher_review_actions',
    'internal_notifications',
  ])
    result[table] = (await data.query('SELECT * FROM public.' + table + ' ORDER BY id')).rows;
  return normalized(result);
}
async function rejectUnchanged(
  url: string,
  method: string,
  body: unknown,
  session: string,
  status: number,
) {
  const before = await snapshot();
  await http(url, method, body, session, status);
  expect(await snapshot()).toEqual(before);
}

describe.skipIf(!enabled)('Review notifications HTTP with real authorized PostgreSQL', () => {
  beforeAll(async () => {
    admin = new Client(base);
    await admin.connect();
    await identity(admin);
    evidenceDirectory = join(process.cwd(), '.local-dev', 'notification-http-' + suffix);
    mkdirSync(evidenceDirectory, { recursive: true });
    for (const role of [migrator, runtime]) {
      await admin.query(
        'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
      roles.push(role);
    }
    await identity(admin);
    await admin.query('CREATE DATABASE ' + database + ' OWNER ' + migrator);
    databaseCreated = true;
    await admin.query('REVOKE TEMPORARY ON DATABASE ' + database + ' FROM PUBLIC,' + runtime);
    await identity(admin);
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../../../migrations/runner.ts', import.meta.url)), 'apply'],
      {
        windowsHide: true,
        timeout: 20000,
        env: {
          ...process.env,
          IS488_MIGRATION_HOST: target.host,
          IS488_MIGRATION_PORT: String(target.port),
          IS488_MIGRATION_DATABASE: database,
          IS488_MIGRATION_USER: migrator,
          IS488_MIGRATION_PASSWORD: '',
          IS488_RUNTIME_ROLE: runtime,
          IS488_MIGRATION_REMOTE_PROFILE: '',
          IS488_MIGRATION_AUDIT: join(evidenceDirectory, 'migrations.jsonl'),
        },
      },
    );
    data = new Client({ ...base, database });
    await data.connect();
    await identity(data);
    for (const project of [projectId, foreignProject]) {
      await data.query(
        `INSERT INTO public.projects (id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at)
        VALUES ($1,'Synthetic HTTP notifications','IS488','active',now(),now(),$2,now(),now())`,
        [project, student],
      );
      for (const [user, role] of [
        [student, 'owner'],
        [peer, 'collaborator'],
        [teacher, 'collaborator'],
      ]) {
        await data.query(
          `INSERT INTO public.project_memberships (id,project_id,user_id,role,status,joined_at,updated_at)
          VALUES ($1,$2,$3,$4,'active',now(),now())`,
          [crypto.randomUUID(), project, user, role],
        );
      }
    }
    await data.query(
      'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2),($3,$4)',
      [teacher, projectId, replacement, foreignProject],
    );
    executable = join(evidenceDirectory, 'server.cjs');
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
    await startApi();
  }, 40000);

  beforeEach(async () => {
    await identity(admin);
    await identity(data);
  });

  afterAll(async () => {
    await stopApi();
    if (data) await data.end();
    if (!admin) return;
    try {
      await identity(admin);
      if (databaseCreated) await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)');
      for (const role of roles.reverse()) await admin.query('DROP ROLE ' + role);
    } finally {
      await admin.end();
    }
  }, 20000);

  it('persists three notifications, then recovers the full HTTP review and SQL records after real API and PostgreSQL restart', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    expect(await notifications(review.id)).toEqual([]);
    for (const cycle of [1, 2]) {
      const response = await http(url + '/response', 'POST', changes, 'teacher');
      expect(response).not.toHaveProperty('responseActionId');
      expect(await notifications(review.id)).toHaveLength(cycle);
      await http(url + '/re-submit', 'POST', {
        description: 'Synthetic complete corrections ' + cycle,
      });
      expect(await notifications(review.id)).toHaveLength(cycle);
    }
    await http(
      url + '/response',
      'POST',
      { status: 'APPROVED', observation: 'Final synthetic approval.' },
      'teacher',
    );
    const detail = await http(url);
    const parsed = ReviewDetailResponseSchema.parse(detail);
    expect(parsed.status).toBe('APPROVED');
    expect(parsed.timeline.map((entry) => entry.sequenceNumber)).toEqual([0, 1, 2, 3, 4, 5]);
    const stored = await notifications(review.id);
    expect(stored).toHaveLength(3);
    expect(stored).toMatchObject(
      [1, 3, 5].map((sequence) => ({
        recipient_user_id: student,
        response_action_id: parsed.actions.find((entry) => entry.sequenceNumber === sequence)!.id,
      })),
    );
    const before = { review: detail, notifications: stored };
    writeFileSync(join(evidenceDirectory, 'before.json'), JSON.stringify(before, null, 2));
    const previousApiPid = address.pid;
    const previousPostgres = await identity(admin);
    await stopApi();
    await data.end();
    await admin.end();
    await pgCtl('stop');
    await pgCtl('start');
    admin = new Client(base);
    await admin.connect();
    const recoveredPostgres = await identity(admin);
    expect(recoveredPostgres.started).not.toBe(previousPostgres.started);
    data = new Client({ ...base, database });
    await data.connect();
    await identity(data);
    await startApi();
    expect(address.pid).not.toBe(previousApiPid);
    const after = { review: await http(url), notifications: await notifications(review.id) };
    expect(after).toEqual(before);
    expect(await http(url, 'GET', undefined, 'teacher')).toEqual(detail);
    writeFileSync(join(evidenceDirectory, 'after.json'), JSON.stringify(after, null, 2));
    expect(JSON.parse(readFileSync(join(evidenceDirectory, 'after.json'), 'utf8'))).toEqual(
      JSON.parse(readFileSync(join(evidenceDirectory, 'before.json'), 'utf8')),
    );
    writeFileSync(
      join(evidenceDirectory, 'restart.json'),
      JSON.stringify(
        {
          previousApiPid,
          currentApiPid: address.pid,
          previousPostgres,
          recoveredPostgres,
          reviewId: review.id,
        },
        null,
        2,
      ),
    );
  }, 90000);

  it.each([
    ['missing session', '', 401],
    ['student role', 'student', 403],
    ['unassigned teacher', 'replacement', 404],
  ] as const)('rejects a response with %s without writes', async (_scenario, session, status) => {
    const review = await create();
    await rejectUnchanged(path + '/' + review.id + '/response', 'POST', changes, session, status);
  });

  it('uses session role, rejecting teacher request and resubmission even with active membership', async () => {
    await rejectUnchanged(path, 'POST', initial, 'teacher', 403);
    const review = await create();
    await http(path + '/' + review.id + '/response', 'POST', changes, 'teacher');
    await rejectUnchanged(
      path + '/' + review.id + '/re-submit',
      'POST',
      { description: 'Synthetic attempted resubmission.' },
      'changed',
      403,
    );
  });

  it('rejects a non-author active student and an assigned teacher using another project path', async () => {
    const review = await create();
    await http(path + '/' + review.id + '/response', 'POST', changes, 'teacher');
    await rejectUnchanged(
      path + '/' + review.id + '/re-submit',
      'POST',
      { description: 'Synthetic unauthorized corrections.' },
      'peer',
      404,
    );
    await rejectUnchanged(
      `/api/projects/${foreignProject}/reviews/${review.id}/response`,
      'POST',
      changes,
      'replacement',
      404,
    );
    await rejectUnchanged(path + '/' + review.id, 'GET', undefined, 'peer', 404);
  });

  it('rechecks membership and does not persist a notification for a removed requester', async () => {
    const review = await create();
    await data.query(
      `UPDATE public.project_memberships SET status='removed',updated_at=statement_timestamp(),removed_at=statement_timestamp()
      WHERE project_id=$1 AND user_id=$2`,
      [projectId, student],
    );
    try {
      await rejectUnchanged(path, 'POST', initial, 'student', 404);
      await rejectUnchanged(path + '/' + review.id, 'GET', undefined, 'student', 404);
      await http(path + '/' + review.id + '/response', 'POST', changes, 'teacher');
      expect(await notifications(review.id)).toEqual([]);
      expect(
        ReviewDetailResponseSchema.parse(
          await http(path + '/' + review.id, 'GET', undefined, 'teacher'),
        ).actions,
      ).toHaveLength(1);
    } finally {
      await data.query(
        "UPDATE public.project_memberships SET status='active',removed_at=null WHERE project_id=$1 AND user_id=$2",
        [projectId, student],
      );
    }
  });

  it('rechecks teacher assignment without altering committed notifications', async () => {
    const review = await create();
    await data.query('DELETE FROM public.teacher_project_assignments WHERE project_id=$1', [
      projectId,
    ]);
    await data.query(
      'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
      [replacement, projectId],
    );
    try {
      await rejectUnchanged(path + '/' + review.id + '/response', 'POST', changes, 'teacher', 404);
      await http(path + '/' + review.id + '/response', 'POST', changes, 'replacement');
      expect(await notifications(review.id)).toHaveLength(1);
      await rejectUnchanged(path + '/' + review.id, 'GET', undefined, 'teacher', 404);
    } finally {
      await data.query('DELETE FROM public.teacher_project_assignments WHERE project_id=$1', [
        projectId,
      ]);
      await data.query(
        'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
        [teacher, projectId],
      );
    }
  });

  it('state conflicts do not duplicate review actions or notifications', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    await rejectUnchanged(
      url + '/re-submit',
      'POST',
      { description: 'Premature corrections.' },
      'student',
      409,
    );
    await http(
      url + '/response',
      'POST',
      { status: 'APPROVED', observation: 'Synthetic terminal approval.' },
      'teacher',
    );
    await rejectUnchanged(url + '/response', 'POST', changes, 'teacher', 409);
    await rejectUnchanged(
      url + '/re-submit',
      'POST',
      { description: 'Terminal corrections.' },
      'student',
      409,
    );
    expect(await notifications(review.id)).toHaveLength(1);
  });

  it('a real notification insertion failure returns 200 with the committed review and history intact', async () => {
    const review = await create();
    const url = path + '/' + review.id;
    const offset = diagnostic.length;
    await data.query(`CREATE FUNCTION public.fail_test_notification() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic notification insert failure'; END; $$;
      CREATE TRIGGER fail_test_notification BEFORE INSERT ON public.internal_notifications
      FOR EACH ROW EXECUTE FUNCTION public.fail_test_notification()`);
    try {
      const response = ReviewRequestSummaryResponseSchema.parse(
        await http(url + '/response', 'POST', changes, 'teacher'),
      );
      const detail = ReviewDetailResponseSchema.parse(await http(url));
      expect(response.status).toBe('CHANGES_REQUESTED');
      expect(detail.actions).toHaveLength(1);
      expect(detail.timeline.map((entry) => entry.sequenceNumber)).toEqual([0, 1]);
      expect(await notifications(review.id)).toEqual([]);
      const stored = (
        await data.query('SELECT status FROM public.teacher_review_requests WHERE id=$1', [
          review.id,
        ])
      ).rows[0];
      expect(stored.status).toBe('CHANGES_REQUESTED');
      expect(diagnostic.slice(offset)).toContain('"outcome":"rolled_back"');
      expect(diagnostic.slice(offset)).toContain(detail.actions[0]!.id);
      expect(diagnostic.slice(offset)).not.toContain(changes.observation);
      await rejectUnchanged(url + '/response', 'POST', changes, 'teacher', 409);
    } finally {
      await data.query(
        'DROP TRIGGER fail_test_notification ON public.internal_notifications; DROP FUNCTION public.fail_test_notification()',
      );
    }
    const recovered = await create();
    await http(path + '/' + recovered.id + '/response', 'POST', changes, 'teacher');
    expect(await notifications(recovered.id)).toHaveLength(1);
  });
});
