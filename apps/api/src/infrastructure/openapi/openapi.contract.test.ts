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

  describe('Rutas de membresía /api/projects/{projectId}/members', () => {
    it('debe definir las operaciones POST y GET en /api/projects/{projectId}/members', () => {
      const membersPath = openApiSpec.paths['/api/projects/{projectId}/members'];
      expect(membersPath).toBeDefined();
      expect(membersPath.post).toBeDefined();
      expect(membersPath.get).toBeDefined();

      // Respuestas POST
      expect(membersPath.post.responses['201']).toBeDefined();
      expect(membersPath.post.responses['400']).toBeDefined();
      expect(membersPath.post.responses['401']).toBeDefined();
      expect(membersPath.post.responses['403']).toBeDefined();
      expect(membersPath.post.responses['404']).toBeDefined();
      expect(membersPath.post.responses['409']).toBeDefined();

      // Respuestas GET
      expect(membersPath.get.responses['200']).toBeDefined();
      expect(membersPath.get.responses['401']).toBeDefined();
      expect(membersPath.get.responses['404']).toBeDefined();
    });

    it('debe definir la operación DELETE en /api/projects/{projectId}/members/{userId}', () => {
      const memberPath = openApiSpec.paths['/api/projects/{projectId}/members/{userId}'];
      expect(memberPath).toBeDefined();
      expect(memberPath.delete).toBeDefined();

      expect(memberPath.delete.responses['200']).toBeDefined();
      expect(memberPath.delete.responses['401']).toBeDefined();
      expect(memberPath.delete.responses['403']).toBeDefined();
      expect(memberPath.delete.responses['404']).toBeDefined();
      expect(memberPath.delete.responses['422']).toBeDefined();
    });

    it('los schemas AddMemberRequest, MembershipResponse y MemberListResponse deben estar en components/schemas', () => {
      const schemas = openApiSpec.components.schemas;
      expect(schemas.AddMemberRequest).toBeDefined();
      expect(schemas.MembershipResponse).toBeDefined();
      expect(schemas.MemberListResponse).toBeDefined();
    });

    it('MembershipResponse debe incluir todos los campos de ProjectMembership', () => {
      const schema = openApiSpec.components.schemas.MembershipResponse;
      const requiredFields = schema.required;
      expect(requiredFields).toContain('id');
      expect(requiredFields).toContain('projectId');
      expect(requiredFields).toContain('userId');
      expect(requiredFields).toContain('role');
      expect(requiredFields).toContain('status');
      expect(requiredFields).toContain('joinedAt');
      expect(requiredFields).toContain('updatedAt');
    });

    it('AddMemberRequest solo acepta role collaborator en el enum', () => {
      const schema = openApiSpec.components.schemas.AddMemberRequest;
      const roleEnum = (schema.properties.role as unknown as { enum: string[] }).enum;
      expect(roleEnum).toEqual(['collaborator']);
      expect(roleEnum).not.toContain('owner');
    });

    it('los paths de membresía usan $ref a componentes (no schemas inline)', () => {
      const membersPath = openApiSpec.paths['/api/projects/{projectId}/members'];
      const post201Content = membersPath.post.responses['201'].content['application/json'].schema;
      expect(post201Content).toHaveProperty('$ref');
      expect((post201Content as { $ref: string })['$ref']).toContain('MembershipResponse');

      const get200Content = membersPath.get.responses['200'].content['application/json'].schema;
      expect(get200Content).toHaveProperty('$ref');
      expect((get200Content as { $ref: string })['$ref']).toContain('MemberListResponse');

      const memberPath = openApiSpec.paths['/api/projects/{projectId}/members/{userId}'];
      const delete200Content = memberPath.delete.responses['200'].content['application/json'].schema;
      expect(delete200Content).toHaveProperty('$ref');
      expect((delete200Content as { $ref: string })['$ref']).toContain('MembershipResponse');
    });
  });
});
