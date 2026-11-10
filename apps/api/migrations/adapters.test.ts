import {
  ciSqlProfile,
  ciAdminConnection,
  ciRolePasswordClause,
  assertCiSqlTarget,
  assertSqlTestConfiguration,
} from '../src/testing/sql-ci.ts';
import { it, expect } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { run } from './runner.ts';
import { SqlSession } from '../src/infrastructure/postgresql/session.js';
import {
  PostgresqlProjectRepository,
  PostgresqlMembershipRepository,
  PostgresqlProjectCreationAdapter,
} from '../src/infrastructure/postgresql/repositories.js';

it.skipIf(process.env.IS488_MIGRATOR_TEST !== '1')(
  'adaptadores reales usan el esquema migrado como runtime sin DDL',
  async () => {
    assertSqlTestConfiguration(true);
    const ci = ciSqlProfile();
    if (!ci) {
      if (!process.env.IS488_SQL_PORT)
        throw new Error('IS488_SQL_PORT is required when IS488_MIGRATOR_TEST=1');
      if (!process.env.IS488_MIGRATION_TEST_DIR && !process.env.IS488_SQL_DATA_DIR)
        throw new Error(
          'IS488_MIGRATION_TEST_DIR or IS488_SQL_DATA_DIR is required when IS488_MIGRATOR_TEST=1',
        );
    }
    const base = ciAdminConnection() ?? {
      host: process.env.IS488_SQL_HOST ?? '127.0.0.1',
      port: Number(process.env.IS488_SQL_PORT),
      user: process.env.IS488_MIGRATION_ADMIN_USER ?? 'is488_migration_admin',
      database: 'postgres',
      connectionTimeoutMillis: 2000,
    };
    const admin = new Client(base);
    await admin.connect();
    const id = randomUUID().replaceAll('-', '');
    const db = 'is488_mtest_' + id,
      migrator = 'is488_m_' + id,
      runtime = 'is488_r_' + id;
    let dbCreated = false,
      migratorCreated = false,
      runtimeCreated = false;
    let session: SqlSession | undefined;
    const expectedDir = process.env.IS488_MIGRATION_TEST_DIR ?? process.env.IS488_SQL_DATA_DIR;
    const normalize = (d: string) => d.replaceAll('\\', '/').toLowerCase().replace(/\/+$/, '');
    try {
      const check = await admin.query(
        "SELECT current_user AS actor,current_setting('data_directory') AS dir",
      );
      if (ci) await assertCiSqlTarget(admin);
      else {
        expect(check.rows[0].actor).toBe(base.user);
        expect(normalize(check.rows[0].dir)).toBe(normalize(expectedDir!));
      }
      await admin.query(
        'CREATE ROLE ' +
          migrator +
          ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT' +
          ciRolePasswordClause(),
      );
      migratorCreated = true;
      await admin.query(
        'CREATE ROLE ' +
          runtime +
          ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT' +
          ciRolePasswordClause(),
      );
      runtimeCreated = true;
      await admin.query('CREATE DATABASE ' + db + ' OWNER ' + migrator);
      dbCreated = true;
      await admin.query('REVOKE TEMPORARY ON DATABASE ' + db + ' FROM PUBLIC,' + runtime);
      await run('apply', {
        connection: { ...base, database: db, user: migrator, password: ci?.rolePassword },
        runtimeRole: runtime,
        auditFile: join(process.env.IS488_MIGRATION_TEST_EVIDENCE!, 'adapters-' + id + '.jsonl'),
      });
      session = new SqlSession({
        ...base,
        database: db,
        user: runtime,
        password: ci?.rolePassword,
        options: '-c search_path=pg_catalog',
      });
      const s = session;
      const projects = new PostgresqlProjectRepository(() => s),
        members = new PostgresqlMembershipRepository(() => s),
        creation = new PostgresqlProjectCreationAdapter(() => s);
      const now = '2026-10-26T12:00:00.000Z';
      const p = {
        id: randomUUID(),
        title: 'Migrated synthetic project',
        courseCode: 'IS488',
        status: 'active' as const,
        startDate: now,
        targetDate: now,
        creatorId: 'synthetic-owner',
        createdAt: now,
        updatedAt: now,
      };
      const m = {
        id: randomUUID(),
        projectId: p.id,
        userId: p.creatorId,
        role: 'owner' as const,
        status: 'active' as const,
        joinedAt: now,
        updatedAt: now,
        removedAt: null,
      };
      await creation.createProjectWithOwner(p, m);
      expect(await projects.findById(p.id)).toEqual(p);
      expect(await members.findByProject(p.id)).toEqual([m]);
      expect((await s.query('SHOW search_path')).rows[0].search_path).toBe('pg_catalog, public');
      await expect(s.query('CREATE TEMP TABLE forbidden(id int)')).rejects.toMatchObject({
        outcome: 'rolled_back',
        sqlState: '42501',
      });
      await expect(s.query('SELECT * FROM is488_migrations.versions')).rejects.toMatchObject({
        outcome: 'rolled_back',
        sqlState: '42501',
      });
    } finally {
      if (session) await session.close();
      const check = await admin.query(
        "SELECT current_user AS actor,current_setting('data_directory') AS dir",
      );
      if (ci) await assertCiSqlTarget(admin);
      else {
        expect(expectedDir).toBeDefined();
        expect(check.rows[0].actor).toBe(base.user);
        expect(normalize(check.rows[0].dir)).toBe(normalize(expectedDir!));
      }
      if (dbCreated) await admin.query('DROP DATABASE ' + db + ' WITH (FORCE)');
      if (runtimeCreated) await admin.query('DROP ROLE ' + runtime);
      if (migratorCreated) await admin.query('DROP ROLE ' + migrator);
      await admin.end();
    }
  },
  15000,
);
