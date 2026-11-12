import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Client, type ClientConfig } from 'pg';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { InternalReviewNotificationInput } from '@is488/shared';
import { notificationSqlTestTarget } from '../../testing/notification-sql-test-config.js';
import { PostgresqlReviewRepository } from './review.repository.js';
import { PostgresqlInternalReviewNotificationRepository } from './internal-review-notification.repository.js';
import { PersistenceTransactionError, SqlSession } from './session.js';

const enabled = process.env.IS488_NOTIFICATION_SQL_TEST === '1';
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
const migrator = 'is488_nm_' + suffix;
const runtime = 'is488_nr_' + suffix;
const database = 'is488_test_notifications_' + suffix;
const upgradeDatabase = 'is488_test_upgrade_' + suffix;
const createdDatabases: string[] = [];
const createdRoles: string[] = [];
const sessions: SqlSession[] = [];
let admin: Client;
let data: Client;
let evidence: string;
let directory: string;
let upgradeDirectory: string;

async function validate(client: Client) {
  const identity = (
    await client.query(
      "SELECT host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting('data_directory') AS directory",
    )
  ).rows[0];
  expect(identity).toEqual({ host: target.host, port: target.port, directory: target.directory });
}

function session() {
  const connection = new SqlSession({ ...base, database, user: runtime });
  sessions.push(connection);
  return connection;
}

async function fixture(connection = session()) {
  const projectId = crypto.randomUUID();
  const student = 'student-' + crypto.randomUUID();
  const teacher = 'teacher-' + crypto.randomUUID();
  await data.query(
    `INSERT INTO public.projects
    (id,title,course_code,status,start_date,target_date,creator_id,created_at,updated_at)
    VALUES ($1,'Synthetic notifications','IS488','active',now(),now(),$2,now(),now())`,
    [projectId, student],
  );
  await data.query(
    `INSERT INTO public.project_memberships
    (id,project_id,user_id,role,status,joined_at,updated_at)
    VALUES ($1,$2,$3,'owner','active',now(),now())`,
    [crypto.randomUUID(), projectId, student],
  );
  const reviews = new PostgresqlReviewRepository(() => connection);
  const review = await reviews.createRequest({
    projectId,
    requesterId: student,
    title: 'Review notification',
    description: 'Synthetic progress description',
  });
  const response = await reviews.recordTeacherResponse(projectId, review.id, {
    reviewerId: teacher,
    status: 'CHANGES_REQUESTED',
    observation: 'Synthetic teacher observation',
  });
  const input: InternalReviewNotificationInput = {
    projectId,
    reviewId: review.id,
    recipientUserId: student,
    reviewerId: teacher,
    status: 'CHANGES_REQUESTED',
    responseActionId: response.responseActionId,
  };
  return { input, reviews, connection };
}

async function rows(input: InternalReviewNotificationInput) {
  return (
    await data.query('SELECT * FROM public.internal_notifications WHERE response_action_id=$1', [
      input.responseActionId,
    ])
  ).rows;
}

async function remove(client: Client, input: InternalReviewNotificationInput) {
  await client.query(
    `UPDATE public.project_memberships SET status='removed',
    updated_at=statement_timestamp(),removed_at=statement_timestamp()
    WHERE project_id=$1 AND user_id=$2 AND status='active'`,
    [input.projectId, input.recipientUserId],
  );
}

function latch() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function waitForLock(pid: number) {
  const deadline = Date.now() + 1500;
  while (Date.now() < deadline) {
    const blocked = (
      await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid])
    ).rows[0];
    if (blocked?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Expected PostgreSQL lock wait was not observed');
}

describe.skipIf(!enabled)('Internal review notifications: authorized local PostgreSQL', () => {
  beforeAll(async () => {
    admin = new Client(base);
    await admin.connect();
    await validate(admin);
    evidence = mkdtempSync(join(tmpdir(), 'is488-notification-sql-'));
    directory = fileURLToPath(new URL('../../../migrations', import.meta.url));
    upgradeDirectory = join(evidence, 'catalog-six');
    mkdirSync(join(upgradeDirectory, 'sql'), { recursive: true });
    const catalog = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as {
      version: number;
      name: string;
    }[];
    writeFileSync(
      join(upgradeDirectory, 'manifest.json'),
      JSON.stringify(catalog.filter((entry) => entry.version <= 6)),
    );
    for (const entry of catalog.filter((entry) => entry.version <= 6)) {
      copyFileSync(join(directory, 'sql', entry.name), join(upgradeDirectory, 'sql', entry.name));
    }
    for (const role of [migrator, runtime]) {
      await admin.query(
        'CREATE ROLE ' + role + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
      createdRoles.push(role);
    }
    for (const name of [database, upgradeDatabase]) {
      await validate(admin);
      await admin.query('CREATE DATABASE ' + name + ' OWNER ' + migrator);
      createdDatabases.push(name);
      await admin.query('REVOKE TEMPORARY ON DATABASE ' + name + ' FROM PUBLIC,' + runtime);
    }
    await migrate(database);
    await migrate(upgradeDatabase, upgradeDirectory);
    data = new Client({ ...base, database });
    await data.connect();
    await validate(data);
  }, 30000);

  beforeEach(async () => {
    await validate(admin);
    await validate(data);
  });

  async function migrate(name: string, catalogDirectory = directory) {
    await validate(admin);
    const options = {
      connection: { ...base, database: name, user: migrator },
      runtimeRole: runtime,
      auditFile: join(evidence, name + '.jsonl'),
      directory: catalogDirectory,
    };
    const runnerUrl = new URL('../../../migrations/runner.ts', import.meta.url).href;
    await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { run } from ${JSON.stringify(runnerUrl)}; await run('apply', JSON.parse(process.argv[1]));`,
        JSON.stringify(options),
      ],
      { timeout: 20000, windowsHide: true },
    );
  }

  afterAll(async () => {
    await Promise.all(sessions.map((connection) => connection.close()));
    if (data) await data.end();
    if (!admin) return;
    try {
      await validate(admin);
      for (const name of createdDatabases)
        await admin.query('DROP DATABASE ' + name + ' WITH (FORCE)');
      for (const role of createdRoles.reverse()) await admin.query('DROP ROLE ' + role);
    } finally {
      await admin.end();
    }
  }, 15000);

  it('migrates from empty and from 0006, and reapplies without ledger changes', async () => {
    await migrate(upgradeDatabase);
    for (const name of [database, upgradeDatabase]) {
      const client = new Client({ ...base, database: name, user: migrator });
      await client.connect();
      try {
        await validate(admin);
        const before = (
          await client.query('SELECT * FROM is488_migrations.versions ORDER BY version')
        ).rows;
        expect(before.map((entry) => entry.version)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        await migrate(name);
        expect(
          (await client.query('SELECT * FROM is488_migrations.versions ORDER BY version')).rows,
        ).toEqual(before);
      } finally {
        await client.end();
      }
    }
  }, 20000);

  it('grants only SELECT and INSERT; runtime cannot mutate notifications or the ledger', async () => {
    const checks = (
      await data.query(
        `SELECT privilege,has_table_privilege($1,'public.internal_notifications',privilege) AS allowed
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege`,
        [runtime],
      )
    ).rows;
    expect(
      checks
        .filter((entry) => entry.allowed)
        .map((entry) => entry.privilege)
        .sort(),
    ).toEqual(['INSERT', 'SELECT']);
    const connection = session();
    await expect(
      connection.query('DELETE FROM public.internal_notifications'),
    ).rejects.toMatchObject({ sqlState: '42501' });
    await expect(connection.query('SELECT * FROM is488_migrations.versions')).rejects.toMatchObject(
      { sqlState: '42501' },
    );
  });

  it('stores minimal metadata and resolves an authorized original requester', async () => {
    const { input, connection } = await fixture();
    const repository = new PostgresqlInternalReviewNotificationRepository(() => connection);
    const payload = { ...input, recipientUserIds: [input.recipientUserId] };
    expect(await repository.resolve(payload)).toMatchObject({
      requesterHasActiveMembership: true,
      requesterCanQueryReview: true,
    });
    await repository.persistAuthorized(input);
    const stored = await rows(input);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      recipient_user_id: input.recipientUserId,
      response_action_id: input.responseActionId,
      project_id: input.projectId,
      review_id: input.reviewId,
      response_status: input.status,
    });
    expect(stored[0]).not.toHaveProperty('comment');
  });

  it.each(['recipient', 'project', 'review', 'teacher', 'status', 'missing action'])(
    'rejects mismatched %s before insert',
    async (field) => {
      const { input, connection } = await fixture();
      const invalid = { ...input };
      if (field === 'recipient') {
        invalid.recipientUserId = 'other-student';
        await data.query(
          `INSERT INTO public.project_memberships
          (id,project_id,user_id,role,status,joined_at,updated_at)
          VALUES ($1,$2,$3,'collaborator','active',now(),now())`,
          [crypto.randomUUID(), input.projectId, invalid.recipientUserId],
        );
      }
      if (field === 'project') invalid.projectId = (await fixture()).input.projectId;
      if (field === 'review') invalid.reviewId = crypto.randomUUID();
      if (field === 'teacher') invalid.reviewerId = 'other-teacher';
      if (field === 'status') invalid.status = 'APPROVED';
      if (field === 'missing action') invalid.responseActionId = crypto.randomUUID();
      await expect(
        new PostgresqlInternalReviewNotificationRepository(() => connection).persistAuthorized(
          invalid,
        ),
      ).rejects.toMatchObject({ outcome: 'rolled_back' });
      expect(await rows(input)).toEqual([]);
    },
  );

  it('revalidates membership after a previously authorized context', async () => {
    const { input, connection } = await fixture();
    const repository = new PostgresqlInternalReviewNotificationRepository(() => connection);
    expect(
      await repository.resolve({ ...input, recipientUserIds: [input.recipientUserId] }),
    ).not.toBeNull();
    await remove(data, input);
    await expect(repository.persistAuthorized(input)).rejects.toMatchObject({
      outcome: 'rolled_back',
    });
    expect(await rows(input)).toEqual([]);
    expect(
      await repository.resolve({ ...input, recipientUserIds: [input.recipientUserId] }),
    ).toMatchObject({ requesterHasActiveMembership: false, requesterCanQueryReview: false });
  });

  it('deduplicates sequential and concurrent delivery without changing identity or timestamp', async () => {
    const { input, connection } = await fixture();
    const repository = new PostgresqlInternalReviewNotificationRepository(() => connection);
    await Promise.all(
      Array.from({ length: 4 }, () =>
        new PostgresqlInternalReviewNotificationRepository(() => session()).persistAuthorized(
          input,
        ),
      ),
    );
    const before = await rows(input);
    expect(before).toHaveLength(1);
    await repository.persistAuthorized(input);
    await repository.persistAuthorized(input);
    expect(await rows(input)).toEqual(before);
  });

  it('retains two different CHANGES_REQUESTED responses and the historical source after approval', async () => {
    const { input, reviews, connection } = await fixture();
    const repository = new PostgresqlInternalReviewNotificationRepository(() => connection);
    await reviews.recordStudentResubmission(input.projectId, input.reviewId, {
      studentId: input.recipientUserId,
      description: 'Synthetic adjustments',
    });
    const second = await reviews.recordTeacherResponse(input.projectId, input.reviewId, {
      reviewerId: input.reviewerId,
      status: 'CHANGES_REQUESTED',
      observation: 'More synthetic adjustments',
    });
    await reviews.recordStudentResubmission(input.projectId, input.reviewId, {
      studentId: input.recipientUserId,
      description: 'Final adjustments',
    });
    await reviews.recordTeacherResponse(input.projectId, input.reviewId, {
      reviewerId: input.reviewerId,
      status: 'APPROVED',
      observation: 'Approved synthetic progress',
    });
    await repository.persistAuthorized(input);
    await repository.persistAuthorized({ ...input, responseActionId: second.responseActionId });
    expect(await rows(input)).toHaveLength(1);
    expect(await rows({ ...input, responseActionId: second.responseActionId })).toHaveLength(1);
    expect(second.responseActionId).not.toBe(input.responseActionId);
  });

  it('enforces foreign-key source integrity even on direct runtime inserts', async () => {
    const { input, connection } = await fixture();
    await expect(
      connection.query(
        `INSERT INTO public.internal_notifications
      (recipient_user_id,project_id,review_id,response_action_id,reviewer_id,response_status)
      VALUES ($1,$2,$3,$4,$5,'APPROVED')`,
        [
          input.recipientUserId,
          input.projectId,
          input.reviewId,
          input.responseActionId,
          input.reviewerId,
        ],
      ),
    ).rejects.toMatchObject({ sqlState: '23503' });
    expect(await rows(input)).toEqual([]);
  });

  it('does not accept an uncommitted or non-teacher source action', async () => {
    const { input, connection } = await fixture();
    const writer = new Client({ ...base, database });
    await writer.connect();
    const actionId = crypto.randomUUID();
    try {
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO public.teacher_review_actions
        (id,review_request_id,sequence_number,actor_id,actor_role,action_type,status,comment)
        VALUES ($1,$2,2,$3,'teacher','TEACHER_RESPONSE','CHANGES_REQUESTED','Synthetic response')`,
        [actionId, input.reviewId, input.reviewerId],
      );
      const repository = new PostgresqlInternalReviewNotificationRepository(() => connection);
      await expect(
        repository.persistAuthorized({ ...input, responseActionId: actionId }),
      ).rejects.toMatchObject({ outcome: 'rolled_back' });
      expect(await rows({ ...input, responseActionId: actionId })).toEqual([]);
      await writer.query('COMMIT');
      await repository.persistAuthorized({ ...input, responseActionId: actionId });
      expect(await rows({ ...input, responseActionId: actionId })).toHaveLength(1);
      const studentAction = crypto.randomUUID();
      await writer.query(
        `INSERT INTO public.teacher_review_actions
        (id,review_request_id,sequence_number,actor_id,actor_role,action_type,status,comment)
        VALUES ($1,$2,3,$3,'student','STUDENT_RESUBMISSION','PENDING','Synthetic adjustments')`,
        [studentAction, input.reviewId, input.recipientUserId],
      );
      await expect(
        repository.persistAuthorized({ ...input, responseActionId: studentAction }),
      ).rejects.toMatchObject({ outcome: 'rolled_back' });
      expect(await rows({ ...input, responseActionId: studentAction })).toEqual([]);
    } finally {
      await writer.query('ROLLBACK');
      await writer.end();
    }
  });

  it.each(['after_authorization', 'after_insert'] as const)(
    'rolls back a fault at %s without partial rows',
    async (stage) => {
      const { input, connection } = await fixture();
      const fault = vi.fn(async (current: string) => {
        if (current === stage) throw new Error('Injected write failure');
      });
      await expect(
        new PostgresqlInternalReviewNotificationRepository(
          () => connection,
          fault,
        ).persistAuthorized(input),
      ).rejects.toMatchObject({ outcome: 'rolled_back' });
      expect(await rows(input)).toEqual([]);
      expect(
        (
          await new PostgresqlReviewRepository(() => connection).findById(
            input.projectId,
            input.reviewId,
          )
        )?.actions,
      ).toHaveLength(1);
      expect(fault.mock.calls.filter(([current]) => current === stage)).toHaveLength(1);
    },
  );

  it.each(['commit', 'rollback'])(
    'classifies lost %s confirmation as unknown without automatic repetition',
    async (stage) => {
      const { input } = await fixture();
      class LostConfirmationSession extends SqlSession {
        override async transaction<T>(work: () => Promise<T>): Promise<T> {
          try {
            await super.transaction(async () => {
              const result = await work();
              if (stage === 'rollback') throw new Error('Injected rollback');
              return result;
            });
          } catch {
            throw new PersistenceTransactionError('unknown');
          }
          throw new PersistenceTransactionError('unknown');
        }
      }
      const connection = new LostConfirmationSession({ ...base, database, user: runtime });
      sessions.push(connection);
      const repository = new PostgresqlInternalReviewNotificationRepository(() => connection);
      const transaction = vi.spyOn(connection, 'transaction');
      await expect(repository.persistAuthorized(input)).rejects.toMatchObject({
        outcome: 'unknown',
      });
      const calls = transaction.mock.calls.length;
      await expect(repository.persistAuthorized(input)).rejects.toMatchObject({
        outcome: 'unknown',
      });
      expect(transaction).toHaveBeenCalledTimes(calls);
      expect(await rows(input)).toHaveLength(stage === 'commit' ? 1 : 0);
    },
  );

  it('keeps confirmed insertion distinct from a simulated close failure', async () => {
    const { input, connection } = await fixture();
    await new PostgresqlInternalReviewNotificationRepository(() => connection).persistAuthorized(
      input,
    );
    const close = vi.spyOn(connection, 'close').mockResolvedValueOnce(false);
    expect(await connection.close()).toBe(false);
    expect(await rows(input)).toHaveLength(1);
    close.mockRestore();
  });

  it('withdrawal committed first blocks and then rejects storage', async () => {
    const { input, connection } = await fixture();
    const pid = Number((await connection.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
    const writer = new Client({ ...base, database });
    await writer.connect();
    try {
      await writer.query('BEGIN');
      await remove(writer, input);
      const pending = new PostgresqlInternalReviewNotificationRepository(
        () => connection,
      ).persistAuthorized(input);
      const rejected = expect(pending).rejects.toMatchObject({ outcome: 'rolled_back' });
      await waitForLock(pid);
      await writer.query('COMMIT');
      await rejected;
      expect(await rows(input)).toEqual([]);
    } finally {
      await writer.query('ROLLBACK');
      await writer.end();
    }
  });

  it('storage locks active membership until commit; later withdrawal does not erase the record', async () => {
    const { input, connection } = await fixture();
    const entered = latch();
    const release = latch();
    const writer = new Client({ ...base, database });
    await writer.connect();
    const pid = Number((await writer.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid);
    const repository = new PostgresqlInternalReviewNotificationRepository(
      () => connection,
      async (stage) => {
        if (stage === 'after_insert') {
          entered.release();
          await release.promise;
        }
      },
    );
    const pending = repository.persistAuthorized(input);
    try {
      await entered.promise;
      const withdrawal = remove(writer, input);
      await waitForLock(pid);
      release.release();
      await pending;
      await withdrawal;
      expect(await rows(input)).toHaveLength(1);
    } finally {
      release.release();
      await pending.catch(() => {});
      await writer.end();
    }
  });
});
