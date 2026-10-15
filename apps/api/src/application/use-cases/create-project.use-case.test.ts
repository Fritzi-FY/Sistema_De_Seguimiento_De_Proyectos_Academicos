import { describe, it, expect, beforeEach } from 'vitest';
import type {
  Project,
  ProjectMembership,
  ProjectCreationPort,
  SystemClockPort,
} from '@is488/shared';
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

/**
 * Puerto de creación fake que captura los argumentos recibidos para verificación.
 */
class FakeProjectCreationPort implements ProjectCreationPort {
  public capturedProject: Project | undefined;
  public capturedMembership: ProjectMembership | undefined;
  public shouldThrow: boolean = false;

  async createProjectWithOwner(
    project: Project,
    ownerMembership: ProjectMembership,
  ): Promise<void> {
    if (this.shouldThrow) {
      throw new Error('Error simulado en ProjectCreationPort');
    }
    this.capturedProject = project;
    this.capturedMembership = ownerMembership;
  }
}

describe('CreateProjectUseCase', () => {
  const FIXED_TIME = '2026-10-11T14:30:00.000Z';
  // Genera IDs secuenciales: primero el projectId, luego el membershipId
  let idCallCount: number;
  const FIXED_PROJECT_ID = '12345678-1234-4234-8234-123456789abc';
  const FIXED_MEMBERSHIP_ID = 'abcdef12-abcd-4abc-8abc-abcdef123456';

  let fakePort: FakeProjectCreationPort;
  let fakeClock: FakeClock;
  let useCase: CreateProjectUseCase;

  beforeEach(() => {
    idCallCount = 0;
    fakePort = new FakeProjectCreationPort();
    fakeClock = new FakeClock(FIXED_TIME);
    useCase = new CreateProjectUseCase(fakePort, fakeClock, () => {
      idCallCount++;
      return idCallCount === 1 ? FIXED_PROJECT_ID : FIXED_MEMBERSHIP_ID;
    });
  });

  it('crea proyecto y retorna respuesta con metadatos deterministas y estado active', async () => {
    const result = await useCase.execute({
      title: 'Sistema de Trazabilidad Académica',
      description: 'Plataforma para el curso IS-488',
      courseCode: 'IS-488',
      startDate: '2026-10-15T00:00:00.000Z',
      targetDate: '2026-12-20T23:59:59.000Z',
      creatorId: 'dev-student-01',
    });

    expect(result.id).toBe(FIXED_PROJECT_ID);
    expect(result.title).toBe('Sistema de Trazabilidad Académica');
    expect(result.status).toBe('active');
    expect(result.creatorId).toBe('dev-student-01');
    expect(result.createdAt).toBe(FIXED_TIME);
    expect(result.updatedAt).toBe(FIXED_TIME);
  });

  it('el ProjectCreationPort recibe tanto el proyecto como la membresía owner con campos correctos', async () => {
    await useCase.execute({
      title: 'Proyecto de Verificación de Puerto',
      courseCode: 'IS-488',
      startDate: '2026-10-15T00:00:00.000Z',
      targetDate: '2026-12-20T23:59:59.000Z',
      creatorId: 'student-creator',
    });

    // Verificar que el puerto recibió el proyecto
    expect(fakePort.capturedProject).toBeDefined();
    expect(fakePort.capturedProject?.id).toBe(FIXED_PROJECT_ID);
    expect(fakePort.capturedProject?.creatorId).toBe('student-creator');
    expect(fakePort.capturedProject?.status).toBe('active');

    // Verificar que el puerto recibió la membresía owner
    expect(fakePort.capturedMembership).toBeDefined();
    expect(fakePort.capturedMembership?.role).toBe('owner');
    expect(fakePort.capturedMembership?.status).toBe('active');
    expect(fakePort.capturedMembership?.userId).toBe('student-creator');
    expect(fakePort.capturedMembership?.projectId).toBe(FIXED_PROJECT_ID);
    expect(fakePort.capturedMembership?.id).toBe(FIXED_MEMBERSHIP_ID);
  });

  it('propaga el error del ProjectCreationPort si lanza', async () => {
    fakePort.shouldThrow = true;

    await expect(
      useCase.execute({
        title: 'Proyecto que fallará en la persistencia',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-20T23:59:59.000Z',
        creatorId: 'dev-student-01',
      }),
    ).rejects.toThrow('Error simulado en ProjectCreationPort');
  });

  it('[Atomicidad] ante fallo del ProjectCreationPort, ni proyecto ni membresía quedan persistidos', async () => {
    fakePort.shouldThrow = true;

    await expect(
      useCase.execute({
        title: 'Proyecto Atómico',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-20T23:59:59.000Z',
        creatorId: 'dev-student-01',
      }),
    ).rejects.toThrow();

    // Los valores capturados nunca se asignaron (el puerto lanzó antes)
    expect(fakePort.capturedProject).toBeUndefined();
    expect(fakePort.capturedMembership).toBeUndefined();
  });

  it('rechaza la creación si creatorId está vacío', async () => {
    await expect(
      useCase.execute({
        title: 'Proyecto Sin Creador',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-20T23:59:59.000Z',
        creatorId: '   ',
      }),
    ).rejects.toThrow(/identificador del creador es obligatorio/i);

    // El puerto no fue invocado
    expect(fakePort.capturedProject).toBeUndefined();
  });

  it('rechaza la creación si targetDate es anterior a startDate', async () => {
    await expect(
      useCase.execute({
        title: 'Proyecto Cronología Invertida',
        courseCode: 'IS-488',
        startDate: '2026-12-01T00:00:00.000Z',
        targetDate: '2026-10-01T00:00:00.000Z',
        creatorId: 'dev-student-01',
      }),
    ).rejects.toThrow();

    expect(fakePort.capturedProject).toBeUndefined();
  });

  it('rechaza la creación si el título tiene menos de 3 caracteres', async () => {
    await expect(
      useCase.execute({
        title: 'ab',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-20T23:59:59.000Z',
        creatorId: 'dev-student-01',
      }),
    ).rejects.toThrow();

    expect(fakePort.capturedProject).toBeUndefined();
  });
});
