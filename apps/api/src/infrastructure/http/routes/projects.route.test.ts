import { describe, it, expect, beforeEach } from 'vitest';
import type { SystemClockPort } from '@is488/shared';
import { ProjectResponseSchema } from '@is488/shared';
import { createApp } from '../app.js';
import { InMemoryProjectRepository } from '../../adapters/repositories/in-memory-project.repository.js';

class FakeClock implements SystemClockPort {
  constructor(private readonly iso: string) {}
  now(): Date {
    return new Date(this.iso);
  }
  isoString(): string {
    return this.iso;
  }
}

describe('Pruebas de integración HTTP de Proyectos (/api/projects)', () => {
  const FIXED_ISO = '2026-10-11T15:00:00.000Z';
  let repository: InMemoryProjectRepository;
  let testApp: ReturnType<typeof createApp>;

  beforeEach(() => {
    repository = new InMemoryProjectRepository();
    testApp = createApp({
      clock: new FakeClock(FIXED_ISO),
      projectRepository: repository,
      nodeEnv: 'development',
    });
  });

  describe('Creación de proyectos (POST /api/projects)', () => {
    const validPayload = {
      title: 'Sistema de Acreditación Universitaria',
      description: 'Módulo de evaluación por competencias',
      courseCode: 'IS-488',
      startDate: '2026-10-15T00:00:00.000Z',
      targetDate: '2026-12-20T23:59:59.000Z',
    };

    it('debe crear un proyecto exitosamente con HTTP 201 y asignar creador y estado active', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'dev-student-01',
          'X-Dev-User-Role': 'student',
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(201);
      const json = await res.json();

      const validation = ProjectResponseSchema.safeParse(json);
      expect(validation.success).toBe(true);

      if (validation.success) {
        expect(validation.data.title).toBe(validPayload.title);
        expect(validation.data.courseCode).toBe(validPayload.courseCode);
        expect(validation.data.creatorId).toBe('dev-student-01');
        expect(validation.data.status).toBe('active');
        expect(validation.data.createdAt).toBe(FIXED_ISO);
      }
    });

    it('debe rechazar con HTTP 400 si targetDate es cronológicamente anterior a startDate', async () => {
      const invalidDatesPayload = {
        ...validPayload,
        startDate: '2026-12-01T00:00:00.000Z',
        targetDate: '2026-11-01T00:00:00.000Z',
      };

      const res = await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'dev-student-01',
        },
        body: JSON.stringify(invalidDatesPayload),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; details?: unknown[] };
      expect(json.error).toBe('Bad Request');
    });

    it('debe rechazar con HTTP 400 ante campos obligatorios faltantes o título menor a 3 caracteres', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'dev-student-01',
        },
        body: JSON.stringify({ title: 'ab' }),
      });

      expect(res.status).toBe(400);
    });

    it('debe rechazar con HTTP 400 ante cuerpo JSON malformado', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'dev-student-01',
        },
        body: 'invalid-json{',
      });

      expect(res.status).toBe(400);
    });
  });

  describe('Aislamiento y Autorización en Consultas (GET /api/projects)', () => {
    beforeEach(async () => {
      // Registrar proyecto para student-A
      await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'student-A',
        },
        body: JSON.stringify({
          title: 'Proyecto de Student A',
          courseCode: 'IS-488',
          startDate: '2026-10-15T00:00:00.000Z',
          targetDate: '2026-11-15T00:00:00.000Z',
        }),
      });

      // Registrar proyecto para student-B
      await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'student-B',
        },
        body: JSON.stringify({
          title: 'Proyecto de Student B',
          courseCode: 'IS-488',
          startDate: '2026-10-20T00:00:00.000Z',
          targetDate: '2026-11-20T00:00:00.000Z',
        }),
      });
    });

    it('debe responder HTTP 200 y devolver ÚNICAMENTE los proyectos de student-A', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'student-A',
          'X-Dev-User-Role': 'student',
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');

      const json = (await res.json()) as Array<{ title: string; creatorId: string }>;
      expect(json).toHaveLength(1);
      expect(json[0]?.title).toBe('Proyecto de Student A');
      expect(json[0]?.creatorId).toBe('student-A');
    });

    it('debe responder HTTP 200 y devolver ÚNICAMENTE los proyectos de student-B', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'student-B',
          'X-Dev-User-Role': 'student',
        },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<{ title: string; creatorId: string }>;
      expect(json).toHaveLength(1);
      expect(json[0]?.title).toBe('Proyecto de Student B');
      expect(json[0]?.creatorId).toBe('student-B');
    });

    it('debe permitir a un docente ver todos los proyectos', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'teacher-01',
          'X-Dev-User-Role': 'teacher',
        },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<{ title: string }>;
      expect(json).toHaveLength(2);
    });
  });

  describe('Consulta de detalle de proyecto y ocultamiento por falta de autorización', () => {
    let projectAId: string;

    beforeEach(async () => {
      const res = await testApp.request('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'student-A',
        },
        body: JSON.stringify({
          title: 'Proyecto Confidencial A',
          courseCode: 'IS-488',
          startDate: '2026-10-15T00:00:00.000Z',
          targetDate: '2026-11-15T00:00:00.000Z',
        }),
      });
      const data = (await res.json()) as { id: string };
      projectAId = data.id;
    });

    it('debe permitir a student-A consultar su propio proyecto por ID', async () => {
      const res = await testApp.request(`/api/projects/${projectAId}`, {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'student-A',
        },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { id: string; title: string };
      expect(json.id).toBe(projectAId);
    });

    it('debe responder 404 Not Found cuando student-B intenta consultar el proyecto de student-A para no revelar su existencia', async () => {
      const res = await testApp.request(`/api/projects/${projectAId}`, {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'student-B',
        },
      });

      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Not Found');
    });

    it('debe responder 404 Not Found para IDs inexistentes', async () => {
      const res = await testApp.request('/api/projects/00000000-0000-4000-8000-000000000000', {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'student-A',
        },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('Salvaguardas de seguridad del contexto de desarrollo', () => {
    it('debe rechazar con HTTP 401 si no se envía la cabecera explícita X-Dev-User-Id (deshabilitado por defecto)', async () => {
      const res = await testApp.request('/api/projects', {
        method: 'GET',
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toMatch(/requiere la cabecera explícita X-Dev-User-Id/i);
    });

    it('debe rechazar estrictamente con HTTP 401 en producción incluso si se envían cabeceras X-Dev-User-Id', async () => {
      const prodApp = createApp({
        nodeEnv: 'production',
        projectRepository: repository,
      });

      const res = await prodApp.request('/api/projects', {
        method: 'GET',
        headers: {
          'X-Dev-User-Id': 'student-01',
        },
      });

      expect(res.status).toBe(401);
      const json = (await res.json()) as { error: string; message: string };
      expect(json.error).toBe('Unauthorized');
      expect(json.message).toMatch(/deshabilitado en entornos de producción/i);
    });
  });

  describe('Métodos HTTP no soportados (405 Method Not Allowed)', () => {
    it('PUT y DELETE en /api/projects deben retornar 405 con cabecera Allow: GET, POST', async () => {
      const putRes = await testApp.request('/api/projects', {
        method: 'PUT',
        headers: { 'X-Dev-User-Id': 'student-01' },
      });
      expect(putRes.status).toBe(405);
      expect(putRes.headers.get('Allow')).toBe('GET, POST');

      const delRes = await testApp.request('/api/projects', {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': 'student-01' },
      });
      expect(delRes.status).toBe(405);
      expect(delRes.headers.get('Allow')).toBe('GET, POST');
    });

    it('PUT y POST en /api/projects/:id deben retornar 405 con cabecera Allow: GET', async () => {
      const putRes = await testApp.request('/api/projects/123', {
        method: 'PUT',
        headers: { 'X-Dev-User-Id': 'student-01' },
      });
      expect(putRes.status).toBe(405);
      expect(putRes.headers.get('Allow')).toBe('GET');

      const postRes = await testApp.request('/api/projects/123', {
        method: 'POST',
        headers: { 'X-Dev-User-Id': 'student-01' },
      });
      expect(postRes.status).toBe(405);
      expect(postRes.headers.get('Allow')).toBe('GET');
    });
  });
});
