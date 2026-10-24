import { describe, it, expect } from 'vitest';
import {
  HealthResponseSchema,
  ProjectResponseSchema,
  CreateProjectRequestSchema,
  CreateBoardColumnSchema,
  UpdateBoardColumnSchema,
  BoardResponseSchema,
  BoardColumnResponseSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  MoveTaskSchema,
  TaskResponseSchema,
  PaginatedTasksResponseSchema,
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
      const delete200Content =
        memberPath.delete.responses['200'].content['application/json'].schema;
      expect(delete200Content).toHaveProperty('$ref');
      expect((delete200Content as { $ref: string })['$ref']).toContain('MembershipResponse');
    });
  });

  describe('Rutas de tablero y columnas (/api/projects/{projectId}/board y /columns)', () => {
    it('debe definir la operación GET en /api/projects/{projectId}/board con respuestas 200, 400, 401, 404, 405 y Cache-Control: no-store', () => {
      const boardPath = openApiSpec.paths['/api/projects/{projectId}/board'];
      expect(boardPath).toBeDefined();
      expect(boardPath.get).toBeDefined();

      const getOp = boardPath.get;
      expect(getOp.responses['200']).toBeDefined();
      expect(getOp.responses['400']).toBeDefined();
      expect(getOp.responses['401']).toBeDefined();
      expect(getOp.responses['404']).toBeDefined();
      expect(getOp.responses['405']).toBeDefined();
      expect(getOp.responses['500']).toBeDefined();
      expect(getOp.responses['500'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/ErrorResponse',
      });

      const headers = getOp.responses['200'].headers;
      expect(headers['Cache-Control']).toBeDefined();
      expect(headers['Cache-Control'].schema.example).toBe('no-store');

      const content = getOp.responses['200'].content['application/json'];
      expect(content.schema).toEqual({ $ref: '#/components/schemas/BoardResponse' });
    });

    it('debe definir la operación POST en /api/projects/{projectId}/board/columns con respuestas 201, 400, 401, 404, 405', () => {
      const colPath = openApiSpec.paths['/api/projects/{projectId}/board/columns'];
      expect(colPath).toBeDefined();
      expect(colPath.post).toBeDefined();

      const postOp = colPath.post;
      expect(postOp.responses['201']).toBeDefined();
      expect(postOp.responses['400']).toBeDefined();
      expect(postOp.responses['401']).toBeDefined();
      expect(postOp.responses['404']).toBeDefined();
      expect(postOp.responses['405']).toBeDefined();
      expect(postOp.responses['500']).toBeDefined();
      expect(postOp.responses['500'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/ErrorResponse',
      });

      const bodyContent = postOp.requestBody.content['application/json'];
      expect(bodyContent.schema).toEqual({ $ref: '#/components/schemas/CreateBoardColumnRequest' });

      const resContent = postOp.responses['201'].content['application/json'];
      expect(resContent.schema).toEqual({ $ref: '#/components/schemas/BoardColumnResponse' });
    });

    it('debe definir las operaciones PATCH y DELETE en /api/projects/{projectId}/board/columns/{columnId}', () => {
      const colDetailPath = openApiSpec.paths['/api/projects/{projectId}/board/columns/{columnId}'];
      expect(colDetailPath).toBeDefined();
      expect(colDetailPath.patch).toBeDefined();
      expect(colDetailPath.delete).toBeDefined();

      // PATCH responses
      const patchOp = colDetailPath.patch;
      expect(patchOp.responses['200']).toBeDefined();
      expect(patchOp.responses['400']).toBeDefined();
      expect(patchOp.responses['401']).toBeDefined();
      expect(patchOp.responses['404']).toBeDefined();
      expect(patchOp.responses['405']).toBeDefined();
      expect(patchOp.responses['500']).toBeDefined();
      expect(patchOp.responses['500'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/ErrorResponse',
      });
      expect(patchOp.requestBody.content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/UpdateBoardColumnRequest',
      });
      expect(patchOp.responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/BoardColumnResponse',
      });

      // DELETE responses
      const deleteOp = colDetailPath.delete;
      expect(deleteOp.responses['200']).toBeDefined();
      expect(deleteOp.responses['400']).toBeDefined();
      expect(deleteOp.responses['401']).toBeDefined();
      expect(deleteOp.responses['404']).toBeDefined();
      expect(deleteOp.responses['409']).toBeDefined();
      expect(deleteOp.responses['405']).toBeDefined();
      expect(deleteOp.responses['500']).toBeDefined();
      expect(deleteOp.responses['500'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/ErrorResponse',
      });
      expect(deleteOp.responses['200'].content['application/json'].schema).toEqual({
        $ref: '#/components/schemas/DeleteBoardColumnResponse',
      });

      // TargetColumnId query param
      const targetQueryParam = deleteOp.parameters.find(
        (p: { name: string }) => p.name === 'targetColumnId',
      );
      expect(targetQueryParam).toBeDefined();
      expect(targetQueryParam?.in).toBe('query');
      expect(targetQueryParam?.required).toBe(false);
    });

    it('los esquemas de tablero y columnas deben estar en components/schemas y coincidir con @is488/shared', () => {
      const schemas = openApiSpec.components.schemas;
      expect(schemas.ColumnCategory).toBeDefined();
      expect(schemas.CreateBoardColumnRequest).toBeDefined();
      expect(schemas.UpdateBoardColumnRequest).toBeDefined();
      expect(schemas.BoardColumnResponse).toBeDefined();
      expect(schemas.BoardResponse).toBeDefined();
      expect(schemas.DeleteBoardColumnResponse).toBeDefined();

      // Validación con Zod
      const sampleCreate = {
        name: 'En Revisión',
        category: 'IN_REVIEW' as const,
        color: '#f59e0b',
      };
      expect(CreateBoardColumnSchema.safeParse(sampleCreate).success).toBe(true);

      const sampleUpdate = { name: 'Completado', orderIndex: 3 };
      expect(UpdateBoardColumnSchema.safeParse(sampleUpdate).success).toBe(true);

      // Verificación de restricciones estructurales OpenAPI (additionalProperties y minProperties)
      expect(schemas.CreateBoardColumnRequest.additionalProperties).toBe(false);
      expect(schemas.UpdateBoardColumnRequest.additionalProperties).toBe(false);
      expect(schemas.UpdateBoardColumnRequest.minProperties).toBe(1);

      // Casos negativos de contrato: Zod rechaza campos desconocidos (additionalProperties: false)
      expect(
        CreateBoardColumnSchema.safeParse({
          name: 'Columna',
          campoDesconocido: 'invalido',
        }).success,
      ).toBe(false);

      expect(
        UpdateBoardColumnSchema.safeParse({
          name: 'Columna',
          campoDesconocido: 999,
        }).success,
      ).toBe(false);

      // Casos negativos de contrato: PATCH rechaza payload vacío (minProperties: 1)
      expect(UpdateBoardColumnSchema.safeParse({}).success).toBe(false);
      expect(
        UpdateBoardColumnSchema.safeParse({
          name: undefined,
          color: undefined,
          category: undefined,
          orderIndex: undefined,
        }).success,
      ).toBe(false);

      // Casos negativos de contrato: validaciones de dominio
      expect(CreateBoardColumnSchema.safeParse({ name: '' }).success).toBe(false);
      expect(CreateBoardColumnSchema.safeParse({ name: 'Col', color: 'no-hex' }).success).toBe(
        false,
      );
      expect(UpdateBoardColumnSchema.safeParse({ orderIndex: -1 }).success).toBe(false);

      const sampleColResponse = {
        id: '12345678-1234-4234-8234-123456789abc',
        boardId: '12345678-1234-4234-8234-123456789def',
        name: 'TODO',
        orderIndex: 0,
        category: 'TODO' as const,
        createdAt: '2026-10-23T12:00:00.000Z',
        updatedAt: '2026-10-23T12:00:00.000Z',
      };
      expect(BoardColumnResponseSchema.safeParse(sampleColResponse).success).toBe(true);

      const sampleBoardResponse = {
        id: '12345678-1234-4234-8234-123456789def',
        projectId: '12345678-1234-4234-8234-123456789000',
        columns: [sampleColResponse],
        createdAt: '2026-10-23T12:00:00.000Z',
        updatedAt: '2026-10-23T12:00:00.000Z',
      };
      expect(BoardResponseSchema.safeParse(sampleBoardResponse).success).toBe(true);
    });
  });

  describe('Rutas de Tareas (/api/projects/{projectId}/tasks)', () => {
    it('debe definir las operaciones GET y POST en /api/projects/{projectId}/tasks con cabecera Cache-Control: no-store', () => {
      const tasksPath = openApiSpec.paths['/api/projects/{projectId}/tasks'];
      expect(tasksPath).toBeDefined();
      expect(tasksPath.get).toBeDefined();
      expect(tasksPath.post).toBeDefined();

      // GET responses
      expect(tasksPath.get.responses['200']).toBeDefined();
      expect(tasksPath.get.responses['200'].headers['Cache-Control'].schema.example).toBe(
        'no-store',
      );
      expect(tasksPath.get.responses['400']).toBeDefined();
      expect(tasksPath.get.responses['401']).toBeDefined();
      expect(tasksPath.get.responses['404']).toBeDefined();
      expect(tasksPath.get.responses['405']).toBeDefined();
      expect(tasksPath.get.responses['405'].headers.Allow.schema.example).toBe('GET, POST');
      expect(tasksPath.get.responses['500']).toBeDefined();

      // POST responses
      expect(tasksPath.post.responses['201']).toBeDefined();
      expect(tasksPath.post.responses['201'].headers['Cache-Control'].schema.example).toBe(
        'no-store',
      );
      expect(tasksPath.post.responses['400']).toBeDefined();
      expect(tasksPath.post.responses['401']).toBeDefined();
      expect(tasksPath.post.responses['404']).toBeDefined();
      expect(tasksPath.post.responses['405']).toBeDefined();
      expect(tasksPath.post.responses['405'].headers.Allow.schema.example).toBe('GET, POST');
      expect(tasksPath.post.responses['500']).toBeDefined();
    });

    it('debe definir la operación PATCH en /api/projects/{projectId}/tasks/{taskId} con Allow: PATCH', () => {
      const updatePath = openApiSpec.paths['/api/projects/{projectId}/tasks/{taskId}'];
      expect(updatePath).toBeDefined();
      expect(updatePath.patch).toBeDefined();
      expect(updatePath.patch.responses['200']).toBeDefined();
      expect(updatePath.patch.responses['200'].headers['Cache-Control'].schema.example).toBe(
        'no-store',
      );
      expect(updatePath.patch.responses['400']).toBeDefined();
      expect(updatePath.patch.responses['401']).toBeDefined();
      expect(updatePath.patch.responses['404']).toBeDefined();
      expect(updatePath.patch.responses['405']).toBeDefined();
      expect(updatePath.patch.responses['405'].headers.Allow.schema.example).toBe('PATCH');
      expect(updatePath.patch.responses['500']).toBeDefined();
    });

    it('debe definir la operación POST en /api/projects/{projectId}/tasks/{taskId}/move con Allow: POST', () => {
      const movePath = openApiSpec.paths['/api/projects/{projectId}/tasks/{taskId}/move'];
      expect(movePath).toBeDefined();
      expect(movePath.post).toBeDefined();
      expect(movePath.post.responses['200']).toBeDefined();
      expect(movePath.post.responses['200'].headers['Cache-Control'].schema.example).toBe(
        'no-store',
      );
      expect(movePath.post.responses['400']).toBeDefined();
      expect(movePath.post.responses['401']).toBeDefined();
      expect(movePath.post.responses['404']).toBeDefined();
      expect(movePath.post.responses['405']).toBeDefined();
      expect(movePath.post.responses['405'].headers.Allow.schema.example).toBe('POST');
      expect(movePath.post.responses['500']).toBeDefined();
    });

    it('los esquemas de componentes de tareas deben alinearse con los contratos Zod de @is488/shared', () => {
      const schemas = openApiSpec.components.schemas;
      expect(schemas.TaskPriority).toBeDefined();
      expect(schemas.CreateTaskRequest).toBeDefined();
      expect(schemas.UpdateTaskRequest).toBeDefined();
      expect(schemas.MoveTaskRequest).toBeDefined();
      expect(schemas.TaskResponse).toBeDefined();
      expect(schemas.PaginatedTasksResponse).toBeDefined();

      // Validación con Zod de muestras conformes
      const sampleCreate = {
        title: 'Implementar endpoint tareas',
        description: 'Endpoint RESTful con Hono',
        columnId: '12345678-1234-4234-8234-123456789001',
        priority: 'HIGH' as const,
        dueDate: '2026-11-01T12:00:00.000Z',
        labels: ['backend', 'kanban'],
        assigneeIds: ['12345678-1234-4234-8234-123456789002'],
      };
      expect(CreateTaskSchema.safeParse(sampleCreate).success).toBe(true);

      const sampleUpdate = {
        title: 'Título actualizado',
        priority: 'URGENT' as const,
      };
      expect(UpdateTaskSchema.safeParse(sampleUpdate).success).toBe(true);

      const sampleMove = {
        destinationColumnId: '12345678-1234-4234-8234-123456789003',
        destinationIndex: 2,
      };
      expect(MoveTaskSchema.safeParse(sampleMove).success).toBe(true);

      // Verificación de restricciones estructurales
      expect(schemas.CreateTaskRequest.additionalProperties).toBe(false);
      expect(schemas.UpdateTaskRequest.additionalProperties).toBe(false);
      expect(schemas.UpdateTaskRequest.minProperties).toBe(1);
      expect(schemas.MoveTaskRequest.additionalProperties).toBe(false);

      // Casos negativos: UpdateTask vacío debe ser rechazado
      expect(UpdateTaskSchema.safeParse({}).success).toBe(false);

      // Validación de TaskResponse
      const sampleTaskResponse = {
        id: '12345678-1234-4234-8234-123456789010',
        projectId: '12345678-1234-4234-8234-123456789000',
        columnId: '12345678-1234-4234-8234-123456789001',
        title: 'Tarea 1',
        priority: 'MEDIUM' as const,
        orderIndex: 0,
        labels: [],
        creatorId: 'user-creator',
        assigneeIds: [],
        createdAt: '2026-10-23T12:00:00.000Z',
        updatedAt: '2026-10-23T12:00:00.000Z',
      };
      expect(TaskResponseSchema.safeParse(sampleTaskResponse).success).toBe(true);

      // Validación de PaginatedTasksResponse
      const samplePaginated = {
        items: [sampleTaskResponse],
        totalItems: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      };
      expect(PaginatedTasksResponseSchema.safeParse(samplePaginated).success).toBe(true);
    });
  });
});
