import { describe, expect, it } from 'vitest';
import { TaskActivityListResponseSchema } from '@is488/shared';
import { openApiSpec } from './openapi.contract.js';

const mutations = [
  openApiSpec.paths['/api/projects/{projectId}/tasks'].post,
  openApiSpec.paths['/api/projects/{projectId}/tasks/{taskId}'].patch,
  openApiSpec.paths['/api/projects/{projectId}/tasks/{taskId}/move'].post,
  openApiSpec.paths['/api/projects/{projectId}/board/columns/{columnId}'].delete,
];

describe('Optional Kanban correlation OpenAPI contract', () => {
  it.each(mutations)('documents the optional UUID header for $operationId', (operation) => {
    const headers = operation.parameters.filter((parameter) => parameter.in === 'header');
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({
      name: 'X-Correlation-ID',
      required: false,
      schema: { type: 'string', format: 'uuid', minLength: 36, maxLength: 36 },
    });
    expect(headers[0]!.description).toContain('se omite');
    expect('security' in operation ? operation.security : openApiSpec.security).toEqual([
      { SessionCookie: [] },
    ]);
  });
  it('keeps historical activity valid and represents correlation as optional', () => {
    const schema = openApiSpec.components.schemas.TaskActivityResponse;
    expect(schema.required).toEqual([
      'id',
      'taskId',
      'projectId',
      'actorId',
      'action',
      'createdAt',
    ]);
    expect(schema.properties.correlationId).toMatchObject({
      type: 'string',
      format: 'uuid',
      minLength: 36,
      maxLength: 36,
    });
    const historical = {
      id: '11111111-1111-4111-8111-111111111111',
      taskId: '22222222-2222-4222-8222-222222222222',
      projectId: '33333333-3333-4333-8333-333333333333',
      actorId: 'session-actor',
      action: 'CREATED',
      createdAt: '2026-11-15T12:00:00.123Z',
    };
    const correlated = { ...historical, correlationId: 'abcdefab-1234-4abc-8def-123456789abc' };
    expect(TaskActivityListResponseSchema.parse([historical, correlated])).toEqual([
      historical,
      correlated,
    ]);
    expect(
      TaskActivityListResponseSchema.safeParse([{ ...historical, correlationId: null }]).success,
    ).toBe(false);
    expect(
      TaskActivityListResponseSchema.safeParse([{ ...historical, correlationId: 'invalid' }])
        .success,
    ).toBe(false);
  });
});
