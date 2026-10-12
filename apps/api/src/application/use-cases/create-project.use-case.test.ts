import { describe, it, expect, beforeEach } from 'vitest';
import type { Project, ProjectRepositoryPort, SystemClockPort } from '@is488/shared';
import { CreateProjectUseCase } from './create-project.use-case.js';

class FakeClock implements SystemClockPort {
  constructor(private readonly fixedIso: string) {}

  now(): Date {
    return new Date(this.fixedIso);
  }

  isoString(): string {
    return this.fixedIso;
  }
}

class FakeProjectRepository implements ProjectRepositoryPort {
  public projects: Project[] = [];

  async save(project: Project): Promise<void> {
    const existingIndex = this.projects.findIndex((p) => p.id === project.id);
    if (existingIndex >= 0) {
      this.projects[existingIndex] = { ...project };
    } else {
      this.projects.push({ ...project });
    }
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

describe('CreateProjectUseCase', () => {
  const FIXED_TIME = '2026-10-11T14:30:00.000Z';
  const FIXED_ID = '12345678-1234-4234-8234-123456789abc';

  let fakeRepo: FakeProjectRepository;
  let fakeClock: FakeClock;
  let useCase: CreateProjectUseCase;

  beforeEach(() => {
    fakeRepo = new FakeProjectRepository();
    fakeClock = new FakeClock(FIXED_TIME);
    useCase = new CreateProjectUseCase(fakeRepo, fakeClock, () => FIXED_ID);
  });

  it('debe crear y persistir un proyecto con metadatos deterministas y estado active', async () => {
    const result = await useCase.execute({
      title: 'Sistema de Trazabilidad Académica',
      description: 'Plataforma para el curso IS-488',
      courseCode: 'IS-488',
      startDate: '2026-10-15T00:00:00.000Z',
      targetDate: '2026-12-20T23:59:59.000Z',
      creatorId: 'dev-student-01',
    });

    expect(result.id).toBe(FIXED_ID);
    expect(result.title).toBe('Sistema de Trazabilidad Académica');
    expect(result.status).toBe('active');
    expect(result.creatorId).toBe('dev-student-01');
    expect(result.createdAt).toBe(FIXED_TIME);
    expect(result.updatedAt).toBe(FIXED_TIME);

    // Verificar persistencia en el repositorio fake
    const persisted = await fakeRepo.findById(FIXED_ID);
    expect(persisted).not.toBeNull();
    expect(persisted?.title).toBe('Sistema de Trazabilidad Académica');
    expect(persisted?.status).toBe('active');
  });

  it('debe rechazar la creación si creatorId está vacío', async () => {
    await expect(
      useCase.execute({
        title: 'Proyecto Sin Creador',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-20T23:59:59.000Z',
        creatorId: '   ',
      }),
    ).rejects.toThrow(/identificador del creador es obligatorio/i);

    expect(fakeRepo.projects.length).toBe(0);
  });

  it('debe rechazar la creación si targetDate es anterior a startDate', async () => {
    await expect(
      useCase.execute({
        title: 'Proyecto Cronología Invertida',
        courseCode: 'IS-488',
        startDate: '2026-12-01T00:00:00.000Z',
        targetDate: '2026-10-01T00:00:00.000Z',
        creatorId: 'dev-student-01',
      }),
    ).rejects.toThrow();

    expect(fakeRepo.projects.length).toBe(0);
  });

  it('debe rechazar la creación si el título tiene menos de 3 caracteres', async () => {
    await expect(
      useCase.execute({
        title: 'ab',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-20T23:59:59.000Z',
        creatorId: 'dev-student-01',
      }),
    ).rejects.toThrow();

    expect(fakeRepo.projects.length).toBe(0);
  });
});
