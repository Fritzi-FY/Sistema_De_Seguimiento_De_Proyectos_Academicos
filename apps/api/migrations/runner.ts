import type { TLSSocket } from 'node:tls';
import {
  prepareConnection,
  verifyIdentity,
  verifyExternalTls,
  type RemoteProfile,
} from './remote-profile.ts';
import {
  grantRuntime,
  verifyRuntime,
  verifyPrincipals,
  RuntimePrivilegesError,
} from './runtime-privileges.ts';
import { Client, type ClientConfig } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

export const LOCK = [488, 2002] as const;
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const ident = (value: string) => {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) throw new Error('Invalid role identifier');
  return '"' + value + '"';
};
export type Options = {
  remoteProfile?: RemoteProfile;
  connection: ClientConfig;
  runtimeRole: string;
  auditFile: string;
  directory?: string;
  lockMs?: number;
  statementMs?: number;
};
type Migration = { version: number; name: string; sha256: string; sql: string };
type Row = { version: number; name: string; checksum: string; fingerprint: string };
type Event = {
  target: string;
  attempt: string;
  event: string;
  version?: number;
  checksum?: string;
};
export type SafeFailure = {
  stage: string;
  errorType: string;
  sqlState?: string;
  transportCode?: string;
  at: string;
};
type Timings = {
  beginDispatchedAt?: string;
  beginConfirmedAt?: string;
  preparationStartedAt?: string;
  preparationFinishedAt?: string;
  preparationMs?: number;
  commitDispatchedAt?: string;
  commitConfirmedAt?: string;
  commitMs?: number;
  transactionMs?: number;
  auditMs: number;
  phases: { stage: string; startedAt: string; elapsedMs: number }[];
};
function safeFailure(error: unknown, stage: string): SafeFailure {
  const e = error as { code?: unknown; name?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const name = error instanceof Error ? error.constructor.name : '';
  const transport = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'EPIPE',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ERR_STREAM_DESTROYED',
  ].includes(code);
  return {
    stage,
    errorType: [
      'Error',
      'DatabaseError',
      'TypeError',
      'MigrationError',
      'RuntimePrivilegesError',
      'AggregateError',
      'TimeoutError',
    ].includes(name)
      ? name
      : 'Error',
    ...(/^[0-9A-Z]{5}$/.test(code) && !transport ? { sqlState: code } : {}),
    ...(transport ? { transportCode: code } : {}),
    at: new Date().toISOString(),
  };
}
export class MigrationError extends Error {
  outcome: string;
  diagnostic?: SafeFailure;
  sessionError?: SafeFailure;
  transportError?: SafeFailure;
  rollbackError?: SafeFailure;
  closeError?: SafeFailure;
  auditError?: SafeFailure;
  transactionOutcome = 'not_started';
  closeConfirmed = false;
  timings?: Timings;
  constructor(outcome: string) {
    super(outcome);
    this.name = 'MigrationError';
    this.outcome = outcome;
  }
}
export function catalog(directory = dirname(fileURLToPath(import.meta.url))): Migration[] {
  const manifest: unknown = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest) || !manifest.length) throw new MigrationError('invalid_catalog');
  const migrations = manifest.map((m, i) => {
    if (
      m.version !== i + 1 ||
      !/^\d{4}_[a-z0-9_]+\.sql$/.test(m.name) ||
      !m.name.startsWith(String(m.version).padStart(4, '0') + '_') ||
      !/^[a-f0-9]{64}$/.test(m.sha256)
    )
      throw new MigrationError('invalid_catalog');
    const bytes = readFileSync(join(directory, 'sql', m.name));
    if (hash(bytes) !== m.sha256) throw new MigrationError('catalog_checksum_mismatch');
    const sql = bytes.toString('utf8');
    // The local runner supports only reviewed, transactional DDL, not procedural SQL.
    if (
      /\b(begin|commit|rollback|savepoint|release|prepare|vacuum|concurrently|set|reset|discard|grant|revoke|copy|do|call|function|procedure|extension)\b/i.test(
        sql,
      )
    )
      throw new MigrationError('unsupported_migration_sql');
    if (
      /\b(create|alter|drop)\s+(schema|database|role|user|function|procedure|extension)\b/i.test(
        sql,
      )
    )
      throw new MigrationError('unsupported_migration_sql');
    return { ...m, sql } as Migration;
  });
  if (
    readdirSync(join(directory, 'sql')).sort().join() !==
    migrations
      .map((m) => m.name)
      .sort()
      .join()
  )
    throw new MigrationError('unlisted_migration');
  return migrations;
}
function audit(options: Options) {
  const c = options.connection;
  const identity = [c.host, c.port, c.database, c.user, options.runtimeRole];
  const target = hash(
    JSON.stringify(
      options.remoteProfile
        ? [...identity, options.remoteProfile.projectId, options.remoteProfile.branchId]
        : identity,
    ),
  );
  const attempt = randomUUID();
  let history: Event[] = [];
  try {
    history = readFileSync(options.auditFile, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new MigrationError('audit_invalid');
  }
  const fd = openSync(options.auditFile, 'a', 0o600);
  const emit = (event: string, migration?: Migration, detail: Record<string, unknown> = {}) => {
    const data: Event & { time: string } = {
      target,
      attempt,
      event,
      time: new Date().toISOString(),
      ...(migration ? { version: migration.version, checksum: migration.sha256 } : {}),
      ...detail,
    };
    const bytes = Buffer.from(JSON.stringify(data) + '\n');
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(fd, bytes, offset, bytes.length - offset);
      if (!written) throw new MigrationError('audit_write_failed');
      offset += written;
    }
    fsyncSync(fd);
  };
  const pending = history.filter(
    (e) =>
      e.target === target &&
      e.event === 'transaction_dispatch' &&
      !history.some(
        (x) =>
          x.target === target &&
          x.attempt === e.attempt &&
          x.version === e.version &&
          ['commit_confirmed', 'rollback_confirmed'].includes(x.event),
      ) &&
      !history.some(
        (x) =>
          x.target === target &&
          x.version === e.version &&
          x.checksum === e.checksum &&
          x.event === 'reconciled_applied',
      ),
  );
  return { emit, pending, close: () => closeSync(fd) };
}
async function fingerprint(client: Client): Promise<string> {
  const result = await client.query(`
    SELECT kind, identity, definition FROM (
      SELECT 'relation' AS kind, n.nspname||'.'||c.relname AS identity, c.relkind::text AS definition
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public'
      UNION ALL
      SELECT 'column', c.relname||'.'||a.attname, concat_ws('|',a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid))
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped
      UNION ALL
      SELECT 'constraint', c.relname||'.'||k.conname, pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
      UNION ALL
      SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname='public'
    ) objects ORDER BY kind,identity,definition`);
  return hash(JSON.stringify(result.rows));
}
async function inspect(client: Client, migrations: Migration[], runtime: string): Promise<Row[]> {
  const exists = await client.query("SELECT to_regclass('is488_migrations.versions') AS ledger");
  if (!exists.rows[0].ledger) {
    const objects = await client.query(`SELECT
      EXISTS(SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public','information_schema')) OR
      EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public') OR
      EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public') OR
      EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public') OR
      EXISTS(SELECT 1 FROM pg_extension WHERE extname<>'plpgsql') AS occupied`);
    if (objects.rows[0].occupied) throw new MigrationError('baseline_required');
    return [];
  }
  const rows: Row[] = (
    await client.query(
      'SELECT version,name,checksum,fingerprint FROM is488_migrations.versions ORDER BY version',
    )
  ).rows;
  if (!rows.length) throw new MigrationError('invalid_ledger');
  rows.forEach((r, i) => {
    const m = migrations[i];
    if (!m || r.version !== m.version || r.name !== m.name || r.checksum !== m.sha256)
      throw new MigrationError('ledger_mismatch');
  });
  await verifyRuntime(client, runtime, Math.max(...rows.map((r) => r.version)));
  if (rows.at(-1)!.fingerprint !== (await fingerprint(client)))
    throw new MigrationError('schema_drift');
  return rows;
}
export async function run(mode: 'plan' | 'apply' | 'reconcile', options: Options) {
  const c = options.connection;
  let connection: ClientConfig;
  try {
    connection = prepareConnection(c, options.runtimeRole, options.remoteProfile);
  } catch (error) {
    throw new MigrationError((error as Error).message);
  }
  ident(options.runtimeRole);
  const lockMs = options.lockMs ?? 2000,
    statementMs = options.statementMs ?? 5000;
  if (![lockMs, statementMs].every((n) => Number.isInteger(n) && n >= 50 && n <= 30000))
    throw new MigrationError('invalid_deadline');
  const migrations = catalog(options.directory);
  const evidence = audit(options);
  let connected = false,
    locked = false,
    closeConfirmed = false;
  let outcome = 'rejected';
  let stage = 'preflight';
  let transactionOutcome = 'not_started';
  let primaryFailure: MigrationError | undefined;
  let operationError: SafeFailure | undefined;
  let sessionError: SafeFailure | undefined;
  let transportError: SafeFailure | undefined;
  let rollbackError: SafeFailure | undefined;
  let closeError: SafeFailure | undefined;
  let auditError: SafeFailure | undefined;
  let timings: Timings = { auditMs: 0, phases: [] };
  const emit = (event: string, migration?: Migration, detail: Record<string, unknown> = {}) => {
    const start = performance.now();
    try {
      evidence.emit(event, migration, detail);
    } finally {
      timings.auditMs += performance.now() - start;
    }
  };
  const phase = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    stage = name;
    const start = performance.now(),
      startedAt = new Date().toISOString();
    try {
      return await work();
    } finally {
      timings.phases.push({ stage: name, startedAt, elapsedMs: performance.now() - start });
    }
  };
  const applied: number[] = [];
  const client = new Client({
    ...connection,
    connectionTimeoutMillis: 3000,
    statement_timeout: statementMs,
    lock_timeout: lockMs,
    query_timeout: statementMs + 1000,
    application_name: 'is488-product-migrator',
    options: '-c search_path=pg_catalog,public',
  });
  client.on('error', (error) => {
    const safe = safeFailure(error, stage);
    if (!sessionError || (!sessionError.sqlState && safe.sqlState)) sessionError = safe;
    if (!safe.sqlState && !transportError) transportError = safe;
  });
  try {
    if (mode === 'apply' && evidence.pending.length)
      throw new MigrationError('reconciliation_required');
    emit('session_start');
    await phase('connect', () => client.connect());
    connected = true;
    const externalTls = options.remoteProfile
      ? verifyExternalTls(
          (client as unknown as { connection: { stream: TLSSocket } }).connection.stream,
          options.remoteProfile.host,
        )
      : undefined;
    const endpoint = await client.query(
      `SELECT host(inet_server_addr()) AS address, current_database() AS database, session_user AS actor, current_user AS effective,current_setting('server_version_num')::int AS version,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`,
    );
    try {
      verifyIdentity(endpoint.rows[0], c, options.remoteProfile, externalTls);
    } catch (error) {
      throw new MigrationError((error as Error).message);
    }
    await client.query('SET search_path TO pg_catalog, public');
    await client.query(`SET statement_timeout TO ${lockMs}`);
    try {
      await client.query('SELECT pg_advisory_lock($1,$2)', [...LOCK]);
      locked = true;
    } catch {
      throw new MigrationError('lock_timeout');
    }
    await client.query(`SET statement_timeout TO ${statementMs}`);

    await verifyPrincipals(client, options.runtimeRole);
    const rows = await inspect(client, migrations, options.runtimeRole);
    const pending = migrations.slice(rows.length);
    if (mode === 'reconcile') {
      for (const attempt of evidence.pending) {
        const m = migrations.find(
          (m) => m.version === attempt.version && m.sha256 === attempt.checksum,
        );
        if (!m) throw new MigrationError('reconciliation_catalog_mismatch');
        emit(
          rows.some((r) => r.version === m.version) ? 'reconciled_applied' : 'reconciled_absent',
          m,
        );
      }
      outcome = 'observed';
    } else if (mode === 'plan') {
      outcome = 'planned';
    } else {
      for (const m of pending) {
        let commitDispatched = false,
          commitConfirmed = false,
          begun = false;
        timings = { auditMs: 0, phases: [] };
        transactionOutcome = 'not_started';
        stage = 'transaction_audit';
        emit('transaction_dispatch', m);
        let transactionStart = performance.now(),
          preparationStart = 0,
          commitStart = 0;
        try {
          timings.beginDispatchedAt = new Date().toISOString();
          transactionStart = performance.now();
          await phase('begin', () => client.query('BEGIN'));
          begun = true;
          transactionOutcome = 'active';
          timings.beginConfirmedAt = new Date().toISOString();
          timings.preparationStartedAt = new Date().toISOString();
          preparationStart = performance.now();
          await phase('transaction_timeout', () =>
            client.query("SET LOCAL transaction_timeout = '15s'"),
          );
          stage = 'ledger_setup';
          if (m.version === 1) {
            await client.query('CREATE SCHEMA is488_migrations');
            await client.query(`CREATE TABLE is488_migrations.versions (
              version integer PRIMARY KEY, name text NOT NULL UNIQUE, checksum text NOT NULL,
              fingerprint text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp(), runner text NOT NULL)`);
            await client.query(
              'REVOKE ALL ON SCHEMA is488_migrations FROM PUBLIC,' + ident(options.runtimeRole),
            );
            await client.query(
              'REVOKE ALL ON is488_migrations.versions FROM PUBLIC,' + ident(options.runtimeRole),
            );
          }
          await phase('migration_sql', () => client.query(m.sql));
          await phase('grant_runtime', () => grantRuntime(client, options.runtimeRole, m.version));
          await phase('validate_runtime', () =>
            verifyRuntime(client, options.runtimeRole, m.version),
          );
          const schemaFingerprint = await phase('catalog_fingerprint', () => fingerprint(client));
          await phase('ledger_insert', () =>
            client.query(
              'INSERT INTO is488_migrations.versions(version,name,checksum,fingerprint,runner) VALUES($1,$2,$3,$4,$5)',
              [m.version, m.name, m.sha256, schemaFingerprint, 'is488-local-v1'],
            ),
          );
          timings.preparationFinishedAt = new Date().toISOString();
          timings.preparationMs = performance.now() - preparationStart;
          stage = 'commit_audit';
          emit('commit_dispatch', m, { timings });
          commitDispatched = true;
          timings.commitDispatchedAt = new Date().toISOString();
          commitStart = performance.now();
          await phase('commit', () => client.query('COMMIT'));
          timings.commitMs = performance.now() - commitStart;
          timings.commitConfirmedAt = new Date().toISOString();
          commitConfirmed = true;
          transactionOutcome = 'committed';
          outcome = 'committed';
          stage = 'commit_confirmation_audit';
          emit('commit_confirmed', m, { timings });
          applied.push(m.version);
        } catch (error) {
          operationError = safeFailure(error, stage);
          if (operationError.transportCode && !transportError) transportError = operationError;
          if (preparationStart && timings.preparationMs === undefined)
            timings.preparationMs = performance.now() - preparationStart;
          if (commitStart && timings.commitMs === undefined)
            timings.commitMs = performance.now() - commitStart;
          if (commitDispatched) {
            if (commitConfirmed) {
              outcome = 'committed';
              throw new MigrationError('confirmed_commit_audit_failed');
            }
            outcome = 'unknown';
            transactionOutcome = 'unknown';
            throw new MigrationError('commit_unknown');
          }
          if (begun) {
            try {
              await phase('rollback', () => client.query('ROLLBACK'));
            } catch (error) {
              rollbackError = safeFailure(error, 'rollback');
              outcome = 'unknown';
              transactionOutcome = 'unknown';
              throw new MigrationError('rollback_unknown');
            }
            outcome = 'rolled_back';
            transactionOutcome = 'rolled_back';
            emit('rollback_confirmed', m);
          }
          throw error;
        } finally {
          timings.transactionMs = performance.now() - transactionStart;
        }
      }
      if (!pending.length) outcome = 'unchanged';
    }
    return {
      outcome,
      applied,
      pending: pending
        .filter((m) => !applied.includes(m.version))
        .map((m) => ({ version: m.version, checksum: m.sha256 })),
      observed: rows.map((r) => r.version),
      get closeConfirmed() {
        return closeConfirmed;
      },
      get transactionOutcome() {
        return transactionOutcome;
      },
      get transportError() {
        return transportError;
      },
      get closeError() {
        return closeError;
      },
      get auditError() {
        return auditError;
      },
      timings,
    };
  } catch (error) {
    primaryFailure =
      error instanceof MigrationError
        ? error
        : new MigrationError(
            error instanceof RuntimePrivilegesError
              ? error.message
              : outcome === 'rolled_back'
                ? 'migration_rolled_back'
                : 'migration_failed',
          );
    primaryFailure.diagnostic = operationError ?? safeFailure(error, stage);
    primaryFailure.sessionError = sessionError;
    primaryFailure.transportError = transportError;
    primaryFailure.rollbackError = rollbackError;
    primaryFailure.transactionOutcome = transactionOutcome;
    primaryFailure.timings = timings;
    try {
      emit('operation_failed', undefined, {
        diagnostic: primaryFailure.diagnostic,
        sessionError,
        transportError,
        rollbackError,
        transactionOutcome,
        timings,
      });
    } catch (error) {
      auditError = safeFailure(error, 'failure_audit');
    }
    throw primaryFailure;
  } finally {
    // Closing an unknown transaction only releases transport; it is not a compensating rollback.
    if (locked && outcome !== 'unknown') {
      try {
        await client.query('SELECT pg_advisory_unlock($1,$2)', [...LOCK]);
      } catch (error) {
        if (!transportError) transportError = safeFailure(error, 'unlock');
      }
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      closeConfirmed = await Promise.race([
        client.end().then(
          () => true,
          (error) => {
            closeError = safeFailure(error, 'close');
            return false;
          },
        ),
        new Promise<false>((r) => {
          timer = setTimeout(() => {
            closeError = safeFailure(new Error(), 'close_deadline');
            r(false);
          }, 1500);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      try {
        emit(
          (connected ? 'session_' : 'connection_') + (closeConfirmed ? 'closed' : 'close_unknown'),
          undefined,
          { transactionOutcome, closeConfirmed, closeError, transportError, sessionError, timings },
        );
      } catch (error) {
        auditError = safeFailure(error, 'close_audit');
      } finally {
        try {
          evidence.close();
        } catch (error) {
          auditError = safeFailure(error, 'audit_fd_close');
        }
        if (primaryFailure) {
          primaryFailure.closeConfirmed = closeConfirmed;
          primaryFailure.closeError = closeError;
          primaryFailure.auditError = auditError;
          primaryFailure.transportError = transportError;
          primaryFailure.sessionError = sessionError;
        }
      }
    }
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (!['plan', 'apply', 'reconcile'].includes(mode)) {
    console.error('Use plan|apply|reconcile');
    process.exitCode = 1;
  } else {
    try {
      const result = await run(mode as 'plan' | 'apply' | 'reconcile', {
        remoteProfile: process.env.IS488_MIGRATION_REMOTE_PROFILE
          ? (JSON.parse(
              readFileSync(process.env.IS488_MIGRATION_REMOTE_PROFILE, 'utf8'),
            ) as RemoteProfile)
          : undefined,
        connection: {
          host: process.env.IS488_MIGRATION_HOST,
          port: Number(process.env.IS488_MIGRATION_PORT),
          database: process.env.IS488_MIGRATION_DATABASE,
          user: process.env.IS488_MIGRATION_USER,
          password: process.env.IS488_MIGRATION_PASSWORD,
        },
        runtimeRole: process.env.IS488_RUNTIME_ROLE ?? '',
        auditFile: process.env.IS488_MIGRATION_AUDIT ?? '',
      });
      console.log(JSON.stringify(result));
    } catch (error) {
      console.error(
        JSON.stringify({
          error: error instanceof MigrationError ? error.outcome : 'local_migration_failed',
        }),
      );
      process.exitCode = 1;
    }
  }
}
