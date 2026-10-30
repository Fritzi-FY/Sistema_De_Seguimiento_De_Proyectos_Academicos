import type { RemoveMembershipCondition } from '@is488/shared';
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Project,
  ProjectMembership,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
} from '@is488/shared';
import { DuplicateMembershipError } from '@is488/shared';
import { ListMembersUseCase } from './list-members.use-case.js';

const NOW = '2026-10-12T12:00:00.000Z';
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const CREATOR_ID = 'creator-user';
const COLLABORATOR_ID = 'collab-user';
const OUTSIDER_ID = 'outsider-user';

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

const ownerMembership: ProjectMembership = {
  id: 'cccccccc-cccc-4ccc-accc-cccccccccccc',
  projectId: PROJECT_ID,
  userId: CREATOR_ID,
  role: 'owner',
  status: 'active',
  removedAt: null,
  joinedAt: NOW,
  updatedAt: NOW,
};

const collaboratorMembership: ProjectMembership = {
  id: 'dddddddd-dddd-4ddd-addd-dddddddddddd',
  projectId: PROJECT_ID,
  userId: COLLABORATOR_ID,
  role: 'collaborator',
  status: 'active',
  removedAt: null,
  joinedAt: NOW,
  updatedAt: NOW,
};

class FakeProjectRepo implements ProjectRepositoryPort {
  constructor(private readonly projects: Project[] = []) {}
  async save(p: Project): Promise<void> {
    this.projects.push(p);
  }
  async findById(id: string): Promise<Project | null> {
    return this.projects.find((p) => p.id === id) ?? null;
  }
  async findAll(): Promise<Project[]> {
    return [...this.projects];
  }
  async findByUser(userId: string): Promise<Project[]> {
    return this.projects.filter((p) => p.creatorId === userId);
  }
}

class FakeMembershipRepo implements MembershipRepositoryPort {
  private memberships: ProjectMembership[];

  constructor(initialMemberships: ProjectMembership[] = []) {
    this.memberships = initialMemberships.map((m) => ({ ...m }));
  }

  async addMember(
    data: Omit<ProjectMembership, 'id'> & { id?: string },
  ): Promise<ProjectMembership> {
    const existing = this.memberships.find(
      (m) => m.projectId === data.projectId && m.userId === data.userId && m.status === 'active',
    );
    if (existing) throw new DuplicateMembershipError(data.projectId, data.userId);
    const membership: ProjectMembership = { id: crypto.randomUUID(), ...data };
    this.memberships.push(membership);
    return { ...membership };
  }

  async removeMember(condition: RemoveMembershipCondition): Promise<ProjectMembership> {
    const m = this.memberships.find(
      (m) =>
        m.id === condition.membershipId &&
        m.projectId === condition.projectId &&
        m.userId === condition.userId &&
        m.status === 'active' &&
        m.role === 'collaborator',
    );
    if (!m) throw new Error('Membership not found');
    m.status = 'removed';
    m.updatedAt = condition.removedAt;
    m.removedAt = condition.removedAt;
    return { ...m };
  }

  async findByProject(projectId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter((m) => m.projectId === projectId && m.status === 'active');
  }

  async findByUser(userId: string): Promise<ProjectMembership[]> {
    return this.memberships.filter((m) => m.userId === userId && m.status === 'active');
  }

  async findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMembership | null> {
    return (
      this.memberships.find(
        (m) => m.projectId === projectId && m.userId === userId && m.status === 'active',
      ) ?? null
    );
  }
}

describe('ListMembersUseCase', () => {
  let projectRepo: FakeProjectRepo;
  let membershipRepo: FakeMembershipRepo;
  let useCase: ListMembersUseCase;

  beforeEach(() => {
    projectRepo = new FakeProjectRepo([fakeProject]);
    membershipRepo = new FakeMembershipRepo([ownerMembership, collaboratorMembership]);
    useCase = new ListMembersUseCase(projectRepo, membershipRepo);
  });

  it('éxito: lista de miembros activos retornada correctamente para el owner', async () => {
    const result = await useCase.execute({
      projectId: PROJECT_ID,
      requesterId: CREATOR_ID,
    });
    expect(result).toHaveLength(2);
    const userIds = result.map((m) => m.userId);
    expect(userIds).toContain(CREATOR_ID);
    expect(userIds).toContain(COLLABORATOR_ID);
  });

  it('éxito: lista retornada correctamente para un collaborator', async () => {
    const result = await useCase.execute({
      projectId: PROJECT_ID,
      requesterId: COLLABORATOR_ID,
    });
    expect(result).toHaveLength(2);
  });

  it('404: proyecto no encontrado', async () => {
    await expect(
      useCase.execute({
        projectId: 'proyecto-inexistente',
        requesterId: CREATOR_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('404: solicitante sin membresía activa en el proyecto', async () => {
    await expect(
      useCase.execute({
        projectId: PROJECT_ID,
        requesterId: OUTSIDER_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('retorna solo membresías activas (excluye removed)', async () => {
    // Retirar al collaborator y verificar que ya no aparece
    const repoWithRemoved = new FakeMembershipRepo([
      ownerMembership,
      { ...collaboratorMembership, status: 'removed' },
    ]);
    const useCaseFiltered = new ListMembersUseCase(projectRepo, repoWithRemoved);

    const result = await useCaseFiltered.execute({
      projectId: PROJECT_ID,
      requesterId: CREATOR_ID,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.userId).toBe(CREATOR_ID);
  });
});
