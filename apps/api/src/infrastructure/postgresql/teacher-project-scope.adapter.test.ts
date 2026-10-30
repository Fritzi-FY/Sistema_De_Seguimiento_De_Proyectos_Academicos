import { it, expect, vi } from 'vitest';
import { SqlSession } from './session.js';
import { PostgresqlTeacherProjectScopeAdapter } from './teacher-project-scope.adapter.js';
it('SQL assignment adapter binds actor, qualifies schema and propagates failure without fallback', async () => {
  const session = new SqlSession({});
  const query = vi.spyOn(session, 'query').mockResolvedValue({
    rows: [{ project_id: 'p' }],
    rowCount: 1,
    command: 'SELECT',
    oid: 0,
    fields: [],
  });
  const scope = new PostgresqlTeacherProjectScopeAdapter(() => session);
  expect(await scope.isAssigned('t', 'p')).toBe(true);
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('public.teacher_project_assignments'),
    ['t'],
  );
  query.mockRejectedValue(new Error('offline'));
  await expect(scope.listAssignedProjectIds('t')).rejects.toThrow('offline');
});
import { Client } from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createApp } from '../http/app.js';
it.skipIf(process.env.IS488_TEACHER_SQL_TEST !== '1')(
  'SQL local HTTP: assignment-only read, owner management and independent membership revocation',
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
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const db = 'is488_scope_api_' + suffix,
      m = 'is488_sm_' + suffix,
      r = 'is488_sr_' + suffix;
    let dbCreated = false,
      madeM = false,
      madeR = false;
    let operator: Client | undefined;
    try {
      const guard = (
        await admin.query("SELECT current_user AS actor,current_setting('data_directory') AS dir")
      ).rows[0];
      expect(guard.actor).toBe(base.user);
      expect(guard.dir.replaceAll('\\', '/').toLowerCase()).toBe(
        process.env.IS488_MIGRATION_TEST_DIR!.replaceAll('\\', '/').toLowerCase(),
      );
      expect(guard.dir.replaceAll('\\', '/')).toMatch(/\/Temp\/is488-migrator-[a-f0-9]{32}$/);
      await admin.query(
        'CREATE ROLE ' + m + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
      madeM = true;
      await admin.query(
        'CREATE ROLE ' + r + ' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT',
      );
      madeR = true;
      await admin.query('CREATE DATABASE ' + db + ' OWNER ' + m);
      dbCreated = true;
      await admin.query('REVOKE TEMPORARY ON DATABASE ' + db + ' FROM PUBLIC,' + r);
      await promisify(execFile)(
        process.execPath,
        [fileURLToPath(new URL('../../../migrations/runner.ts', import.meta.url)), 'apply'],
        {
          env: {
            ...process.env,
            IS488_MIGRATION_HOST: '127.0.0.1',
            IS488_MIGRATION_PORT: '55490',
            IS488_MIGRATION_DATABASE: db,
            IS488_MIGRATION_USER: m,
            IS488_RUNTIME_ROLE: r,
            IS488_MIGRATION_REMOTE_PROFILE: '',
            IS488_MIGRATION_AUDIT: join(process.env.IS488_SCOPE_EVIDENCE!, suffix + '-api.jsonl'),
          },
          timeout: 15000,
        },
      );
      operator = new Client({ ...base, database: db, user: m });
      await operator.connect();
      const app = createApp({
        nodeEnv: 'test',
        persistence: { mode: 'postgres', connection: { ...base, database: db, user: r } },
      });
      const owner = '11111111-1111-4111-8111-111111111111',
        teacher = '22222222-2222-4222-8222-222222222222';
      const headers = (id: string) => ({
        'X-Dev-User-Id': id,
        'X-Dev-User-Role': 'teacher',
        'Content-Type': 'application/json',
      });
      const result = await app.request('/api/projects', {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({
          title: 'Synthetic SQL scope project',
          courseCode: 'IS488',
          startDate: '2026-10-26T00:00:00.000Z',
          targetDate: '2026-12-31T00:00:00.000Z',
        }),
      });
      expect(result.status).toBe(201);
      const p = (await result.json()) as { id: string };
      const detail = () => app.request('/api/projects/' + p.id, { headers: headers(teacher) });
      expect((await detail()).status).toBe(404);
      expect(
        await (await app.request('/api/projects', { headers: headers(teacher) })).json(),
      ).toEqual([]);
      await operator.query('INSERT INTO public.teacher_project_assignments VALUES ($1,$2)', [
        teacher,
        p.id,
      ]);
      expect((await detail()).status).toBe(200);
      expect(
        (
          (await (
            await app.request('/api/projects', { headers: headers(teacher) })
          ).json()) as unknown[]
        ).length,
      ).toBe(1);
      expect(
        (
          await app.request('/api/projects/' + p.id + '/members', {
            method: 'POST',
            headers: headers(teacher),
            body: JSON.stringify({ userId: owner, role: 'collaborator' }),
          })
        ).status,
      ).toBe(403);
      const member = await app.request('/api/projects/' + p.id + '/members', {
        method: 'POST',
        headers: headers(owner),
        body: JSON.stringify({ userId: teacher, role: 'collaborator' }),
      });
      expect(member.status).toBe(201);
      const membership = (await member.json()) as { id: string };
      expect(
        (await app.request('/api/projects/' + p.id + '/members', { headers: headers(teacher) }))
          .status,
      ).toBe(200);
      expect(
        (
          await app.request(
            '/api/projects/' + p.id + '/members/' + teacher + '?membershipId=' + membership.id,
            { method: 'DELETE', headers: headers(owner) },
          )
        ).status,
      ).toBe(200);
      expect((await detail()).status).toBe(200);
      expect(
        (await app.request('/api/projects/' + p.id + '/members', { headers: headers(teacher) }))
          .status,
      ).toBe(404);
      await operator.query(
        'DELETE FROM public.teacher_project_assignments WHERE teacher_user_id=$1',
        [teacher],
      );
      expect((await detail()).status).toBe(404);
    } finally {
      await operator?.end();
      if (dbCreated) await admin.query('DROP DATABASE ' + db + ' WITH (FORCE)');
      if (madeR) await admin.query('DROP ROLE ' + r);
      if (madeM) await admin.query('DROP ROLE ' + m);
      await admin.end();
    }
  },
  20000,
);
