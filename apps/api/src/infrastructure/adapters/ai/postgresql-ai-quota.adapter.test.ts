/**
 * Prueba de integración SQL para PostgresqlAIQuotaAdapter.
 *
 * Requiere una instancia PostgreSQL local accesible y migraciones hasta la versión 9.
 * Se activa con la variable de entorno: IS488_AI_QUOTA_SQL_TEST=1
 *
 * Variables adicionales necesarias (igual que otros sql.test.ts del proyecto):
 *   IS488_SQL_HOST, IS488_SQL_PORT, IS488_SQL_DATA_DIR,
 *   IS488_SQL_ADMIN_USER (por defecto: is488_test_admin)
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client, type ClientConfig } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationSqlTestTarget } from '../../../testing/notification-sql-test-config.js';
import { SqlSession } from '../../postgresql/session.js';
import { PostgresqlAIQuotaAdapter } from './postgresql-ai-quota.adapter.js';

// ── Configuración ─────────────────────────────────────────────────────────────

const enabled = process.env['IS488_AI_QUOTA_SQL_TEST'] === '1';
const target = notificationSqlTestTarget(enabled);

if (enabled) {
  assert.ok(
    ['127.0.0.1', '::1'].includes(target.host),
    'Explicit loopback SQL host required for AI quota SQL tests',
  );
}

const base: ClientConfig = {
  host: target.host,
  port: target.port,
  user: process.env['IS488_SQL_ADMIN_USER'] ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 3_000,
  query_timeout: 6_000,
};

const migrationsDir = fileURLToPath(new URL('../../../../migrations', import.meta.url));
const suffix = randomUUID().replaceAll('-', '');
const migratorRole = 'is488_qm_' + suffix;
const runtimeRole = 'is488_qr_' + suffix;
const database = 'is488_test_quota_' + suffix;

let admin: Client;
let data: Client;
let evidence: string;
let projectId: string;
let userId: string;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function migrate(dbName: string) {
  const options = {
    connection: { ...base, database: dbName, user: migratorRole },
    runtimeRole,
    auditFile: join(evidence, dbName + '.jsonl'),
    directory: migrationsDir,
  };
  const runnerUrl = new URL('../../../../migrations/runner.ts', import.meta.url).href;
  await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { run } from ${JSON.stringify(runnerUrl)}; await run('apply', JSON.parse(process.argv[1]));`,
      JSON.stringify(options),
    ],
    { timeout: 30_000, windowsHide: true },
  );
}

function makeSession(): SqlSession {
  return new SqlSession({ ...base, database, user: runtimeRole });
}

function makeAdapter(session: SqlSession): PostgresqlAIQuotaAdapter {
  return new PostgresqlAIQuotaAdapter(() => session);
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!enabled) return;

  evidence = mkdtempSync(join(tmpdir(), 'is488-ai-quota-sql-'));
  admin = new Client(base);
  await admin.connect();

  await admin.query(
    `CREATE ROLE ${migratorRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  await admin.query(
    `CREATE ROLE ${runtimeRole} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
  );
  await admin.query(`CREATE DATABASE ${database} OWNER ${migratorRole}`);
  await admin.query(`REVOKE TEMPORARY ON DATABASE ${database} FROM PUBLIC,${runtimeRole}`);

  await migrate(database);

  data = new Client({ ...base, database, user: runtimeRole });
  await data.connect();

  // Insertar proyecto y usuario de prueba base
  projectId = randomUUID();
  userId = 'user-' + randomUUID();
  await data.query(
    `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
     VALUES ($1, 'Proyecto AI Quota Test', 'IS488', 'active', now(), now(), $2, now(), now())`,
    [projectId, userId],
  );
}, 60_000);

afterAll(async () => {
  if (!enabled) return;

  await data?.end().catch(() => {});
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${runtimeRole}`).catch(() => {});
    await admin.query(`DROP ROLE IF EXISTS ${migratorRole}`).catch(() => {});
  }
  await admin?.end().catch(() => {});
});

// ── Suites ────────────────────────────────────────────────────────────────────

describe.skipIf(!enabled)('PostgresqlAIQuotaAdapter — integración SQL', () => {
  it('permite la primera solicitud y adquiere fila in_flight', async () => {
    const session = makeSession();
    const adapter = makeAdapter(session);
    const uid = 'u-' + randomUUID();

    const result = await adapter.checkAndAcquire(uid, projectId);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();

    // Verificar que existe la fila in_flight
    const rows = await data.query(
      `SELECT status FROM public.ai_analysis_quota WHERE user_id = $1 AND project_id = $2`,
      [uid, projectId],
    );
    expect(rows.rows[0]?.status).toBe('in_flight');

    await adapter.release(uid, projectId, 'success');
    await session.close();
  });

  it('rechaza una segunda solicitud concurrente del mismo usuario/proyecto (IN_FLIGHT_CONFLICT)', async () => {
    const session1 = makeSession();
    const session2 = makeSession();
    const uid = 'u-' + randomUUID();

    const adapter1 = makeAdapter(session1);
    const adapter2 = makeAdapter(session2);

    // Primera solicitud: debe pasar
    const first = await adapter1.checkAndAcquire(uid, projectId);
    expect(first.allowed).toBe(true);

    // Segunda solicitud del mismo usuario/proyecto: debe rechazarse
    const second = await adapter2.checkAndAcquire(uid, projectId);
    expect(second.allowed).toBe(false);
    expect(second.reason).toBe('IN_FLIGHT_CONFLICT');
    expect(second.retryAfterSeconds).toBeGreaterThan(0);

    await adapter1.release(uid, projectId, 'success');
    await session1.close();
    await session2.close();
  });

  it('rechaza cuando el recuento del proyecto supera 5 en la ventana de 10 minutos (RATE_LIMIT_EXCEEDED)', async () => {
    const pId = randomUUID();
    await data.query(
      `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, 'Proyecto Rate Limit', 'IS488', 'active', now(), now(), $2, now(), now())`,
      [pId, userId],
    );

    // Insertar 5 registros completados recientes manualmente
    for (let i = 0; i < 5; i++) {
      await data.query(
        `INSERT INTO public.ai_analysis_quota (user_id, project_id, status, started_at, completed_at)
         VALUES ($1, $2, 'completed', clock_timestamp() - interval '1 minute', clock_timestamp())`,
        [`u-${i}-${randomUUID()}`, pId],
      );
    }

    // La sexta solicitud debe ser rechazada
    const session = makeSession();
    const adapter = makeAdapter(session);
    const result = await adapter.checkAndAcquire('u-new-' + randomUUID(), pId);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);

    await session.close();
  });

  it('release con outcome "success" actualiza el estado a "completed"', async () => {
    const session = makeSession();
    const adapter = makeAdapter(session);
    const uid = 'u-' + randomUUID();

    await adapter.checkAndAcquire(uid, projectId);
    await adapter.release(uid, projectId, 'success');

    const rows = await data.query(
      `SELECT status, completed_at FROM public.ai_analysis_quota WHERE user_id = $1 AND project_id = $2 ORDER BY started_at DESC LIMIT 1`,
      [uid, projectId],
    );
    expect(rows.rows[0]?.status).toBe('completed');
    expect(rows.rows[0]?.completed_at).not.toBeNull();

    await session.close();
  });

  it('release con outcome "error" actualiza el estado a "failed"', async () => {
    const session = makeSession();
    const adapter = makeAdapter(session);
    const uid = 'u-' + randomUUID();

    await adapter.checkAndAcquire(uid, projectId);
    await adapter.release(uid, projectId, 'error');

    const rows = await data.query(
      `SELECT status FROM public.ai_analysis_quota WHERE user_id = $1 AND project_id = $2 ORDER BY started_at DESC LIMIT 1`,
      [uid, projectId],
    );
    expect(rows.rows[0]?.status).toBe('failed');

    await session.close();
  });

  it('fila expirada (> 30 s) no bloquea nuevas solicitudes del mismo usuario/proyecto', async () => {
    const pId = randomUUID();
    await data.query(
      `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, 'Proyecto Expiry', 'IS488', 'active', now(), now(), $2, now(), now())`,
      [pId, userId],
    );

    const uid = 'u-' + randomUUID();
    // Insertar una fila in_flight artificialmente expirada (> 30 s)
    await data.query(
      `INSERT INTO public.ai_analysis_quota (user_id, project_id, status, started_at)
       VALUES ($1, $2, 'in_flight', clock_timestamp() - interval '60 seconds')`,
      [uid, pId],
    );

    const session = makeSession();
    const adapter = makeAdapter(session);
    const result = await adapter.checkAndAcquire(uid, pId);

    // La nueva solicitud debe poder adquirir (el adaptador expira la fila vieja primero)
    expect(result.allowed).toBe(true);

    // Verificar que la fila expirada fue marcada como timeout
    const rows = await data.query(
      `SELECT status FROM public.ai_analysis_quota WHERE user_id = $1 AND project_id = $2 ORDER BY started_at`,
      [uid, pId],
    );
    expect(rows.rows[0]?.status).toBe('timeout');
    expect(rows.rows[1]?.status).toBe('in_flight');

    await adapter.release(uid, pId, 'success');
    await session.close();
  });

  it('aislamiento: solicitudes de distintos usuarios en el mismo proyecto no interfieren entre sí', async () => {
    const pId = randomUUID();
    await data.query(
      `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, 'Proyecto Isolation', 'IS488', 'active', now(), now(), $2, now(), now())`,
      [pId, userId],
    );

    const uid1 = 'u-' + randomUUID();
    const uid2 = 'u-' + randomUUID();
    const session1 = makeSession();
    const session2 = makeSession();

    const r1 = await makeAdapter(session1).checkAndAcquire(uid1, pId);
    const r2 = await makeAdapter(session2).checkAndAcquire(uid2, pId);

    // Ambos usuarios distintos deben poder adquirir simultáneamente
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    await makeAdapter(session1).release(uid1, pId, 'success');
    await makeAdapter(session2).release(uid2, pId, 'success');
    await session1.close();
    await session2.close();
  });

  it('concurrencia estricta: múltiples usuarios concurrentes nunca superan el límite de 5 análisis por proyecto en 10 minutos', async () => {
    const pId = randomUUID();
    await data.query(
      `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, 'Proyecto Concurrencia Limite', 'IS488', 'active', now(), now(), $2, now(), now())`,
      [pId, userId],
    );

    // Pre-insertar 4 análisis completados en el proyecto
    for (let i = 0; i < 4; i++) {
      await data.query(
        `INSERT INTO public.ai_analysis_quota (user_id, project_id, status, started_at, completed_at)
         VALUES ($1, $2, 'completed', clock_timestamp() - interval '1 minute', clock_timestamp())`,
        [`pre-u-${i}-${randomUUID()}`, pId],
      );
    }

    // Lanzar 6 solicitudes concurrentes de 6 usuarios distintos para el mismo proyecto
    const candidateUsers = Array.from({ length: 6 }, (_, i) => `concurrent-u-${i}-${randomUUID()}`);
    const sessions = candidateUsers.map(() => makeSession());

    try {
      const results = await Promise.all(
        candidateUsers.map((uid, index) => {
          const adapter = makeAdapter(sessions[index]!);
          return adapter.checkAndAcquire(uid, pId);
        }),
      );

      const allowedCount = results.filter((r) => r.allowed).length;
      const rejectedCount = results.filter(
        (r) => !r.allowed && r.reason === 'RATE_LIMIT_EXCEEDED',
      ).length;

      // Exactamente 1 solicitud debe ser permitida (4 existentes + 1 = 5)
      expect(allowedCount).toBe(1);
      // Las 5 restantes deben ser rechazadas por RATE_LIMIT_EXCEEDED
      expect(rejectedCount).toBe(5);

      // Comprobar en base de datos que el número total de filas nunca supera 5
      const totalRows = (
        await data.query(
          `SELECT count(*)::int AS count FROM public.ai_analysis_quota WHERE project_id = $1`,
          [pId],
        )
      ).rows[0]?.count;

      expect(totalRows).toBe(5);
    } finally {
      await Promise.all(sessions.map((s) => s.close()));
    }
  });

  it('seguridad de liberación: un usuario no puede liberar la reserva in_flight de otro usuario', async () => {
    const pId = randomUUID();
    await data.query(
      `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, 'Proyecto No Liberacion Ajena', 'IS488', 'active', now(), now(), $2, now(), now())`,
      [pId, userId],
    );

    const userA = 'user-a-' + randomUUID();
    const userB = 'user-b-' + randomUUID();

    const sessionA = makeSession();
    const adapterA = makeAdapter(sessionA);
    const resultA = await adapterA.checkAndAcquire(userA, pId);
    expect(resultA.allowed).toBe(true);

    // User B intenta liberar la reserva de User A
    const sessionB = makeSession();
    const adapterB = makeAdapter(sessionB);
    await adapterB.release(userB, pId, 'success');

    // Verificar que la reserva de User A sigue intacta como in_flight
    const rows = await data.query(
      `SELECT status FROM public.ai_analysis_quota WHERE user_id = $1 AND project_id = $2`,
      [userA, pId],
    );
    expect(rows.rows[0]?.status).toBe('in_flight');

    // Liberar correctamente por User A
    await adapterA.release(userA, pId, 'success');
    const rowsAfter = await data.query(
      `SELECT status FROM public.ai_analysis_quota WHERE user_id = $1 AND project_id = $2`,
      [userA, pId],
    );
    expect(rowsAfter.rows[0]?.status).toBe('completed');

    await sessionA.close();
    await sessionB.close();
  });

  it('la liberación y expiración de reservas no reducen el conteo de la ventana ni permiten superar el límite de 5', async () => {
    const pId = randomUUID();
    await data.query(
      `INSERT INTO public.projects (id, title, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, 'Proyecto Limite Inviolable', 'IS488', 'active', now(), now(), $2, now(), now())`,
      [pId, userId],
    );

    // Insertar 5 registros en distintos estados (completed, failed, timeout)
    const statuses = ['completed', 'completed', 'failed', 'timeout', 'completed'] as const;
    for (let i = 0; i < 5; i++) {
      await data.query(
        `INSERT INTO public.ai_analysis_quota (user_id, project_id, status, started_at, completed_at)
         VALUES ($1, $2, $3, clock_timestamp() - interval '2 minutes', clock_timestamp())`,
        [`u-past-${i}-${randomUUID()}`, pId, statuses[i]],
      );
    }

    // Intentar adquirir una nueva solicitud: debe rechazarse con RATE_LIMIT_EXCEEDED
    const sessionNew = makeSession();
    const adapterNew = makeAdapter(sessionNew);
    const result = await adapterNew.checkAndAcquire('u-new-' + randomUUID(), pId);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.retryAfterSeconds).toBeGreaterThan(0);

    await sessionNew.close();
  });
});
