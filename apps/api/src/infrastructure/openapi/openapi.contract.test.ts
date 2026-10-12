import { describe, it, expect } from 'vitest';
import {
  HealthResponseSchema,
  ProjectResponseSchema,
  CreateProjectRequestSchema,
} from '@is488/shared';
import { openApiSpec } from './openapi.contract.js';

describe('OpenAPI 3.1 Contract Specification', () => {
  it('debe definir la versión OpenAPI 3.1.0 y metadatos del sistema', () => {
    expect(openApiSpec.openapi).toBe('3.1.0');
    expect(openApiSpec.info.title).toContain('IS488');
    expect(openApiSpec.info.version).toBe('0.1.0');
  });

  describe('Ruta /api/health', () => {
    it('debe incluir la ruta /api/health con método GET y cabecera Cache-Control', () => {
      const healthPath = openApiSpec.paths['/api/health'];
      expect(healthPath).toBeDefined();
      expect(healthPath.get).toBeDefined();
      expect(healthPath.get.responses['200']).toBeDefined();

      const headers = healthPath.get.responses['200'].headers;
      expect(headers['Cache-Control']).toBeDefined();
      expect(headers['Cache-Control'].schema.example).toBe('no-cache, no-store, must-revalidate');
    });

    it('debe definir las propiedades del esquema en coincidencia con HealthResponseSchema', () => {
      const schema =
        openApiSpec.paths['/api/health'].get.responses['200'].content['application/json'].schema;

      expect(schema.required).toEqual(['status', 'timestamp', 'version']);
      expect(schema.properties.status.const).toBe('ok');
      expect(schema.properties.timestamp.format).toBe('date-time');
      expect(schema.properties.version.minLength).toBe(1);

      const sample = {
        status: schema.properties.status.const,
        timestamp: '2026-10-10T12:00:00.000Z',
        version: '0.1.0',
      };

      const parsed = HealthResponseSchema.safeParse(sample);
      expect(parsed.success).toBe(true);
    });

    it('debe documentar la respuesta 405 Method Not Allowed y cabecera Allow', () => {
      const healthPath = openApiSpec.paths['/api/health'];
      expect(healthPath.get.responses['405']).toBeDefined();

      const headers = healthPath.get.responses['405'].headers;
      expect(headers.Allow).toBeDefined();
      expect(headers.Allow.schema.example).toBe('GET');
    });
  });

  describe('Ruta /api/projects y /api/projects/{id}', () => {
    it('debe definir las operaciones GET y POST en /api/projects', () => {
      const projectsPath = openApiSpec.paths['/api/projects'];
      expect(projectsPath).toBeDefined();
      expect(projectsPath.get).toBeDefined();
      expect(projectsPath.post).toBeDefined();

      // Respuestas GET
      expect(projectsPath.get.responses['200']).toBeDefined();
      expect(projectsPath.get.responses['401']).toBeDefined();
      expect(projectsPath.get.responses['405']).toBeDefined();

      // Respuestas POST
      expect(projectsPath.post.responses['201']).toBeDefined();
      expect(projectsPath.post.responses['400']).toBeDefined();
      expect(projectsPath.post.responses['401']).toBeDefined();
      expect(projectsPath.post.responses['405']).toBeDefined();
    });

    it('debe definir la operación GET en /api/projects/{id} con respuestas 200, 401, 404 y 405', () => {
      const detailPath = openApiSpec.paths['/api/projects/{id}'];
      expect(detailPath).toBeDefined();
      expect(detailPath.get).toBeDefined();
      expect(detailPath.get.responses['200']).toBeDefined();
      expect(detailPath.get.responses['401']).toBeDefined();
      expect(detailPath.get.responses['404']).toBeDefined();
      expect(detailPath.get.responses['405']).toBeDefined();
    });

    it('los esquemas de componentes deben alinearse con los esquemas Zod de @is488/shared', () => {
      const schemas = openApiSpec.components.schemas;
      expect(schemas.Project).toBeDefined();
      expect(schemas.CreateProjectRequest).toBeDefined();

      const sampleRequest = {
        title: 'Proyecto OpenAPI Test',
        courseCode: 'IS-488',
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-15T00:00:00.000Z',
      };
      expect(CreateProjectRequestSchema.safeParse(sampleRequest).success).toBe(true);

      const sampleProject = {
        id: '12345678-1234-4234-8234-123456789abc',
        title: 'Proyecto OpenAPI Test',
        courseCode: 'IS-488',
        status: 'active' as const,
        startDate: '2026-10-15T00:00:00.000Z',
        targetDate: '2026-12-15T00:00:00.000Z',
        creatorId: 'dev-student-01',
        createdAt: '2026-10-11T12:00:00.000Z',
        updatedAt: '2026-10-11T12:00:00.000Z',
      };
      expect(ProjectResponseSchema.safeParse(sampleProject).success).toBe(true);
    });
  });
});
