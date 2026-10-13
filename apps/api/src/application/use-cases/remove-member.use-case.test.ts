import { describe, it, expect, beforeEach } from 'vitest';
import type { Project, ProjectMembership, ProjectRepositoryPort, MembershipRepositoryPort, SystemClockPort } from '@is488/shared';
import { DuplicateMembershipError, MembershipNotFoundError } from '@is488/shared';
import { RemoveMemberUseCase } from './remove-member.use-case.js';

const NOW = '2026-10-12T12:00:00.000Z';
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const CREATOR_ID = 'creator-user';
const COLLABORATOR_ID = 'collab-user';
const OTHER_USER = 'other-user';

const fakeProject: Project = {
  id: PROJECT_ID,
  title: 'Proyecto de Prueba',
  courseCode: 'IS-488',
  status: 'active',
  startDate: '2026-10-15T00:00:00.000Z',
  targetDate: '2026-12-20T00:00:00.000Z',
  creatorId: CREATOR_ID,
  createdAt: NOW,
  updatedAt: NOW,
};

const fakeCollaboratorMembership: ProjectMembership = {
  id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
  projectId: PROJECT_ID,
  userId: COLLABORATOR_ID,
  role: 'collaborator',
  status: 'active',
  joinedAt: NOW,
  updatedAt: NOW,
};

const fakeOwnerMembership: ProjectMembership = {
  id: 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb',
  projectId: PROJECT_ID,
  userId: CREATOR_ID,
  role: 'owner',
  status: 'active',
  joinedAt: NOW,
  updatedAt: NOW,
};

class FakeClock implements SystemClockPort {
  constructor(private readonly iso: string = NOW) {}
  now(): Date { return new Date(this.iso); }
  isoString(): string { return this.iso; }
}

class FakeProjectRepo implements ProjectRepositoryPort {
  constructor(private readonly projects: Project[] = []) {}
  async save(p: Project): Promise<void> { this.projects.push(p); }
  async findById(id: string): Promise<Project | null> {
    return this.projects.find(p => p.id === id) ?? null;
  }
  async findAll(): Promise<Project[]> { return [...this.projects]; }
  async findByUser(userId: string): Promise<Project[]> {
    return this.projects.filter(p => p.creatorId === userId);
  }
}

class FakeMembershipRepo implements MembershipRepositoryPort {
  private memberships: ProjectMembership[];

  constructor(initialMemberships: ProjectMembership[] = []) {
    this.memberships = initialMemberships.map(m => ({ ...m }));
  }

  async addMember(data: Omit<ProjectMembership, 'id'> & { id?: string }): Promise<ProjectMembership> {
    const existing = this.memberships.find(
      m => m.projectId === data.projectId && m.userId === data.userId && m.status === 'active'
    );
    if (existing) throw new DuplicateMembershipError(data.projectId, data.userId);
    const membership: ProjectMembership = { id: crypto.randomUUID(), ...data };
    this.memberships.push(membership);
    return { ...membership };
  }

  async removeMember(id: string): Promise<void> {
    const m = this.memberships.find(m => m.id === id);
    if (!m) throw new MembershipNotFoundError(id);
    m.status = 'removed';
  }

  async findByProject(projectId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter(m => m.projectId === projectId && m.status === 'active');
  }

  async findByUser(userId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter(m => m.userId === userId && m.status === 'active');
  }

  async findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMembership | null> {
    return this.memberships.find(
      m => m.projectId === projectId && m.userId === userId && m.status === 'active'
    ) ?? null;
  }
}

describe('RemoveMemberUseCase', () => {
  let projectRepo: FakeProjectRepo;
  let membershipRepo: FakeMembershipRepo;
  let clock: FakeClock;
  let useCase: RemoveMemberUseCase;

  beforeEach(() => {
    projectRepo = new FakeProjectRepo([fakeProject]);
    membershipRepo = new FakeMembershipRepo([fakeCollaboratorMembership, fakeOwnerMembership]);
    clock = new FakeClock();
    useCase = new RemoveMemberUseCase(projectRepo, membershipRepo, clock);
  });

  it('éxito: membresía cambia a status removed y retorna el registro actualizado', async () => {
    const result = await useCase.execute({
      projectId: PROJECT_ID,
      requesterId: CREATOR_ID,
      targetUserId: COLLABORATOR_ID,
    });
    expect(result.status).toBe('removed');
    expect(result.userId).toBe(COLLABORATOR_ID);
  });

  it('403: solicitante no es el creador', async () => {
    await expect(
      useCase.execute({
        projectId: PROJECT_ID,
        requesterId: OTHER_USER,
        targetUserId: COLLABORATOR_ID,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('404: proyecto no encontrado', async () => {
    await expect(
      useCase.execute({
        projectId: 'proyecto-inexistente',
        requesterId: CREATOR_ID,
        targetUserId: COLLABORATOR_ID,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404: membresía del target no encontrada (usuario sin membresía activa)', async () => {
    await expect(
      useCase.execute({
        projectId: PROJECT_ID,
        requesterId: CREATOR_ID,
        targetUserId: 'usuario-sin-membresia',
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('422: intento de retirar al propietario del proyecto', async () => {
    await expect(
      useCase.execute({
        projectId: PROJECT_ID,
        requesterId: CREATOR_ID,
        targetUserId: CREATOR_ID,
      })
    ).rejects.toMatchObject({ statusCode: 422 });
  });
});
