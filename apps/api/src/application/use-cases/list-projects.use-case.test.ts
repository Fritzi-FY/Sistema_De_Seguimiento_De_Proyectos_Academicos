import type { RemoveMembershipCondition } from '@is488/shared';
import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Project,
  ProjectMembership,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
} from '@is488/shared';
import { DuplicateMembershipError } from '@is488/shared';
import { ListProjectsUseCase, GetProjectByIdUseCase } from './list-projects.use-case.js';

const NOW = '2026-10-11T12:00:00.000Z';

class FakeProjectRepository implements ProjectRepositoryPort {
  constructor(public projects: Project[] = []) {}

  async save(project: Project): Promise<void> {
    this.projects.push({ ...project });
  }

  async findById(id: string): Promise<Project | null> {
    const found = this.projects.find((p) => p.id === id);
    return found ? { ...found } : null;
  }

  async findAll(): Promise<Project[]> {
    return this.projects.map((p) => ({ ...p }));
  }

  async findByUser(userId: string): Promise<Project[]> {
    return this.projects.filter((p) => p.creatorId === userId).map((p) => ({ ...p }));
  }
}

class FakeMembershipRepository implements MembershipRepositoryPort {
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

const P1_ID = '11111111-1111-4111-8111-111111111111';
const P2_ID = '22222222-2222-4222-8222-222222222222';
const P3_ID = '33333333-3333-4333-8333-333333333333';

const projectP1: Project = {
  id: P1_ID,
  title: 'Proyecto P1',
  courseCode: 'IS-488',
  status: 'active',
  startDate: '2026-10-15T00:00:00.000Z',
  targetDate: '2026-12-15T23:59:59.000Z',
  creatorId: 'student-A',
  createdAt: NOW,
  updatedAt: NOW,
};

const projectP2: Project = {
  id: P2_ID,
  title: 'Proyecto P2',
  courseCode: 'IS-488',
  status: 'active',
  startDate: '2026-10-20T00:00:00.000Z',
  targetDate: '2026-12-20T23:59:59.000Z',
  creatorId: 'student-B',
  createdAt: NOW,
  updatedAt: NOW,
};

const projectP3: Project = {
  id: P3_ID,
  title: 'Proyecto P3',
  courseCode: 'IS-488',
  status: 'active',
  startDate: '2026-10-25T00:00:00.000Z',
  targetDate: '2026-12-25T23:59:59.000Z',
  creatorId: 'student-C',
  createdAt: NOW,
  updatedAt: NOW,
};

// student-A es collaborator en P2
const membershipA_in_P2: ProjectMembership = {
  id: 'mem-a-p2',
  projectId: P2_ID,
  userId: 'student-A',
  role: 'collaborator',
  status: 'active',
  removedAt: null,
  joinedAt: NOW,
  updatedAt: NOW,
};

// student-A es owner de P1 (membresía owner)
const membershipA_owner_P1: ProjectMembership = {
  id: 'mem-a-p1-owner',
  projectId: P1_ID,
  userId: 'student-A',
  role: 'owner',
  status: 'active',
  removedAt: null,
  joinedAt: NOW,
  updatedAt: NOW,
};

describe('ListProjectsUseCase & GetProjectByIdUseCase (Aislamiento y Autorización)', () => {
  let repo: FakeProjectRepository;
  let membershipRepo: FakeMembershipRepository;
  let listUseCase: ListProjectsUseCase;
  let getByIdUseCase: GetProjectByIdUseCase;

  beforeEach(() => {
    repo = new FakeProjectRepository([projectP1, projectP2, projectP3]);
    membershipRepo = new FakeMembershipRepository([membershipA_owner_P1, membershipA_in_P2]);
    listUseCase = new ListProjectsUseCase(repo, membershipRepo);
    getByIdUseCase = new GetProjectByIdUseCase(repo, membershipRepo);
  });

  describe('ListProjectsUseCase', () => {
    it('debe retornar P1 (creado) y P2 (collaborator) para student-A — comportamiento actualizado con membresías', async () => {
      // Con el EPIC project-membership-access, student-A ve:
      //   - P1: proyecto que creó (findByUser del repositorio de proyectos)
      //   - P2: proyecto donde tiene membresía activa como collaborator (findByUser del repositorio de membresías)
      // Esto reemplaza el comportamiento anterior de solo retornar proyectos creados.
      const results = await listUseCase.execute({
        user: { userId: 'student-A', role: 'student' },
      });

      expect(results).toHaveLength(2);
      const ids = results.map((p) => p.id);
      expect(ids).toContain(P1_ID);
      expect(ids).toContain(P2_ID);
      expect(ids).not.toContain(P3_ID);
    });

    it('[P1-P2-P3] student-A ve P1 (creado) y P2 (collaborator), NO P3', async () => {
      const results = await listUseCase.execute({
        user: { userId: 'student-A', role: 'student' },
      });

      const ids = results.map((p) => p.id);
      expect(ids).toContain(P1_ID); // creado por student-A
      expect(ids).toContain(P2_ID); // collaborator en P2
      expect(ids).not.toContain(P3_ID); // sin acceso a P3
      expect(results).toHaveLength(2);
    });

    it('[Deduplicación] si student-A es creador Y tiene membresía, aparece una sola vez', async () => {
      // student-A es tanto creador (vía findByUser) como tiene membresía owner (vía findByUser de membresías)
      const results = await listUseCase.execute({
        user: { userId: 'student-A', role: 'student' },
      });

      const p1Occurrences = results.filter((p) => p.id === P1_ID);
      expect(p1Occurrences).toHaveLength(1);
    });

    it('debe retornar únicamente los proyectos de student-B cuando student-B consulta la lista', async () => {
      const results = await listUseCase.execute({
        user: { userId: 'student-B', role: 'student' },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(P2_ID);
      expect(results[0]?.creatorId).toBe('student-B');
    });

    it('debe retornar todos los proyectos si el rol es teacher o admin', async () => {
      const teacherResults = await listUseCase.execute({
        user: { userId: 'teacher-01', role: 'teacher' },
      });
      expect(teacherResults).toHaveLength(3);

      const adminResults = await listUseCase.execute({
        user: { userId: 'admin-01', role: 'admin' },
      });
      expect(adminResults).toHaveLength(3);
    });

    it('debe fallar si userId está vacío', async () => {
      await expect(
        listUseCase.execute({
          user: { userId: '  ' },
        }),
      ).rejects.toThrow(/identificador de usuario es obligatorio/i);
    });
  });

  describe('GetProjectByIdUseCase', () => {
    it('debe permitir a student-A consultar su propio proyecto (creador)', async () => {
      const result = await getByIdUseCase.execute({
        id: P1_ID,
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(P1_ID);
      expect(result?.title).toBe(projectP1.title);
    });

    it('[collaborator] acceso concedido a student-A en P2 donde es collaborator', async () => {
      const result = await getByIdUseCase.execute({
        id: P2_ID,
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(P2_ID);
    });

    it('[aislamiento] null (→ 404) cuando student-A intenta consultar P3 sin membresía', async () => {
      const result = await getByIdUseCase.execute({
        id: P3_ID,
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).toBeNull();
    });

    it('debe retornar null para IDs inexistentes', async () => {
      const result = await getByIdUseCase.execute({
        id: '99999999-9999-4999-8999-999999999999',
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).toBeNull();
    });

    it('creador tiene acceso aunque verificación de membresía también esté disponible', async () => {
      // Crear un repo de membresías vacío — el acceso del creador no debe depender de membresías
      const emptyMembershipRepo = new FakeMembershipRepository([]);
      const useCaseNoMemberships = new GetProjectByIdUseCase(repo, emptyMembershipRepo);

      const result = await useCaseNoMemberships.execute({
        id: P1_ID,
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(P1_ID);
    });

    it('debe permitir a un docente consultar proyectos de cualquier estudiante', async () => {
      const result = await getByIdUseCase.execute({
        id: P3_ID,
        user: { userId: 'teacher-01', role: 'teacher' },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(P3_ID);
    });
  });
});
