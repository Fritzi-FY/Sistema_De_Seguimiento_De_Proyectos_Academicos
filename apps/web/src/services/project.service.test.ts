import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchProjects, createProject } from './project.service.js';

describe('project.service', () => {
  const sampleProject = {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    title: 'Proyecto de Prueba',
    description: 'Descripción de prueba',
    courseCode: 'IS-488',
    status: 'active' as const,
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-15T23:59:59.000Z',
    creatorId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-11T12:00:00.000Z',
    updatedAt: '2026-10-11T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchProjects', () => {
    it('debe retornar lista de proyectos cuando la respuesta es 200 y conforme al contrato', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [sampleProject],
      } as Response);

      const result = await fetchProjects({ userId: 'student-A', role: 'student' });

      expect(result).toEqual([sampleProject]);
      expect(fetch).toHaveBeenCalledWith('/api/projects', {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'student-A',
          'X-Dev-User-Role': 'student',
        },
      });
    });

    it('debe lanzar error cuando el servidor responde con 401 Unauthorized', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
        json: async () => ({ message: 'Acceso no autorizado' }),
      } as Response);

      await expect(fetchProjects()).rejects.toThrow(/Acceso no autorizado/i);
    });

    it('debe lanzar error si el esquema de la lista recibida es inválido', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ invalid: 'data' }],
      } as Response);

      await expect(fetchProjects()).rejects.toThrow(/Respuesta inválida del servidor/i);
    });
  });

  describe('createProject', () => {
    const validCreateRequest = {
      title: 'Nuevo Proyecto',
      description: 'Descripción válida',
      courseCode: 'IS-488',
      startDate: '2026-10-15T00:00:00.000Z',
      targetDate: '2026-12-15T23:59:59.000Z',
    };

    it('debe crear un proyecto exitosamente enviando cabeceras y cuerpo validado', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleProject,
      } as Response);

      const result = await createProject(validCreateRequest, {
        userId: '11111111-1111-4111-8111-111111111111',
        role: 'student',
      });

      expect(result).toEqual(sampleProject);
      expect(fetch).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(validCreateRequest),
        }),
      );
    });

    it('debe rechazar previamente en cliente si las fechas son invertidas sin llamar a fetch', async () => {
      const invalidDatesRequest = {
        ...validCreateRequest,
        startDate: '2026-12-01T00:00:00.000Z',
        targetDate: '2026-10-01T00:00:00.000Z',
      };

      await expect(createProject(invalidDatesRequest)).rejects.toThrow(
        /no puede ser anterior a la fecha de inicio/i,
      );

      expect(fetch).not.toHaveBeenCalled();
    });

    it('debe lanzar error detallado si el backend responde con error 400 y detalles', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          error: 'Bad Request',
          message: 'Error de validación',
          details: [{ message: 'El código de curso debe tener al menos 2 caracteres' }],
        }),
      } as Response);

      await expect(createProject(validCreateRequest)).rejects.toThrow(
        /El código de curso debe tener al menos 2 caracteres/i,
      );
    });
  });
});
