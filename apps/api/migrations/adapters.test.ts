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
    const base = {
      host: '127.0.0.1',
      port: 55490,
      user: 'is488_migration_admin',
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
    try {
      const check = await admin.query(
        "SELECT current_user AS actor,current_setting('data_directory') AS dir",
      );
      expect(check.rows[0].actor).toBe('is488_migration_admin');
      expect(check.rows[0].dir.replaceAll('\\', '/').toLowerCase()).toBe(
        process.env.IS488_MIGRATION_TEST_DIR!.replaceAll('\\', '/').toLowerCase(),
      );
      expect(check.rows[0].dir.replaceAll('\\', '/')).toMatch(
        /\/Temp\/is488-migrator-[a-f0-9]{32}$/,
      );
      await admin.query(
        'CREATE ROLE ' + migrator + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
      migratorCreated = true;
      await admin.query(
        'CREATE ROLE ' + runtime + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
      runtimeCreated = true;
      await admin.query('CREATE DATABASE ' + db + ' OWNER ' + migrator);
      dbCreated = true;
      await admin.query('REVOKE TEMPORARY ON DATABASE ' + db + ' FROM PUBLIC,' + runtime);
      await run('apply', {
        connection: { ...base, database: db, user: migrator },
        runtimeRole: runtime,
        auditFile: join(process.env.IS488_MIGRATION_TEST_EVIDENCE!, 'adapters-' + id + '.jsonl'),
      });
      session = new SqlSession({
        ...base,
        database: db,
        user: runtime,
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
        code: '42501',
      });
      await expect(s.query('SELECT * FROM is488_migrations.versions')).rejects.toMatchObject({
        code: '42501',
      });
    } finally {
      if (session) await session.close();
      if (dbCreated) await admin.query('DROP DATABASE ' + db + ' WITH (FORCE)');
      if (runtimeCreated) await admin.query('DROP ROLE ' + runtime);
      if (migratorCreated) await admin.query('DROP ROLE ' + migrator);
      await admin.end();
    }
  },
  15000,
);
