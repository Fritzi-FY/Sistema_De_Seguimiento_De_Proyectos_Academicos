import { describe, it, expect, beforeEach } from 'vitest';
import type { Project, ProjectMembership, ProjectRepositoryPort, MembershipRepositoryPort, SystemClockPort } from '@is488/shared';
import { DuplicateMembershipError } from '@is488/shared';
import { AddMemberUseCase } from './add-member.use-case.js';

const NOW = '2026-10-12T12:00:00.000Z';
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const CREATOR_ID = 'creator-user';
const OTHER_USER = 'other-user';
const COLLABORATOR_ID = 'collab-user';

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
  private readonly memberships: ProjectMembership[] = [];

  async addMember(data: Omit<ProjectMembership, 'id'> & { id?: string }): Promise<ProjectMembership> {
    const existing = this.memberships.find(
      m => m.projectId === data.projectId && m.userId === data.userId && m.status === 'active'
    );
    if (existing) throw new DuplicateMembershipError(data.projectId, data.userId);
    const membership: ProjectMembership = { id: data.id ?? crypto.randomUUID(), ...data };
    this.memberships.push(membership);
    return { ...membership };
  }

  async removeMember(id: string): Promise<void> {
    const m = this.memberships.find(m => m.id === id);
    if (m) m.status = 'removed';
  }

  async findByProject(projectId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter(m => m.projectId === projectId && m.status === 'active');
  }

  async findByUser(userId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter(m => m.userId === userId && m.status === 'active');
  }

  async findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMembership | null> {
    return this.memberships.find(m => m.projectId === projectId && m.userId === userId && m.status === 'active') ?? null;
  }
}

describe('AddMemberUseCase', () => {
  let projectRepo: FakeProjectRepo;
  let membershipRepo: FakeMembershipRepo;
  let clock: FakeClock;
  let useCase: AddMemberUseCase;

  beforeEach(() => {
    projectRepo = new FakeProjectRepo([fakeProject]);
    membershipRepo = new FakeMembershipRepo();
    clock = new FakeClock();
    useCase = new AddMemberUseCase(projectRepo, membershipRepo, clock);
  });

  it('éxito: membresía creada y retornada con role collaborator y status active', async () => {
    const result = await useCase.execute({
      projectId: PROJECT_ID,
      requesterId: CREATOR_ID,
      userId: COLLABORATOR_ID,
    });
    expect(result.role).toBe('collaborator');
    expect(result.status).toBe('active');
    expect(result.userId).toBe(COLLABORATOR_ID);
    expect(result.projectId).toBe(PROJECT_ID);
  });

  it('403: solicitante no es el creador del proyecto', async () => {
    await expect(
      useCase.execute({
        projectId: PROJECT_ID,
        requesterId: OTHER_USER,
        userId: COLLABORATOR_ID,
      })
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('404: proyecto no encontrado', async () => {
    await expect(
      useCase.execute({
        projectId: 'proyecto-inexistente',
        requesterId: CREATOR_ID,
        userId: COLLABORATOR_ID,
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('409: membresía duplicada activa', async () => {
    await useCase.execute({
      projectId: PROJECT_ID,
      requesterId: CREATOR_ID,
      userId: COLLABORATOR_ID,
    });
    await expect(
      useCase.execute({
        projectId: PROJECT_ID,
        requesterId: CREATOR_ID,
        userId: COLLABORATOR_ID,
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
