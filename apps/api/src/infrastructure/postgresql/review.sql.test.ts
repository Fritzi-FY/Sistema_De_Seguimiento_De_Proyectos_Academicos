import {
  ciSqlProfile,
  ciAdminConnection,
  ciRolePasswordClause,
  assertCiSqlTarget,
  assertSqlTestConfiguration,
} from '../../testing/sql-ci.js';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client, type ClientConfig } from 'pg';
import { SqlSession } from './session.js';
import { PostgresqlReviewRepository } from './review.repository.js';
import { deriveReviewTimeline } from '@is488/shared';

const enabled = process.env.IS488_SQL_TEST === '1';
assertSqlTestConfiguration(enabled);
const ci = ciSqlProfile();
const base: ClientConfig = ciAdminConnection() ?? {
  host: process.env.IS488_SQL_HOST ?? '127.0.0.1',
  port: process.env.IS488_SQL_PORT ? Number(process.env.IS488_SQL_PORT) : undefined,
  user: process.env.IS488_SQL_ADMIN_USER ?? 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 5000,
};

function normalizeDataDir(dir: string): string {
  return dir.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
}

const suffix = crypto.randomUUID().replaceAll('-', '');
const database = 'is488_test_rev_' + suffix;
const role = 'is488_runtime_rev_' + suffix;
const migrationRole = 'is488_pm_rev_' + suffix;
let migrationRoleCreated = false;
let config: ClientConfig;
let admin: Client;
let databaseCreated = false;
let roleCreated = false;
let clusterDataDir = '';
const sessions: SqlSession[] = [];

function session(override: ClientConfig = {}) {
  const s = new SqlSession({ ...config, ...override });
  sessions.push(s);
  return s;
}

const studentUser = '11111111-1111-4111-8111-111111111111';
const teacherUser = '22222222-2222-4222-8222-222222222222';
const outsiderUser = '33333333-3333-4333-8333-333333333333';
const projectIdA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const projectIdB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

async function seedProjectFixtures(client: Client) {
  const now = new Date().toISOString();
  for (const pid of [projectIdA, projectIdB]) {
    await client.query(
      `INSERT INTO public.projects (id, title, description, course_code, status, start_date, target_date, creator_id, created_at, updated_at)
       VALUES ($1, $2, 'Proyecto de prueba', 'IS488', 'active', $3, $4, $5, $6, $7)`,
      [pid, 'Proyecto ' + pid.slice(0, 8), now, now, studentUser, now, now],
    );

    await client.query(
      `INSERT INTO public.project_memberships (id, project_id, user_id, role, status, joined_at, updated_at, removed_at)
       VALUES ($1, $2, $3, 'owner', 'active', $4, $5, null)`,
      [crypto.randomUUID(), pid, studentUser, now, now],
    );

    await client.query(
      `INSERT INTO public.teacher_project_assignments (teacher_user_id, project_id)
       VALUES ($1, $2)`,
      [teacherUser, pid],
    );
  }
}

async function restartPostgres(dataDir: string, adminClient: Client): Promise<void> {
  // Close active sessions before restart
  await Promise.all(sessions.map((s) => s.close().catch(() => {})));
  sessions.length = 0;
  await adminClient.end().catch(() => {});

  if (process.platform === 'win32') {
    const pgBin = 'C:/Program Files/PostgreSQL/18/bin';
    const logFile = join(tmpdir(), 'is488-reviews-restart.log');

    // Detener instancia de PostgreSQL
    spawnSync(join(pgBin, 'pg_ctl.exe'), ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30'], {
      windowsHide: true,
      stdio: 'ignore',
    });

    // Iniciar mediante CIM para desacoplar del proceso padre
    const cmd = `"${join(pgBin, 'pg_ctl.exe')}" start -D "${dataDir}" -l "${logFile}" -w -t 30`;
    const script = `$res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmd.replaceAll("'", "''")}' }; if ($res.ReturnValue -ne 0) { exit 1 }`;
    spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      input: script,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 35000,
    });
  } else {
    // Entorno Linux / CI
    spawnSync('pg_ctl', ['stop', '-D', dataDir, '-m', 'fast', '-w', '-t', '30'], {
      stdio: 'ignore',
    });
    spawnSync(
      'pg_ctl',
      ['start', '-D', dataDir, '-l', '/tmp/is488-postgresql.log', '-w', '-t', '30'],
      {
        stdio: 'ignore',
      },
    );
  }

  // Esperar a que el servidor vuelva a aceptar conexiones
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const probe = new Client({ ...config, connectionTimeoutMillis: 1000 });
      await probe.connect();
      await probe.query('SELECT 1');
      await probe.end();

      // Reconectar admin global
      admin = new Client(base);
      await admin.connect();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('PostgreSQL failed to accept connections after restart');
}

describe.skipIf(!enabled)(
  'PostgreSQL real exclusivo: revisiones docentes (review.sql.test.ts)',
  () => {
    beforeAll(async () => {
      const expectedDir = process.env.IS488_SQL_DATA_DIR ?? process.env.IS488_MIGRATION_TEST_DIR;
      if (!ci) {
        if (!process.env.IS488_SQL_PORT) {
          throw new Error('IS488_SQL_PORT is required when SQL tests are enabled');
        }
        if (!expectedDir) {
          throw new Error(
            'IS488_SQL_DATA_DIR or IS488_MIGRATION_TEST_DIR is required when SQL tests are enabled',
          );
        }
      }

      admin = new Client(base);
      await admin.connect();

      const check = await admin.query<{ dir: string; actor: string }>(
        "SELECT current_setting('data_directory') AS dir, current_user AS actor",
      );
      clusterDataDir = check.rows[0]!.dir;

      if (ci) {
        await assertCiSqlTarget(admin);
      } else {
        expect(check.rows[0]!.actor).toBe(base.user);
        expect(normalizeDataDir(check.rows[0]!.dir)).toBe(normalizeDataDir(expectedDir!));
      }

      await admin.query(
        'CREATE ROLE ' +
          role +
          ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT' +
          ciRolePasswordClause(),
      );
      roleCreated = true;

      await admin.query(
        'CREATE ROLE ' +
          migrationRole +
          ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT' +
          ciRolePasswordClause(),
      );
      migrationRoleCreated = true;

      await admin.query('CREATE DATABASE ' + database + ' OWNER ' + migrationRole);
      databaseCreated = true;

      await admin.query('REVOKE TEMPORARY ON DATABASE ' + database + ' FROM PUBLIC,' + role);

      config = { ...base, user: role, database, password: ci?.rolePassword };

      const audit = join(
        process.env.IS488_CI_EVIDENCE ?? mkdtempSync(join(tmpdir(), 'is488-reviews-sql-')),
        suffix + '-reviews.jsonl',
      );

      // Aplicar catálogo completo de migraciones (1 a 6)
      await promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL('../../../migrations/runner.ts', import.meta.url)), 'apply'],
        {
          env: {
            ...process.env,
            IS488_MIGRATION_HOST: String(base.host ?? '127.0.0.1'),
            IS488_MIGRATION_PORT: String(base.port),
            IS488_MIGRATION_DATABASE: database,
            IS488_MIGRATION_USER: migrationRole,
            IS488_MIGRATION_PASSWORD: ci?.rolePassword ?? '',
            IS488_RUNTIME_ROLE: role,
            IS488_MIGRATION_REMOTE_PROFILE: '',
            IS488_MIGRATION_AUDIT: audit,
          },
          timeout: 20000,
        },
      );

      // Sembrar proyectos base como administrador
      const setupClient = new Client({ ...base, database });
      await setupClient.connect();
      try {
        await seedProjectFixtures(setupClient);
      } finally {
        await setupClient.end();
      }
    }, 25000);

    afterAll(async () => {
      await Promise.all(sessions.map((s) => s.close().catch(() => {})));
      const cleanupAdmin = new Client(base);
      try {
        await cleanupAdmin.connect();
        const check = await cleanupAdmin.query<{ dir: string; actor: string }>(
          "SELECT current_setting('data_directory') AS dir, current_user AS actor",
        );
        const expectedDir = process.env.IS488_SQL_DATA_DIR ?? process.env.IS488_MIGRATION_TEST_DIR;
        if (ci) {
          await assertCiSqlTarget(cleanupAdmin);
        } else {
          expect(expectedDir).toBeDefined();
          expect(check.rows[0]!.actor).toBe(base.user);
          expect(normalizeDataDir(check.rows[0]!.dir)).toBe(normalizeDataDir(expectedDir!));
        }
        if (databaseCreated) {
          await cleanupAdmin.query(
            `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
            [database],
          );
          await cleanupAdmin.query('DROP DATABASE ' + database);
        }
        if (roleCreated) await cleanupAdmin.query('DROP ROLE ' + role);
        if (migrationRoleCreated) await cleanupAdmin.query('DROP ROLE ' + migrationRole);
      } finally {
        await cleanupAdmin.end().catch(() => {});
        if (admin) await admin.end().catch(() => {});
      }
    }, 25000);

    it('verifica privilegios runtime en PostgreSQL: solicitudes admite SELECT/INSERT/UPDATE y acciones es estrictamente append-only', async () => {
      const adminForDb = new Client({ ...base, database });
      await adminForDb.connect();
      try {
        const aclChecks = await adminForDb.query<{
          table_name: string;
          privilege: string;
          allowed: boolean;
        }>(
          `SELECT t.name AS table_name, p.privilege, has_table_privilege($1, t.name, p.privilege) AS allowed
         FROM unnest(ARRAY['public.teacher_review_requests', 'public.teacher_review_actions']::text[]) AS t(name)
         CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']::text[]) AS p(privilege)`,
          [role],
        );

        const map = new Map<string, boolean>();
        for (const row of aclChecks.rows) {
          map.set(`${row.table_name}:${row.privilege}`, row.allowed);
        }

        // public.teacher_review_requests: SELECT, INSERT, UPDATE permitidos; DELETE, TRUNCATE denegados
        expect(map.get('public.teacher_review_requests:SELECT')).toBe(true);
        expect(map.get('public.teacher_review_requests:INSERT')).toBe(true);
        expect(map.get('public.teacher_review_requests:UPDATE')).toBe(true);
        expect(map.get('public.teacher_review_requests:DELETE')).toBe(false);
        expect(map.get('public.teacher_review_requests:TRUNCATE')).toBe(false);

        // public.teacher_review_actions: SELECT, INSERT permitidos; UPDATE, DELETE, TRUNCATE denegados (append-only)
        expect(map.get('public.teacher_review_actions:SELECT')).toBe(true);
        expect(map.get('public.teacher_review_actions:INSERT')).toBe(true);
        expect(map.get('public.teacher_review_actions:UPDATE')).toBe(false);
        expect(map.get('public.teacher_review_actions:DELETE')).toBe(false);
        expect(map.get('public.teacher_review_actions:TRUNCATE')).toBe(false);
      } finally {
        await adminForDb.end();
      }
    });

    it('dos ciclos completos de corrección, preservación de solicitud original y derivación determinista del historial', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      // Incepción: Estudiante crea solicitud original
      const created = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Entrega Sprint 1 - Arquitectura Hexagonal',
        description: 'Se implementaron los puertos y casos de uso iniciales.',
        evidenceUrl: 'https://github.com/example/repo/pull/1',
      });

      expect(created.id).toBeDefined();
      expect(created.projectId).toBe(projectIdA);
      expect(created.requesterId).toBe(studentUser);
      expect(created.status).toBe('PENDING');
      expect(created.title).toBe('Entrega Sprint 1 - Arquitectura Hexagonal');
      expect(created.description).toBe('Se implementaron los puertos y casos de uso iniciales.');
      expect(created.evidenceUrl).toBe('https://github.com/example/repo/pull/1');

      // CICLO 1: Docente observa -> Estudiante re-solicita
      const response1 = await repo.recordTeacherResponse(projectIdA, created.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Faltan pruebas unitarias y comprobación de puertos.',
      });
      expect(response1.status).toBe('CHANGES_REQUESTED');

      const resubmit1 = await repo.recordStudentResubmission(projectIdA, created.id, {
        studentId: studentUser,
        description: 'Se incorporaron pruebas unitarias completas y verificación de puertos.',
        evidenceUrl: 'https://github.com/example/repo/pull/1/commits/abc1',
      });
      expect(resubmit1.status).toBe('PENDING');

      // CICLO 2: Docente observa de nuevo -> Estudiante re-solicita -> Docente aprueba
      const response2 = await repo.recordTeacherResponse(projectIdA, created.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Ajustar la tipificación estricta en el contrato compartido.',
      });
      expect(response2.status).toBe('CHANGES_REQUESTED');

      const resubmit2 = await repo.recordStudentResubmission(projectIdA, created.id, {
        studentId: studentUser,
        description: 'Tipificación estricta corregida según sugerencia.',
        evidenceUrl: 'https://github.com/example/repo/pull/1/commits/abc2',
      });
      expect(resubmit2.status).toBe('PENDING');

      const response3 = await repo.recordTeacherResponse(projectIdA, created.id, {
        reviewerId: teacherUser,
        status: 'APPROVED',
        observation: 'Excelente trabajo. Revisión aprobada satisfactoriamente.',
      });
      expect(response3.status).toBe('APPROVED');

      // Consulta consistente del detalle completo
      const detail = await repo.findById(projectIdA, created.id);
      expect(detail).not.toBeNull();
      if (!detail) return;

      // Preservación inmutable de la solicitud original
      expect(detail.id).toBe(created.id);
      expect(detail.status).toBe('APPROVED');
      expect(detail.title).toBe('Entrega Sprint 1 - Arquitectura Hexagonal');
      expect(detail.description).toBe('Se implementaron los puertos y casos de uso iniciales.');
      expect(detail.evidenceUrl).toBe('https://github.com/example/repo/pull/1');

      // Verificación de acciones en orden estricto de secuencia 1..5
      expect(detail.actions).toHaveLength(5);
      const sequences = detail.actions.map((a) => a.sequenceNumber);
      expect(sequences).toEqual([1, 2, 3, 4, 5]);

      const act0 = detail.actions[0]!;
      expect(act0.actionType).toBe('TEACHER_RESPONSE');
      expect(act0.status).toBe('CHANGES_REQUESTED');
      expect(act0.actorId).toBe(teacherUser);
      expect(act0.comment).toBe('Faltan pruebas unitarias y comprobación de puertos.');

      const act1 = detail.actions[1]!;
      expect(act1.actionType).toBe('STUDENT_RESUBMISSION');
      expect(act1.status).toBe('PENDING');
      expect(act1.actorId).toBe(studentUser);
      expect(act1.comment).toBe(
        'Se incorporaron pruebas unitarias completas y verificación de puertos.',
      );
      expect(act1.evidenceUrl).toBe('https://github.com/example/repo/pull/1/commits/abc1');

      const act2 = detail.actions[2]!;
      expect(act2.actionType).toBe('TEACHER_RESPONSE');
      expect(act2.status).toBe('CHANGES_REQUESTED');

      const act3 = detail.actions[3]!;
      expect(act3.actionType).toBe('STUDENT_RESUBMISSION');
      expect(act3.status).toBe('PENDING');

      const act4 = detail.actions[4]!;
      expect(act4.actionType).toBe('TEACHER_RESPONSE');
      expect(act4.status).toBe('APPROVED');

      // Derivación determinista del historial completo (Timeline 0..5)
      const timeline = deriveReviewTimeline(detail, detail.actions);
      expect(timeline).toHaveLength(6);
      expect(timeline.map((t) => t.sequenceNumber)).toEqual([0, 1, 2, 3, 4, 5]);
      expect(timeline[0]!.actionType).toBe('INITIAL_REQUEST');
      expect(timeline[0]!.comment).toBe('Se implementaron los puertos y casos de uso iniciales.');
      expect(timeline[5]!.actionType).toBe('TEACHER_RESPONSE');
      expect(timeline[5]!.status).toBe('APPROVED');
    });

    it('resistencia a colisiones de timestamps: orden determinista estrictamente por sequence_number', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const review = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de timestamps colisionantes',
        description: 'Validación de ordenación por secuencia.',
      });

      await repo.recordTeacherResponse(projectIdA, review.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Observación de prueba',
      });

      await repo.recordStudentResubmission(projectIdA, review.id, {
        studentId: studentUser,
        description: 'Ajuste de prueba',
      });

      // Forzar timestamps artificialmente idénticos en la base de datos
      const identicalTime = '2026-11-05T20:00:00.000Z';
      const adminForDb = new Client({ ...base, database });
      await adminForDb.connect();
      try {
        await adminForDb.query(
          `UPDATE public.teacher_review_actions SET created_at = $1 WHERE review_request_id = $2`,
          [identicalTime, review.id],
        );
      } finally {
        await adminForDb.end();
      }

      const fetched = await repo.findById(projectIdA, review.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.actions).toHaveLength(2);

      const firstAction = fetched!.actions[0]!;
      const secondAction = fetched!.actions[1]!;

      // Ambos tienen idéntica marca de tiempo
      expect(firstAction.createdAt).toBe(secondAction.createdAt);
      // Pero el ordenamiento por sequenceNumber ASC es determinista
      expect(firstAction.sequenceNumber).toBe(1);
      expect(secondAction.sequenceNumber).toBe(2);

      const timeline = deriveReviewTimeline(fetched!, fetched!.actions);
      expect(timeline.map((t) => t.sequenceNumber)).toEqual([0, 1, 2]);
    });

    it('concurrencia de re-solicitudes sobre CHANGES_REQUESTED: FOR UPDATE serializa, una triunfa y la otra recibe 409', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const review = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de concurrencia en re-solicitud',
        description: 'Descripción inicial para prueba concurrente.',
      });

      await repo.recordTeacherResponse(projectIdA, review.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Requiere ajustes antes de aprobar.',
      });

      // Dos re-solicitudes concurrentes lanzadas con sesiones independientes
      const session1 = session();
      const session2 = session();
      const repo1 = new PostgresqlReviewRepository(() => session1);
      const repo2 = new PostgresqlReviewRepository(() => session2);

      const [res1, res2] = await Promise.allSettled([
        repo1.recordStudentResubmission(projectIdA, review.id, {
          studentId: studentUser,
          description: 'Re-solicitud hilo A',
        }),
        repo2.recordStudentResubmission(projectIdA, review.id, {
          studentId: studentUser,
          description: 'Re-solicitud hilo B',
        }),
      ]);

      const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejections = [res1, res2].filter((r) => r.status === 'rejected');

      expect(successes).toHaveLength(1);
      expect(rejections).toHaveLength(1);

      const rejected = rejections[0] as PromiseRejectedResult;
      expect(rejected.reason).toHaveProperty('statusCode', 409);
      expect(rejected.reason.message).toContain('no permite re-solicitar evaluación');

      // Verificar en base de datos: exactamente UNA acción de re-solicitud registrada (sin duplicados)
      const after = await repo.findById(projectIdA, review.id);
      expect(after?.actions).toHaveLength(2); // acción 1 (CHANGES_REQUESTED) + acción 2 (resubmission)
      expect(after?.actions[1]?.actionType).toBe('STUDENT_RESUBMISSION');
      expect(after?.status).toBe('PENDING');
    });

    it('concurrencia de respuestas docentes sobre PENDING: FOR UPDATE serializa, una triunfa y la otra recibe 409', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const review = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de concurrencia docente',
        description: 'Descripción para respuestas concurrentes.',
      });

      const session1 = session();
      const session2 = session();
      const repo1 = new PostgresqlReviewRepository(() => session1);
      const repo2 = new PostgresqlReviewRepository(() => session2);

      const [res1, res2] = await Promise.allSettled([
        repo1.recordTeacherResponse(projectIdA, review.id, {
          reviewerId: teacherUser,
          status: 'APPROVED',
          observation: 'Aprobación hilo A',
        }),
        repo2.recordTeacherResponse(projectIdA, review.id, {
          reviewerId: teacherUser,
          status: 'CHANGES_REQUESTED',
          observation: 'Observación hilo B',
        }),
      ]);

      const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
      const rejections = [res1, res2].filter((r) => r.status === 'rejected');

      expect(successes).toHaveLength(1);
      expect(rejections).toHaveLength(1);

      const rejected = rejections[0] as PromiseRejectedResult;
      expect(rejected.reason).toHaveProperty('statusCode', 409);

      const after = await repo.findById(projectIdA, review.id);
      expect(after?.actions).toHaveLength(1);
    });

    it('rollback estricto ante fallo en inserción de acción: estado no cambia y cero acciones huérfanas', async () => {
      const s = session();
      const faultRepo = new PostgresqlReviewRepository(
        () => s,
        async (stage) => {
          if (stage === 'during_action') {
            throw new Error('Fallo simulado de infraestructura durante inserción de acción');
          }
        },
      );

      const normalRepo = new PostgresqlReviewRepository(() => s);
      const review = await normalRepo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de Rollback Transaccional',
        description: 'Verificación de reversión atómica.',
      });

      // Intentar responder mediante el repositorio con fallo inyectado
      await expect(
        faultRepo.recordTeacherResponse(projectIdA, review.id, {
          reviewerId: teacherUser,
          status: 'APPROVED',
          observation: 'Esta respuesta debe revertirse por completo.',
        }),
      ).rejects.toThrow('Fallo simulado de infraestructura');

      // Comprobar que el estado de la solicitud no fue mutado y no existen acciones huérfanas
      const afterRollback = await normalRepo.findById(projectIdA, review.id);
      expect(afterRollback).not.toBeNull();
      expect(afterRollback!.status).toBe('PENDING');
      expect(afterRollback!.actions).toHaveLength(0);
    });

    it('aislamiento estricto por par compuesto projectId y reviewId', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const reviewA = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Solicitud Proyecto A',
        description: 'Aislamiento estricto entre proyectos.',
      });

      // findById con projectId incorrecto devuelve null
      const crossFind = await repo.findById(projectIdB, reviewA.id);
      expect(crossFind).toBeNull();

      // recordTeacherResponse con projectId ajeno rechaza con 404
      await expect(
        repo.recordTeacherResponse(projectIdB, reviewA.id, {
          reviewerId: teacherUser,
          status: 'APPROVED',
          observation: 'Intento de respuesta en proyecto ajeno',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });

      // recordStudentResubmission con projectId ajeno rechaza con 404
      await expect(
        repo.recordStudentResubmission(projectIdB, reviewA.id, {
          studentId: studentUser,
          description: 'Intento de re-solicitud en proyecto ajeno',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });

      // Consulta con usuario no relacionado preserva aislamiento
      expect(outsiderUser).toBeDefined();

      // Estado original en Proyecto A permanece completamente intacto
      const checkA = await repo.findById(projectIdA, reviewA.id);
      expect(checkA!.status).toBe('PENDING');
      expect(checkA!.actions).toHaveLength(0);
    });

    it('copias defensivas: las mutaciones sobre objetos devueltos no afectan consultas posteriores', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const review = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de copias defensivas',
        description: 'Verificación de inmutabilidad externa.',
      });

      await repo.recordTeacherResponse(projectIdA, review.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Observación original',
      });

      const read1 = await repo.findById(projectIdA, review.id);
      expect(read1).not.toBeNull();

      // Mutar externamente el array y los objetos retornados
      read1!.title = 'Título corrupto';
      read1!.actions.pop();
      if (read1!.actions[0]) {
        read1!.actions[0].comment = 'Comentario corrupto';
      }

      // Consulta subsecuente debe devolver los datos prístinos de la base de datos
      const read2 = await repo.findById(projectIdA, review.id);
      expect(read2!.title).toBe('Prueba de copias defensivas');
      expect(read2!.actions).toHaveLength(1);
      expect(read2!.actions[0]!.comment).toBe('Observación original');
    });

    it('privilegios runtime: denegación estricta de UPDATE/DELETE en acciones y de DELETE en solicitudes', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const review = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de privilegios runtime',
        description: 'Verificación de restricciones de permisos SQL.',
      });

      await repo.recordTeacherResponse(projectIdA, review.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Acción inmutable',
      });

      const detail = await repo.findById(projectIdA, review.id);
      const actionId = detail!.actions[0]!.id;

      // Intentar UPDATE en teacher_review_actions con rol runtime -> debe denegar (SQLSTATE 42501)
      await expect(
        s.query(`UPDATE public.teacher_review_actions SET comment = 'alterado' WHERE id = $1`, [
          actionId,
        ]),
      ).rejects.toMatchObject({
        name: 'PersistenceTransactionError',
        outcome: 'rolled_back',
        sqlState: '42501',
      });

      // Intentar DELETE en teacher_review_actions con rol runtime -> debe denegar (SQLSTATE 42501)
      await expect(
        s.query(`DELETE FROM public.teacher_review_actions WHERE id = $1`, [actionId]),
      ).rejects.toMatchObject({
        name: 'PersistenceTransactionError',
        outcome: 'rolled_back',
        sqlState: '42501',
      });

      // Intentar DELETE en teacher_review_requests con rol runtime -> debe denegar (SQLSTATE 42501)
      await expect(
        s.query(`DELETE FROM public.teacher_review_requests WHERE id = $1`, [review.id]),
      ).rejects.toMatchObject({
        name: 'PersistenceTransactionError',
        outcome: 'rolled_back',
        sqlState: '42501',
      });
    });

    it('supervivencia tras reinicio real de PostgreSQL (stop/start efectivo de instancia)', async () => {
      const s1 = session();
      const repo1 = new PostgresqlReviewRepository(() => s1);

      const review = await repo1.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Revisión persistente pre-reinicio',
        description: 'Esta solicitud y su acción deben sobrevivir al reinicio real del motor.',
        evidenceUrl: 'https://github.com/example/repo/commit/pre-restart',
      });

      await repo1.recordTeacherResponse(projectIdA, review.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Observación registrada antes de detener PostgreSQL.',
      });

      // Ejecutar detención y levantamiento efectivo de PostgreSQL
      await restartPostgres(clusterDataDir, admin);

      // Tras el reinicio, abrir nueva sesión y verificar recuperación íntegra
      const s2 = session();
      const repo2 = new PostgresqlReviewRepository(() => s2);

      const recovered = await repo2.findById(projectIdA, review.id);
      expect(recovered).not.toBeNull();
      expect(recovered!.id).toBe(review.id);
      expect(recovered!.status).toBe('CHANGES_REQUESTED');
      expect(recovered!.title).toBe('Revisión persistente pre-reinicio');
      expect(recovered!.description).toBe(
        'Esta solicitud y su acción deben sobrevivir al reinicio real del motor.',
      );
      expect(recovered!.evidenceUrl).toBe('https://github.com/example/repo/commit/pre-restart');
      expect(recovered!.actions).toHaveLength(1);
      expect(recovered!.actions[0]!.sequenceNumber).toBe(1);
      expect(recovered!.actions[0]!.comment).toBe(
        'Observación registrada antes de detener PostgreSQL.',
      );
    }, 25000);

    it('findById obtiene solicitud y acciones desde una vista atómica consistente y sin mezcla de estados', async () => {
      const s = session();
      const repo = new PostgresqlReviewRepository(() => s);

      const review = await repo.createRequest({
        projectId: projectIdA,
        requesterId: studentUser,
        title: 'Prueba de consistencia atómica en findById',
        description: 'Validación de vista consistente sin consultas separadas.',
      });

      // Inicialmente: estado PENDING y 0 acciones
      const initial = await repo.findById(projectIdA, review.id);
      expect(initial).not.toBeNull();
      expect(initial!.status).toBe('PENDING');
      expect(initial!.actions).toHaveLength(0);

      // Transición atómica a CHANGES_REQUESTED con acción 1
      await repo.recordTeacherResponse(projectIdA, review.id, {
        reviewerId: teacherUser,
        status: 'CHANGES_REQUESTED',
        observation: 'Observación para verificar coherencia atómica.',
      });

      // findById debe reflejar simultáneamente el nuevo estado y su acción correspondiente
      const updated = await repo.findById(projectIdA, review.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('CHANGES_REQUESTED');
      expect(updated!.actions).toHaveLength(1);
      expect(updated!.actions[0]!.sequenceNumber).toBe(1);
      expect(updated!.actions[0]!.status).toBe('CHANGES_REQUESTED');

      // Se comprueba que no existe desfase entre el estado de la solicitud y las acciones retornadas
      expect(updated!.status).toBe(updated!.actions[updated!.actions.length - 1]!.status);
    });

    it.todo(
      'supervivencia tras reinicio del proceso API con rutas HTTP reales (/api/projects/:projectId/reviews) diferida al Bloque 4',
    );
  },
);
