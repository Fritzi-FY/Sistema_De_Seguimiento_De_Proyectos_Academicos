import { describe, it, expect, vi } from 'vitest';
import { InMemoryTeacherProjectScopeAdapter } from './in-memory-teacher-project-scope.adapter.js';
import {
  ListProjectsUseCase,
  GetProjectByIdUseCase,
} from '../../../application/use-cases/list-projects.use-case.js';
import { InMemoryProjectRepository } from './in-memory-project.repository.js';
import { InMemoryMembershipRepository } from './in-memory-membership.repository.js';
import type { Project, ProjectMembership } from '@is488/shared';
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222';
const now = '2026-10-26T00:00:00.000Z';
const project: Project = {
  id,
  title: 'Synthetic project',
  courseCode: 'IS488',
  status: 'active',
  startDate: now,
  targetDate: now,
  creatorId: 'owner',
  createdAt: now,
  updatedAt: now,
};
function fixture() {
  const projects = new InMemoryProjectRepository(
    new Map([
      [id, project],
      [other, { ...project, id: other }],
    ]),
  );
  const raw = new Map<string, ProjectMembership>();
  const members = new InMemoryMembershipRepository(raw);
  const grants = new Map<string, readonly string[]>();
  const scope = new InMemoryTeacherProjectScopeAdapter(grants);
  return {
    projects,
    members,
    raw,
    grants,
    scope,
    list: new ListProjectsUseCase(projects, members, scope),
    detail: new GetProjectByIdUseCase(projects, members, scope),
  };
}
describe('SEC-01 relationship authorization', () => {
  it('denies teacher global access and permits explicit assigned project only', async () => {
    const f = fixture();
    const user = { userId: 'teacher', role: 'teacher' };
    expect(await f.list.execute({ user })).toEqual([]);
    expect(await f.detail.execute({ user, id })).toBeNull();
    f.grants.set('teacher', [id]);
    expect((await f.list.execute({ user })).map((p) => p.id)).toEqual([id]);
    expect((await f.detail.execute({ user, id }))?.id).toBe(id);
    expect(await f.detail.execute({ user, id: other })).toBeNull();
  });
  it('preserves owner and collaborator, deduplicates and keeps independent assignment after removal', async () => {
    const f = fixture();
    const user = { userId: 'owner', role: 'teacher' };
    expect((await f.list.execute({ user })).length).toBe(2);
    expect((await f.detail.execute({ user, id }))?.id).toBe(id);
    const collaborator = { userId: 'collaborator', role: 'teacher' };
    await f.members.addMember({
      id: other,
      projectId: id,
      userId: 'collaborator',
      role: 'collaborator',
      status: 'active',
      joinedAt: now,
      updatedAt: now,
      removedAt: null,
    });
    f.grants.set('collaborator', [id]);
    expect((await f.list.execute({ user: collaborator })).length).toBe(1);
    await f.members.removeMember({
      membershipId: other,
      projectId: id,
      userId: 'collaborator',
      removedAt: now,
    });
    expect((await f.detail.execute({ user: collaborator, id }))?.id).toBe(id);
    f.grants.clear();
    expect(await f.detail.execute({ user: collaborator, id })).toBeNull();
  });
  it('source error denies assignment-only access and does not revoke known ownership', async () => {
    const f = fixture();
    vi.spyOn(f.scope, 'isAssigned').mockRejectedValue(new Error('source unavailable'));
    vi.spyOn(f.scope, 'listAssignedProjectIds').mockRejectedValue(new Error('source unavailable'));
    expect(await f.detail.execute({ user: { userId: 'teacher', role: 'teacher' }, id })).toBeNull();
    expect((await f.list.execute({ user: { userId: 'owner', role: 'teacher' } })).length).toBe(2);
  });
  it('has no self-grant API and returns detached assignment IDs', async () => {
    const f = fixture();
    f.grants.set('t', [id]);
    const values = await f.scope.listAssignedProjectIds('t');
    (values as string[]).push(other);
    expect(await f.scope.listAssignedProjectIds('t')).toEqual([id]);
    expect('assign' in f.scope).toBe(false);
  });
});
