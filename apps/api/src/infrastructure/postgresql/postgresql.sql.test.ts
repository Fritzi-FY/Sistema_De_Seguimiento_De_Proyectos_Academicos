import {
  ciSqlProfile,
  ciAdminConnection,
  ciRolePasswordClause,
  assertCiSqlTarget,
} from '../../testing/sql-ci.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { Client, type ClientConfig } from 'pg';
import { createServer, connect, type Socket } from 'node:net';
import { once } from 'node:events';
import { createApp } from '../http/app.js';
import { SqlSession } from './session.js';
import {
  PostgresqlProjectRepository,
  PostgresqlMembershipRepository,
  PostgresqlProjectCreationAdapter,
} from './repositories.js';
import { InMemoryMembershipRepository } from '../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryProjectRepository } from '../adapters/repositories/in-memory-project.repository.js';
import { InMemoryProjectCreationAdapter } from '../adapters/repositories/in-memory-project-creation.adapter.js';
import { CreateProjectUseCase } from '../../application/use-cases/create-project.use-case.js';
import { AddMemberUseCase } from '../../application/use-cases/add-member.use-case.js';
import { RemoveMemberUseCase } from '../../application/use-cases/remove-member.use-case.js';
import {
  DuplicateMembershipError,
  ProjectAlreadyExistsError,
  MembershipNotFoundError,
  type Project,
  type ProjectMembership,
} from '@is488/shared';

const enabled = process.env.IS488_SQL_TEST === '1';
const ci = ciSqlProfile();
const base: ClientConfig = ciAdminConnection(55489) ?? {
  host: '127.0.0.1',
  port: 55489,
  user: 'is488_test_admin',
  database: 'postgres',
  connectionTimeoutMillis: 5000,
};
const suffix = crypto.randomUUID().replaceAll('-', '');
const database = 'is488_test_' + suffix;
const role = 'is488_runtime_' + suffix;
const migrationRole = 'is488_pm_' + suffix;
let migrationRoleCreated = false;
let config: ClientConfig;
let admin: Client;
let databaseCreated = false;
let roleCreated = false;
const sessions: SqlSession[] = [];
const now = '2026-10-26T12:00:00.000Z';
const owner = '11111111-1111-4111-8111-111111111111';
const collaborator = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const payload = {
  title: 'Proyecto sintético',
  courseCode: 'IS488',
  startDate: now,
  targetDate: '2026-12-31T00:00:00.000Z',
};
function session(override: ClientConfig = {}) {
  const s = new SqlSession({ ...config, ...override });
  sessions.push(s);
  return s;
}
function entities() {
  const p: Project = {
    ...payload,
    id: crypto.randomUUID(),
    status: 'active',
    creatorId: owner,
    createdAt: now,
    updatedAt: now,
  };
  const m: ProjectMembership = {
    id: crypto.randomUUID(),
    projectId: p.id,
    userId: owner,
    role: 'owner',
    status: 'active',
    joinedAt: now,
    updatedAt: now,
    removedAt: null,
  };
  return { p, m };
}

describe.skipIf(!enabled)('PostgreSQL real exclusivo localhost:55489', () => {
  beforeAll(async () => {
    admin = new Client(base);
    await admin.connect();
    const check = await admin.query(
      "SELECT current_setting('data_directory') AS dir, current_user AS actor",
    );
    if (ci) await assertCiSqlTarget(admin);
    else {
      expect(check.rows[0].actor).toBe('is488_test_admin');
      expect(check.rows[0].dir.replaceAll('\\', '/')).toContain('/Temp/is488-epic002-');
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
      process.env.IS488_CI_EVIDENCE ?? mkdtempSync(join(tmpdir(), 'is488-projects-sql-')),
      suffix + '-projects.jsonl',
    );
    await promisify(execFile)(
      process.execPath,
      [fileURLToPath(new URL('../../../migrations/runner.ts', import.meta.url)), 'apply'],
      {
        env: {
          ...process.env,
          IS488_MIGRATION_HOST: '127.0.0.1',
          IS488_MIGRATION_PORT: '55489',
          IS488_MIGRATION_DATABASE: database,
          IS488_MIGRATION_USER: migrationRole,
          IS488_MIGRATION_PASSWORD: ci?.rolePassword ?? '',
          IS488_RUNTIME_ROLE: role,
          IS488_MIGRATION_REMOTE_PROFILE: '',
          IS488_MIGRATION_AUDIT: audit,
        },
        timeout: 15000,
      },
    );
  }, 20000);
  afterAll(async () => {
    await Promise.all(sessions.map((s) => s.close()));
    if (admin) {
      if (databaseCreated) await admin.query('DROP DATABASE ' + database);
      if (roleCreated) await admin.query('DROP ROLE ' + role);
      if (migrationRoleCreated) await admin.query('DROP ROLE ' + migrationRole);
      await admin.end();
    }
  }, 20000);

  for (const mode of ['maps', 'sql'] as const)
    describe('Contrato ' + mode, () => {
      function ports() {
        if (mode === 'sql') {
          const s = session();
          return {
            project: new PostgresqlProjectRepository(() => s),
            members: new PostgresqlMembershipRepository(() => s),
            creation: new PostgresqlProjectCreationAdapter(() => s),
          };
        }
        const projects = new Map<string, Project>(),
          members = new Map<string, ProjectMembership>();
        return {
          project: new InMemoryProjectRepository(projects),
          members: new InMemoryMembershipRepository(members),
          creation: new InMemoryProjectCreationAdapter(projects, members),
        };
      }
      it('creación, lecturas, timestamp único, retiro condicionado e historia tras reincorporar', async () => {
        const r = ports();
        let ticks = 0;
        const clock = {
          now: () => new Date(now),
          isoString: () => new Date(Date.parse(now) + ticks++).toISOString(),
        };
        const p = await new CreateProjectUseCase(r.creation, clock).execute({
          ...payload,
          creatorId: owner,
        });
        expect(ticks).toBe(1);
        expect(await r.project.findById(p.id)).toEqual(p);
        expect((await r.project.findAll()).some((v) => v.id === p.id)).toBe(true);
        const initialOwner = (await r.members.findByProject(p.id))[0]!;
        await expect(r.creation.createProjectWithOwner(p, initialOwner)).rejects.toBeInstanceOf(
          ProjectAlreadyExistsError,
        );
        await r.project.save({ ...p, description: 'Updated' });
        expect((await r.project.findById(p.id))?.description).toBe('Updated');
        expect((await r.project.findByUser(owner)).some((v) => v.id === p.id)).toBe(true);
        expect(await r.project.findByUser(outsider)).toEqual([]);
        const initial = (await r.members.findByProject(p.id))[0]!;
        expect(initial).toMatchObject({
          role: 'owner',
          removedAt: null,
          joinedAt: p.createdAt,
          updatedAt: p.updatedAt,
        });
        const add = new AddMemberUseCase(r.project, r.members, clock);
        const first = await add.execute({
          projectId: p.id,
          requesterId: owner,
          userId: collaborator,
        });
        expect(ticks).toBe(2);
        expect((await r.members.findByUser(collaborator)).some((v) => v.id === first.id)).toBe(
          true,
        );
        const remove = new RemoveMemberUseCase(r.project, r.members, clock);
        const command = {
          projectId: p.id,
          requesterId: owner,
          targetUserId: collaborator,
          membershipId: first.id,
        };
        const retired = await remove.execute(command);
        expect(ticks).toBe(3);
        expect(retired.removedAt).toBe(retired.updatedAt);
        expect(retired.removedAt).toBe(new Date(Date.parse(now) + 2).toISOString());
        expect(await r.members.findByProjectAndUser(p.id, collaborator)).toBeNull();
        expect((await r.members.findByUser(collaborator)).some((v) => v.id === first.id)).toBe(
          false,
        );
        const second = await add.execute({
          projectId: p.id,
          requesterId: owner,
          userId: collaborator,
        });
        expect(second.id).not.toBe(first.id);
        await expect(remove.execute(command)).rejects.toMatchObject({ statusCode: 404 });
        await expect(
          r.members.removeMember({
            membershipId: second.id,
            projectId: crypto.randomUUID(),
            userId: collaborator,
            removedAt: now,
          }),
        ).rejects.toBeInstanceOf(MembershipNotFoundError);
        await expect(
          r.members.removeMember({
            membershipId: second.id,
            projectId: p.id,
            userId: outsider,
            removedAt: now,
          }),
        ).rejects.toBeInstanceOf(MembershipNotFoundError);
        expect((await r.members.findByProjectAndUser(p.id, collaborator))?.id).toBe(second.id);
        await expect(
          remove.execute({ ...command, targetUserId: owner, membershipId: initial.id }),
        ).rejects.toMatchObject({ statusCode: 422 });
        await expect(
          remove.execute({ ...command, requesterId: outsider, membershipId: second.id }),
        ).rejects.toMatchObject({ statusCode: 403 });
        if (mode === 'sql') {
          const result = await session().query(
            'SELECT status,removed_at,updated_at FROM project_memberships WHERE id=$1',
            [first.id],
          );
          expect(result.rows[0]!.status).toBe('removed');
          expect(result.rows[0]!.removed_at).toEqual(result.rows[0]!.updated_at);
        }
      });
    });

  it('segunda inserción rechazada revierte ambas filas, observable desde otra sesión', async () => {
    const { p, m } = entities();
    m.joinedAt = 'invalid timestamp';
    const s = session();
    await expect(
      new PostgresqlProjectCreationAdapter(() => s).createProjectWithOwner(p, m),
    ).rejects.toMatchObject({ outcome: 'rolled_back' });
    const observer = session();
    expect((await observer.query('SELECT id FROM projects WHERE id=$1', [p.id])).rowCount).toBe(0);
    expect(
      (await observer.query('SELECT id FROM project_memberships WHERE id=$1', [m.id])).rowCount,
    ).toBe(0);
  });

  it('restricciones reales: FK, propietario ?nico, retiro coherente, título y permisos mínimos', async () => {
    const { p, m } = entities(),
      s = session();
    await new PostgresqlProjectCreationAdapter(() => s).createProjectWithOwner(p, m);
    const repo = new PostgresqlMembershipRepository(() => s);
    await expect(
      repo.addMember({ ...m, id: crypto.randomUUID(), userId: outsider }),
    ).rejects.toMatchObject({
      outcome: 'rolled_back',
      sqlState: '23505',
      constraint: 'membership_active_owner',
    });
    await expect(
      repo.addMember({
        ...m,
        id: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        role: 'collaborator',
      }),
    ).rejects.toMatchObject({ outcome: 'rolled_back', sqlState: '23503' });
    await expect(
      repo.addMember({
        ...m,
        id: crypto.randomUUID(),
        userId: outsider,
        role: 'collaborator',
        status: 'removed',
      }),
    ).rejects.toMatchObject({ outcome: 'rolled_back', sqlState: '23514' });
    await expect(
      new PostgresqlProjectRepository(() => s).save({ ...p, id: crypto.randomUUID(), title: 'x' }),
    ).rejects.toMatchObject({ outcome: 'rolled_back', sqlState: '23514' });
    await expect(s.query('DELETE FROM projects WHERE id=$1', [p.id])).rejects.toMatchObject({
      outcome: 'rolled_back',
      sqlState: '42501',
    });
    await expect(s.query('CREATE TABLE forbidden_table (id int)')).rejects.toMatchObject({
      outcome: 'rolled_back',
      sqlState: '42501',
    });
  });

  it('dos altas concurrentes: una inserción y un conflicto; dos retiros: uno y cero filas', async () => {
    const { p, m } = entities();
    await new PostgresqlProjectCreationAdapter(() => session()).createProjectWithOwner(p, m);
    const a = new PostgresqlMembershipRepository(() => sa),
      b = new PostgresqlMembershipRepository(() => sb);
    const sa = session(),
      sb = session();
    const data = { ...m, role: 'collaborator' as const, userId: collaborator };
    const added = await Promise.allSettled([
      a.addMember({ ...data, id: crypto.randomUUID() }),
      b.addMember({ ...data, id: crypto.randomUUID() }),
    ]);
    expect(added.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(added.filter((r) => r.status === 'rejected').map((r) => r.reason)).toEqual([
      expect.any(DuplicateMembershipError),
    ]);
    const active = await a.findByProjectAndUser(p.id, collaborator);
    const condition = {
      membershipId: active!.id,
      projectId: p.id,
      userId: collaborator,
      removedAt: now,
    };
    const removed = await Promise.allSettled([
      a.removeMember(condition),
      b.removeMember(condition),
    ]);
    expect(removed.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(removed.filter((r) => r.status === 'rejected').map((r) => r.reason)).toEqual([
      expect.any(MembershipNotFoundError),
    ]);
  });

  it('HTTP: aislamiento P1/P2/P3, revocación Kanban e historia, y storage compartido entre peticiones', async () => {
    let ticks = 0;
    const app = createApp({
      nodeEnv: 'test',
      persistence: { mode: 'postgres', connection: config },
      clock: {
        now: () => new Date(now),
        isoString: () => new Date(Date.parse(now) + ticks++).toISOString(),
      },
    });
    const headers = (id: string) => ({
      'Content-Type': 'application/json',
      'X-Dev-User-Id': id,
      'X-Dev-User-Role': 'student',
    });
    const create = async (id: string) => {
      const res = await app.request('/api/projects', {
        method: 'POST',
        headers: headers(id),
        body: JSON.stringify(payload),
      });
      expect(res.status).toBe(201);
      return (await res.json()) as Project;
    };
    const [p1, p2, p3] = await Promise.all([create(owner), create(owner), create(outsider)]);
    const add = await app.request('/api/projects/' + p1.id + '/members', {
      method: 'POST',
      headers: headers(owner),
      body: JSON.stringify({ userId: collaborator, role: 'collaborator' }),
    });
    expect(add.status).toBe(201);
    const member = (await add.json()) as ProjectMembership;
    const url = '/api/projects/' + p1.id;
    const board = await app.request(url + '/board', { headers: headers(collaborator) });
    expect(board.status).toBe(200);
    const data = (await board.json()) as { columns: { id: string }[] };
    for (const id of [p2.id, p3.id])
      expect(
        (await app.request('/api/projects/' + id + '/board', { headers: headers(collaborator) }))
          .status,
      ).toBe(404);
    const task = await app.request(url + '/tasks', {
      method: 'POST',
      headers: headers(owner),
      body: JSON.stringify({
        title: 'Tarea sintética',
        columnId: data.columns[0]!.id,
        assigneeIds: [collaborator],
      }),
    });
    expect(task.status).toBe(201);
    const created = (await task.json()) as { id: string };
    expect(
      (
        await app.request(url + '/tasks/' + created.id + '/activity', {
          headers: headers(collaborator),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await app.request(url + '/members/' + collaborator, {
          method: 'DELETE',
          headers: headers(owner),
        })
      ).status,
    ).toBe(400);
    const retired = await app.request(
      url + '/members/' + collaborator + '?membershipId=' + member.id,
      { method: 'DELETE', headers: headers(owner) },
    );
    expect(retired.status).toBe(200);
    const rejectedAssignment = await app.request(url + '/tasks', {
      method: 'POST',
      headers: headers(owner),
      body: JSON.stringify({
        title: 'Removed assignee',
        columnId: data.columns[0]!.id,
        assigneeIds: [collaborator],
      }),
    });
    expect(rejectedAssignment.status).toBe(400);
    for (const path of ['/board', '/tasks', '/tasks/' + created.id + '/activity'])
      expect((await app.request(url + path, { headers: headers(collaborator) })).status).toBe(404);
    expect(
      (await app.request(url + '/tasks/' + created.id + '/activity', { headers: headers(owner) }))
        .status,
    ).toBe(200);
    const restarted = createApp({
      nodeEnv: 'test',
      persistence: { mode: 'postgres', connection: config },
    });
    expect((await restarted.request(url, { headers: headers(owner) })).status).toBe(200);
    const fresh = (await (
      await restarted.request(url + '/board', { headers: headers(owner) })
    ).json()) as { columns: { id: string }[] };
    expect(fresh.columns.map((c) => c.id)).toEqual(data.columns.map((c) => c.id));
    const persistedTask = await restarted.request(url + '/tasks/' + created.id + '/activity', {
      headers: headers(owner),
    });
    expect(persistedTask.status).toBe(200);
    expect(await persistedTask.json()).toEqual(
      await (
        await app.request(url + '/tasks/' + created.id + '/activity', { headers: headers(owner) })
      ).json(),
    );
  });

  it('COMMIT confirmado en servidor con respuesta perdida: unknown, sin retry ni rollback compensatorio', async () => {
    const sockets = new Set<Socket>();
    let commits = 0;
    const proxy = createServer((downstream) => {
      const upstream = connect({ host: '127.0.0.1', port: 55489 });
      sockets.add(downstream);
      sockets.add(upstream);
      let armed = false;
      downstream.on('data', (chunk) => {
        if (chunk.includes(Buffer.from('COMMIT'))) armed = true;
        upstream.write(chunk);
      });
      upstream.on('data', (chunk) => {
        if (armed && chunk.includes(Buffer.from('COMMIT\0'))) {
          commits++;
          downstream.destroy();
          upstream.destroy();
          return;
        }
        downstream.write(chunk);
      });
      downstream.on('error', () => {});
      upstream.on('error', () => downstream.destroy());
      downstream.on('close', () => upstream.destroy());
    });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    try {
      const address = proxy.address();
      if (!address || typeof address === 'string') throw new Error('No test proxy port');
      const s = session({ port: address.port }),
        { p, m } = entities();
      await expect(
        new PostgresqlProjectCreationAdapter(() => s).createProjectWithOwner(p, m),
      ).rejects.toMatchObject({ name: 'PersistenceTransactionError', outcome: 'unknown' });
      expect(commits).toBe(1);
      expect((await session().query('SELECT id FROM projects WHERE id=$1', [p.id])).rowCount).toBe(
        1,
      );
      expect(
        (await session().query('SELECT id FROM project_memberships WHERE id=$1', [m.id])).rowCount,
      ).toBe(1);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });
});
