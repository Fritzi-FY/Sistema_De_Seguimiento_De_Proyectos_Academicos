import { describe, it, expect } from 'vitest';
import {
  CreateProjectRequestSchema,
  ProjectResponseSchema,
  ProjectListResponseSchema,
} from './project.contract.js';

describe('CreateProjectRequestSchema', () => {
  const validBasePayload = {
    title: 'Sistema de Seguimiento Académico',
    description: 'Plataforma para gestión de proyectos e investigación IS488',
    courseCode: 'IS-488',
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
  };

  it('debe validar exitosamente un payload completo y válido', () => {
    const result = CreateProjectRequestSchema.safeParse(validBasePayload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe(validBasePayload.title);
      expect(result.data.courseCode).toBe(validBasePayload.courseCode);
      expect(result.data.startDate).toBe(validBasePayload.startDate);
      expect(result.data.targetDate).toBe(validBasePayload.targetDate);
    }
  });

  it('debe validar un payload sin descripción opcional', () => {
    const { description: _, ...withoutDescription } = validBasePayload;
    const result = CreateProjectRequestSchema.safeParse(withoutDescription);

    expect(result.success).toBe(true);
  });

  it('debe aceptar fechas donde startDate y targetDate sean idénticas', () => {
    const payload = {
      ...validBasePayload,
      startDate: '2026-11-01T10:00:00.000Z',
      targetDate: '2026-11-01T10:00:00.000Z',
    };

    const result = CreateProjectRequestSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it('debe rechazar cuando targetDate es cronológicamente anterior a startDate', () => {
    const payload = {
      ...validBasePayload,
      startDate: '2026-12-01T00:00:00.000Z',
      targetDate: '2026-11-01T00:00:00.000Z',
    };

    const result = CreateProjectRequestSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issues = result.error.issues ?? [];
      const errorPaths = issues.map((e) => e.path.join('.'));
      expect(errorPaths).toContain('targetDate');
      expect(issues[0]?.message).toMatch(/no puede ser anterior a la fecha de inicio/i);
    }
  });

  it('debe rechazar títulos con longitud menor a 3 caracteres o solo espacios en blanco', () => {
    const invalidTitles = ['', '  ', 'ab', ' a '];

    for (const title of invalidTitles) {
      const result = CreateProjectRequestSchema.safeParse({
        ...validBasePayload,
        title,
      });
      expect(result.success).toBe(false);
    }
  });

  it('debe rechazar títulos que excedan 120 caracteres', () => {
    const longTitle = 'A'.repeat(121);
    const result = CreateProjectRequestSchema.safeParse({
      ...validBasePayload,
      title: longTitle,
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar descripciones que excedan 500 caracteres', () => {
    const longDescription = 'D'.repeat(501);
    const result = CreateProjectRequestSchema.safeParse({
      ...validBasePayload,
      description: longDescription,
    });

    expect(result.success).toBe(false);
  });

  it('debe rechazar formatos de fechas que no cumplan ISO-8601 UTC estricto', () => {
    const invalidDates = ['2026-10-15', '15/10/2026', 'not-a-date', '2026-13-40T00:00:00Z', ''];

    for (const date of invalidDates) {
      const resultStart = CreateProjectRequestSchema.safeParse({
        ...validBasePayload,
        startDate: date,
      });
      expect(resultStart.success).toBe(false);

      const resultTarget = CreateProjectRequestSchema.safeParse({
        ...validBasePayload,
        targetDate: date,
      });
      expect(resultTarget.success).toBe(false);
    }
  });

  it('debe rechazar payloads a los que les falten campos obligatorios', () => {
    expect(CreateProjectRequestSchema.safeParse({}).success).toBe(false);
    expect(
      CreateProjectRequestSchema.safeParse({
        description: 'Algo',
      }).success,
    ).toBe(false);
  });
});

describe('ProjectResponseSchema', () => {
  const validProjectResponse = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    title: 'Proyecto de Prueba',
    description: 'Descripción de prueba',
    courseCode: 'IS-488',
    status: 'active' as const,
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
    creatorId: 'dev-student-01',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };

  it('debe validar un objeto de proyecto completo', () => {
    const result = ProjectResponseSchema.safeParse(validProjectResponse);
    expect(result.success).toBe(true);
  });

  it('debe rechazar si el id no es un UUID válido', () => {
    const result = ProjectResponseSchema.safeParse({
      ...validProjectResponse,
      id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('debe rechazar estados no permitidos', () => {
    const result = ProjectResponseSchema.safeParse({
      ...validProjectResponse,
      status: 'pending',
    });
    expect(result.success).toBe(false);
  });
});

describe('ProjectListResponseSchema', () => {
  it('debe validar un array de proyectos y también un array vacío', () => {
    expect(ProjectListResponseSchema.safeParse([]).success).toBe(true);

    const validList = [
      {
        id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        title: 'Proyecto 1',
        courseCode: 'IS-488',
        status: 'active',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-15T23:59:59.000Z',
        creatorId: 'dev-student-01',
        createdAt: '2026-10-11T12:00:00.000Z',
        updatedAt: '2026-10-11T12:00:00.000Z',
      },
    ];

    expect(ProjectListResponseSchema.safeParse(validList).success).toBe(true);
  });

  it('debe rechazar si la carga no es un array', () => {
    expect(ProjectListResponseSchema.safeParse({}).success).toBe(false);
  });
});
