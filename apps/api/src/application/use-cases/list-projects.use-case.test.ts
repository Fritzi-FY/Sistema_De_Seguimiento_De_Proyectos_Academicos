import { describe, it, expect, beforeEach } from 'vitest';
import type { Project, ProjectRepositoryPort } from '@is488/shared';
import { ListProjectsUseCase, GetProjectByIdUseCase } from './list-projects.use-case.js';

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

describe('ListProjectsUseCase & GetProjectByIdUseCase (Aislamiento y Autorización)', () => {
  const projectStudentA: Project = {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Proyecto Estudiante A',
    courseCode: 'IS-488',
    status: 'active',
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
    creatorId: 'student-A',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };

  const projectStudentB: Project = {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Proyecto Estudiante B',
    courseCode: 'IS-488',
    status: 'active',
    startDate: '2026-10-20T00:00:00.000Z',
    targetDate: '2026-12-20T23:59:59.000Z',
    creatorId: 'student-B',
    createdAt: '2026-10-11T13:00:00.000Z',
    updatedAt: '2026-10-11T13:00:00.000Z',
  };

  let repo: FakeProjectRepository;
  let listUseCase: ListProjectsUseCase;
  let getByIdUseCase: GetProjectByIdUseCase;

  beforeEach(() => {
    repo = new FakeProjectRepository([projectStudentA, projectStudentB]);
    listUseCase = new ListProjectsUseCase(repo);
    getByIdUseCase = new GetProjectByIdUseCase(repo);
  });

  describe('ListProjectsUseCase', () => {
    it('debe retornar únicamente los proyectos de student-A cuando student-A consulta la lista', async () => {
      const results = await listUseCase.execute({
        user: { userId: 'student-A', role: 'student' },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(projectStudentA.id);
      expect(results[0]?.creatorId).toBe('student-A');
      // Asegurar que no se filtran ni exponen proyectos de student-B
      expect(results.some((p) => p.creatorId === 'student-B')).toBe(false);
    });

    it('debe retornar únicamente los proyectos de student-B cuando student-B consulta la lista', async () => {
      const results = await listUseCase.execute({
        user: { userId: 'student-B', role: 'student' },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(projectStudentB.id);
      expect(results[0]?.creatorId).toBe('student-B');
    });

    it('debe retornar todos los proyectos si el rol es teacher o admin', async () => {
      const teacherResults = await listUseCase.execute({
        user: { userId: 'teacher-01', role: 'teacher' },
      });
      expect(teacherResults).toHaveLength(2);

      const adminResults = await listUseCase.execute({
        user: { userId: 'admin-01', role: 'admin' },
      });
      expect(adminResults).toHaveLength(2);
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
    it('debe permitir a student-A consultar su propio proyecto', async () => {
      const result = await getByIdUseCase.execute({
        id: projectStudentA.id,
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(projectStudentA.id);
      expect(result?.title).toBe(projectStudentA.title);
    });

    it('debe retornar null cuando student-A intenta consultar el proyecto ajeno de student-B (404 para ocultar existencia)', async () => {
      const result = await getByIdUseCase.execute({
        id: projectStudentB.id,
        user: { userId: 'student-A', role: 'student' },
      });

      // Retorna null para disparar 404 Not Found y prevenir enumeración
      expect(result).toBeNull();
    });

    it('debe retornar null para IDs inexistentes', async () => {
      const result = await getByIdUseCase.execute({
        id: '99999999-9999-4999-8999-999999999999',
        user: { userId: 'student-A', role: 'student' },
      });

      expect(result).toBeNull();
    });

    it('debe permitir a un docente consultar proyectos de cualquier estudiante', async () => {
      const result = await getByIdUseCase.execute({
        id: projectStudentB.id,
        user: { userId: 'teacher-01', role: 'teacher' },
      });

      expect(result).not.toBeNull();
      expect(result?.id).toBe(projectStudentB.id);
    });
  });
});
