import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type ClientConfig } from 'pg';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  decodeReviewNotificationCursor,
  encodeReviewNotificationCursor,
  type InternalReviewNotificationInput,
  type ReviewNotificationListItem,
} from '@is488/shared';
import { notificationSqlTestTarget } from '../../testing/notification-sql-test-config.js';
import { ListStudentReviewNotificationsUseCase } from '../../application/use-cases/list-student-review-notifications.use-case.js';
import { InMemoryReviewNotificationRepository } from '../adapters/repositories/in-memory-review-notification.repository.js';
import { InMemoryReviewRepository } from '../adapters/repositories/in-memory-review.repository.js';
import { InMemoryMembershipRepository } from '../adapters/repositories/in-memory-membership.repository.js';
import { PostgresqlReviewRepository } from './review.repository.js';
import { PostgresqlReviewNotificationReader } from './review-notification-reader.repository.js';
import { SqlSession, sqlRequestScope } from './session.js';

const enabled = process.env.IS488_INBOX_SQL_TEST === '1';
const target = notificationSqlTestTarget(enabled);
const base: ClientConfig = {
  host: target.host,
  port: target.port,
  user: process.env.IS488_SQL_ADMIN_USER ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 3000,
  query_timeout: 6000,
};
const suffix = crypto.randomUUID().replaceAll('-', '');
const migrator = 'is488_im_' + suffix;
const runtime = 'is488_ir_' + suffix;
const database = 'is488_test_inbox_' + suffix;
const createdRoles: string[] = [];
let databaseCreated = false;
const sessions: SqlSession[] = [];
let admin: Client;
let data: Client;
const migrations = fileURLToPath(new URL('../../../migrations', import.meta.url));
const newer = '2026-11-12T15:20:30.123900Z';
const older = '2026-11-12T15:20:30.123100Z';
const sessionFor = (student: string) => ({ userId: student, role: 'student' });

async function validate(client: Client) {
  expect(
    (
      await client.query(
        "SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory",
      )
    ).rows[0],
  ).toEqual({ host: target.host, port: target.port, directory: target.directory });
}

function connection() {
  const session = new SqlSession({ ...base, database, user: runtime });
  sessions.push(session);
  return session;
}

async function fixture(
  student = 'student-' + crypto.randomUUID(),
  projectId = crypto.randomUUID(),
) {
  await validate(data);
  await data.query(
    `INSERT INTO public.projects
    (id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at)
    VALUES ($1,'Synthetic inbox','IS488','active',now(),now(),$2,now(),now()) ON CONFLICT DO NOTHING`,
    [projectId, student],
  );
  await data.query(
    `INSERT INTO public.project_memberships
    (id,project_id,user_id,role,status,joined_at,updated_at)
    VALUES ($1,$2,$3,'collaborator','active',now(),now()) ON CONFLICT DO NOTHING`,
    [crypto.randomUUID(), projectId, student],
  );
  const session = connection();
  const reviews = new PostgresqlReviewRepository(() => session);
  const review = await reviews.createRequest({
    projectId,
    requesterId: student,
    title: 'Synthetic inbox review',
    description: 'Synthetic progress description',
  });
  const teacher = 'teacher-' + crypto.randomUUID();
  const reader = new PostgresqlReviewNotificationReader(() => session);
  return {
    student,
    projectId,
    review,
    teacher,
    reviews,
    session,
    reader,
    useCase: new ListStudentReviewNotificationsUseCase(reader),
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

async function respond(
  setup: Fixture,
  status: 'CHANGES_REQUESTED' | 'APPROVED' = 'CHANGES_REQUESTED',
  createdAt = newer,
  id = crypto.randomUUID(),
) {
  await validate(data);
  const current = await setup.reviews.findById(setup.projectId, setup.review.id);
  if (current!.status === 'CHANGES_REQUESTED')
    await setup.reviews.recordStudentResubmission(setup.projectId, setup.review.id, {
      studentId: setup.student,
      description: 'Synthetic correction progress',
    });
  const result = await setup.reviews.recordTeacherResponse(setup.projectId, setup.review.id, {
    reviewerId: setup.teacher,
    status,
    observation: 'Synthetic teacher response',
  });
  const input: InternalReviewNotificationInput = {
    projectId: setup.projectId,
    reviewId: setup.review.id,
    responseActionId: result.responseActionId,
    recipientUserId: setup.student,
    reviewerId: setup.teacher,
    status,
  };
  await data.query(
    `INSERT INTO public.internal_notifications
    (id,project_id,review_id,response_action_id,recipient_user_id,reviewer_id,response_status,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz)`,
    [
      id,
      input.projectId,
      input.reviewId,
      input.responseActionId,
      input.recipientUserId,
      input.reviewerId,
      input.status,
      createdAt,
    ],
  );
  return { id, createdAt, ...input };
}

async function remove(setup: Fixture, client = data) {
  await validate(client);
  await client.query(
    `UPDATE public.project_memberships SET status='removed',removed_at=statement_timestamp(),updated_at=statement_timestamp()
    WHERE project_id=$1 AND user_id=$2 AND status='active'`,
    [setup.projectId, setup.student],
  );
}

async function allPages(setup: Fixture, limit = 1) {
  const items: ReviewNotificationListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await setup.useCase.execute({
      session: sessionFor(setup.student),
      query: { limit, cursor },
    });
    items.push(...page.items);
    if (page.nextCursor)
      expect(decodeReviewNotificationCursor(page.nextCursor)).toEqual({
        id: page.items.at(-1)!.id,
        createdAt: page.items.at(-1)!.createdAt,
      });
    cursor = page.nextCursor ?? undefined;
  } while (cursor && items.length < 20);
  expect(cursor).toBeUndefined();
  expect(new Set(items.map((row) => row.id)).size).toBe(items.length);
  return items;
}

describe.skipIf(!enabled)('Student inbox reader: real local PostgreSQL', () => {
  beforeAll(async () => {
    admin = new Client(base);
    await admin.connect();
    await validate(admin);
    const root = fileURLToPath(new URL('../../../../../.local-dev/', import.meta.url));
    mkdirSync(root, { recursive: true });
    const evidence = mkdtempSync(join(root, 'inbox-reader-sql-'));
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
    await admin.query('REVOKE TEMPORARY ON DATABASE ' + database + ' FROM PUBLIC,' + runtime);
    await validate(admin);
    const options = {
      connection: { ...base, database, user: migrator },
      runtimeRole: runtime,
      directory: migrations,
      auditFile: join(evidence, 'migration.jsonl'),
    };
    const runnerUrl = new URL('../../../migrations/runner.ts', import.meta.url).href;
    await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { Client } from 'pg'; import { run } from ${JSON.stringify(runnerUrl)};
       const options=JSON.parse(process.argv[1]); const target=JSON.parse(process.argv[2]);
       const client=new Client({...options.connection,user:process.argv[3]}); await client.connect();
       try { const row=(await client.query("SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory")).rows[0];
         if(row.host!==target.host || row.port!==target.port || row.directory!==target.directory) throw new Error('Migration target mismatch');
       } finally { await client.end(); } await run('apply',options);`,
        JSON.stringify(options),
        JSON.stringify(target),
        base.user!,
      ],
      { timeout: 20000, windowsHide: true },
    );
    data = new Client({ ...base, database });
    await data.connect();
    await validate(data);
    console.info(
      JSON.stringify({
        suite: 'inbox-reader',
        database,
        migrator,
        runtime,
        evidence,
        target: { host: target.host, port: target.port, directory: target.directory },
      }),
    );
  }, 30000);

  beforeEach(async () => {
    await validate(admin);
    await validate(data);
  });

  afterAll(async () => {
    expect((await Promise.all(sessions.map((session) => session.close()))).every(Boolean)).toBe(
      true,
    );
    if (data) await data.end();
    if (!admin) return;
    try {
      if (databaseCreated) {
        await validate(admin);
        await admin.query('DROP DATABASE ' + database + ' WITH (FORCE)');
      }
      for (const role of createdRoles.reverse()) {
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
  }, 15000);

  it('preserves hashes, migration ledger and append-only runtime privileges', async () => {
    const catalog = JSON.parse(readFileSync(join(migrations, 'manifest.json'), 'utf8')) as {
      version: number;
      name: string;
      sha256: string;
    }[];
    for (const version of [6, 7]) {
      const entry = catalog.find((entry) => entry.version === version)!;
      expect(
        createHash('sha256')
          .update(readFileSync(join(migrations, 'sql', entry.name)))
          .digest('hex'),
      ).toBe(entry.sha256);
    }
    expect(
      (await data.query('SELECT version FROM is488_migrations.versions ORDER BY version')).rows.map(
        (row) => row.version,
      ),
    ).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const privileges = (
      await data.query(
        `SELECT privilege,has_table_privilege($1,'public.internal_notifications',privilege) AS allowed FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege`,
        [runtime],
      )
    ).rows;
    expect(privileges.filter((row) => row.allowed).map((row) => row.privilege)).toEqual([
      'SELECT',
      'INSERT',
    ]);
  });

  it('filters student, original requester and project membership before limit/lookahead', async () => {
    const setup = await fixture();
    const foreign = await fixture(undefined, setup.projectId);
    await respond(foreign);
    const hidden = await fixture(setup.student);
    await respond(hidden);
    await remove(hidden);
    const visible = await respond(setup, 'CHANGES_REQUESTED', older);
    const page = await setup.useCase.execute({
      session: sessionFor(setup.student),
      query: { limit: 1 },
    });
    expect(page.items.map((row) => row.id)).toEqual([visible.id]);
    expect(page.nextCursor).toBeNull();
    expect(
      (await foreign.useCase.execute({ session: sessionFor(foreign.student) })).items,
    ).toHaveLength(1);
    expect(
      await setup.reader.listAuthorizedForStudent({ studentId: 'unrelated', take: 2 }),
    ).toEqual([]);
  });

  it('does not substitute project creator identity for active membership', async () => {
    const setup = await fixture();
    await respond(setup);
    await remove(setup);
    expect(
      (await data.query('SELECT creator_id FROM public.projects WHERE id=$1', [setup.projectId]))
        .rows[0].creator_id,
    ).toBe(setup.student);
    expect(await setup.useCase.execute({ session: sessionFor(setup.student) })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('revalidates a previously authorized cursor and fills the next page from remaining projects', async () => {
    const setup = await fixture();
    const first = await respond(setup);
    await respond(setup, 'CHANGES_REQUESTED', older);
    const other = await fixture(setup.student);
    const visible = await respond(other, 'APPROVED', '2026-11-12T15:20:30.123000Z');
    const page = await setup.useCase.execute({
      session: sessionFor(setup.student),
      query: { limit: 1 },
    });
    expect(page.items[0]!.id).toBe(first.id);
    await remove(setup);
    const next = await setup.useCase.execute({
      session: sessionFor(setup.student),
      query: { limit: 1, cursor: page.nextCursor },
    });
    expect(next.items.map((row) => row.id)).toEqual([visible.id]);
    expect(next.nextCursor).toBeNull();
    expect(
      (
        await data.query('SELECT id FROM public.internal_notifications WHERE project_id=$1', [
          setup.projectId,
        ])
      ).rows,
    ).toHaveLength(2);
  });

  it('readmission restores historical eligibility without deleting or rewriting notifications', async () => {
    const setup = await fixture();
    const stored = await respond(setup);
    await remove(setup);
    expect(
      await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 }),
    ).toEqual([]);
    await validate(data);
    await data.query(
      `INSERT INTO public.project_memberships(id,project_id,user_id,role,status,joined_at,updated_at) VALUES($1,$2,$3,'collaborator','active',now(),now())`,
      [crypto.randomUUID(), setup.projectId, setup.student],
    );
    expect(
      (await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 })).map(
        (row) => row.id,
      ),
    ).toEqual([stored.id]);
  });

  it('a read snapshot before withdrawal commit sees prior authorization without taking a write lock; the next read revokes it', async () => {
    const setup = await fixture();
    const stored = await respond(setup);
    const writer = new Client({ ...base, database });
    await writer.connect();
    try {
      await validate(writer);
      await writer.query('BEGIN');
      await remove(setup, writer);
      expect(
        (await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 })).map(
          (row) => row.id,
        ),
      ).toEqual([stored.id]);
      await writer.query('COMMIT');
      expect(
        await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 }),
      ).toEqual([]);
    } finally {
      await writer.query('ROLLBACK');
      await writer.end();
    }
  });

  it('withdrawal committed before the SELECT snapshot excludes rows even on a reused connection', async () => {
    const setup = await fixture();
    await respond(setup);
    expect(
      await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 }),
    ).toHaveLength(1);
    await remove(setup);
    expect(
      await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 }),
    ).toEqual([]);
  });

  it('paginates microsecond-only differences before reverse UUID order and identical timestamp UUID ties without loss', async () => {
    const setup = await fixture();
    const low = crypto.randomUUID();
    const high = crypto.randomUUID();
    const ids = [low, high, crypto.randomUUID()].sort();
    const first = await respond(setup, 'CHANGES_REQUESTED', newer, ids[0]!);
    const second = await respond(setup, 'CHANGES_REQUESTED', older, ids[2]!);
    const third = await respond(setup, 'APPROVED', older, ids[1]!);
    const rows = await allPages(setup);
    expect(rows.map((row) => [row.id, row.createdAt])).toEqual([
      [first.id, newer],
      [second.id, older],
      [third.id, older],
    ]);
    expect(rows.map((row) => row.status)).toEqual([
      'CHANGES_REQUESTED',
      'CHANGES_REQUESTED',
      'APPROVED',
    ]);
    const memberships = new InMemoryMembershipRepository();
    await memberships.addMember({
      projectId: setup.projectId,
      userId: setup.student,
      role: 'collaborator',
      status: 'active',
      joinedAt: newer,
      updatedAt: newer,
      removedAt: null,
    });
    const reviews = new InMemoryReviewRepository();
    const source = await setup.reviews.findById(setup.projectId, setup.review.id);
    vi.spyOn(reviews, 'findById').mockResolvedValue(source);
    let timestamp = newer;
    const memory = new InMemoryReviewNotificationRepository(reviews, memberships, {
      now: () => new Date(),
      isoString: () => timestamp,
    });
    try {
      for (const entry of [first, second, third]) {
        timestamp = entry.createdAt;
        const uuid = vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(entry.id);
        try {
          await memory.persistAuthorized(entry);
        } finally {
          uuid.mockRestore();
        }
      }
      const memoryCase = new ListStudentReviewNotificationsUseCase(memory);
      let cursor: string | undefined;
      const equivalent: ReviewNotificationListItem[] = [];
      do {
        const page = await memoryCase.execute({
          session: sessionFor(setup.student),
          query: { limit: 1, cursor },
        });
        equivalent.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && equivalent.length < 5);
      expect(equivalent).toEqual(rows);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('newer insertions between pages do not duplicate prior items and appear on refresh', async () => {
    const setup = await fixture();
    const first = await respond(setup);
    const olderItem = await respond(setup, 'CHANGES_REQUESTED', older);
    const page = await setup.useCase.execute({
      session: sessionFor(setup.student),
      query: { limit: 1 },
    });
    expect(page.items[0]!.id).toBe(first.id);
    const inserted = await respond(setup, 'APPROVED', '2026-11-12T15:20:30.123901Z');
    const next = await setup.useCase.execute({
      session: sessionFor(setup.student),
      query: { limit: 1, cursor: page.nextCursor },
    });
    expect(next.items.map((row) => row.id)).toEqual([olderItem.id]);
    expect(next.nextCursor).toBeNull();
    expect((await allPages(setup)).map((row) => row.id)).toEqual([
      inserted.id,
      first.id,
      olderItem.id,
    ]);
  });

  it('projects exact UTC microseconds even when the SQL session uses a different timezone', async () => {
    const setup = await fixture();
    await respond(setup, 'APPROVED', older);
    const rows = await setup.session.transaction(async () => {
      await setup.session.query("SET LOCAL TIME ZONE 'Pacific/Auckland'");
      return setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 2 });
    });
    expect(rows[0]!.createdAt).toBe(older);
    expect(typeof rows[0]!.createdAt).toBe('string');
  });

  it('valid foreign and absent cursors are only positions, not authorization or existence checks', async () => {
    const setup = await fixture();
    const visible = await respond(setup, 'APPROVED', older);
    const other = await fixture();
    const foreign = await respond(other);
    for (const id of [foreign.id, crypto.randomUUID()]) {
      const page = await setup.useCase.execute({
        session: sessionFor(setup.student),
        query: { cursor: encodeReviewNotificationCursor({ id, createdAt: newer }) },
      });
      expect(page.items.map((row) => row.id)).toEqual([visible.id]);
    }
  });

  it('keeps two corrections and approval historical after teacher reassignment', async () => {
    const setup = await fixture();
    await respond(setup, 'CHANGES_REQUESTED', older);
    await respond(setup);
    const approval = await respond(setup, 'APPROVED', '2026-11-12T15:20:30.123901Z');
    await validate(data);
    await data.query(
      'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
      [setup.teacher, setup.projectId],
    );
    await data.query('DELETE FROM public.teacher_project_assignments WHERE project_id=$1', [
      setup.projectId,
    ]);
    await data.query(
      'INSERT INTO public.teacher_project_assignments(teacher_user_id,project_id) VALUES($1,$2)',
      ['replacement-' + crypto.randomUUID(), setup.projectId],
    );
    const rows = await allPages(setup);
    expect(rows.map((row) => row.status)).toEqual([
      'APPROVED',
      'CHANGES_REQUESTED',
      'CHANGES_REQUESTED',
    ]);
    expect(rows[0]!.responseActionId).toBe(approval.responseActionId);
    expect(new Set(rows.map((row) => row.responseActionId)).size).toBe(3);
    expect((await setup.reviews.findById(setup.projectId, setup.review.id))!.status).toBe(
      'APPROVED',
    );
  });

  it('uses the existing request SQL scope and leaves all business rows unchanged', async () => {
    const setup = await fixture();
    await respond(setup);
    const tables = [
      'projects',
      'project_memberships',
      'teacher_project_assignments',
      'teacher_review_requests',
      'teacher_review_actions',
      'internal_notifications',
    ];
    async function snapshot() {
      const snapshots: unknown[] = [];
      for (const table of tables) {
        const result = await data.query(
          `SELECT coalesce(jsonb_agg(row ORDER BY row::text),'[]'::jsonb) AS rows FROM (SELECT to_jsonb(entry) AS row FROM public.${table} entry) entries`,
        );
        snapshots.push(result.rows[0].rows);
      }
      return snapshots;
    }
    const before = await snapshot();
    const reader = new PostgresqlReviewNotificationReader();
    const result = await sqlRequestScope.run(setup.session, () =>
      reader.listAuthorizedForStudent({ studentId: setup.student, take: 21 }),
    );
    expect(result).toHaveLength(1);
    expect(Object.keys(result[0]!).sort()).toEqual([
      'createdAt',
      'id',
      'projectId',
      'responseActionId',
      'reviewId',
      'status',
    ]);
    expect(await snapshot()).toEqual(before);
  });

  it('a real SELECT privilege failure returns a sanitized error, not empty or partial data, without repairing rows', async () => {
    const setup = await fixture();
    await respond(setup);
    await respond(setup, 'APPROVED', older);
    const before = (
      await data.query('SELECT to_jsonb(n) AS row FROM public.internal_notifications n ORDER BY id')
    ).rows;
    await validate(data);
    await data.query('REVOKE SELECT ON public.internal_notifications FROM ' + runtime);
    try {
      await expect(
        setup.useCase.execute({ session: sessionFor(setup.student) }),
      ).rejects.toMatchObject({ statusCode: 500, message: 'Unable to read review notifications' });
      expect(
        (
          await data.query(
            'SELECT to_jsonb(n) AS row FROM public.internal_notifications n ORDER BY id',
          )
        ).rows,
      ).toEqual(before);
    } finally {
      await validate(data);
      await data.query('GRANT SELECT ON public.internal_notifications TO ' + runtime);
    }
    expect(
      await setup.reader.listAuthorizedForStudent({ studentId: setup.student, take: 3 }),
    ).toHaveLength(2);
  });
});
