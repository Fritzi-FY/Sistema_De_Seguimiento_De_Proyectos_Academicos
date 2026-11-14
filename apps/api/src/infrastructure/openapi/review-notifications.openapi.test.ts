import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ReviewNotificationCursorSchema,
  ReviewNotificationItemSchema,
  ReviewNotificationListResponseSchema,
} from '@is488/shared';
import { openApiSpec } from './openapi.contract.js';

describe('Student inbox OpenAPI contract', () => {
  const operation = openApiSpec.paths['/api/review-notifications'].get;
  it('defines only the approved authenticated GET with all response codes and no-store', () => {
    expect(Object.keys(openApiSpec.paths['/api/review-notifications'])).toEqual(['get']);
    expect(operation.security).toEqual([{ SessionCookie: [] }]);
    expect(operation.operationId).toBe('listStudentReviewNotifications');
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '400', '401', '403', '500']);
    for (const response of Object.values(operation.responses))
      expect(response.headers['Cache-Control'].schema).toEqual({
        type: 'string',
        enum: ['no-store', 'private, no-store'],
      });
  });
  it('documents only bounded limit and cursor parameters with their precision and permission semantics', () => {
    expect(operation.parameters.map((parameter) => parameter.name)).toEqual(['limit', 'cursor']);
    expect(operation.parameters[0]!.schema).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      default: 20,
    });
    expect(operation.parameters[1]!.description).toContain('ffffffZ');
    expect(operation.parameters[1]!.description).toContain('No pasar por Date');
    expect(operation.description).toContain('created_at DESC, id DESC');
    expect(operation.description).toContain('membresía activa antes de paginar');
    expect(operation.description).toContain('Solo rol student de la sesión');
  });
  it.each([
    ['ReviewNotificationCursor', ReviewNotificationCursorSchema],
    ['ReviewNotificationItem', ReviewNotificationItemSchema],
    ['ReviewNotificationListResponse', ReviewNotificationListResponseSchema],
  ] as const)('derives %s directly from the shared Zod contract', (name, validator) => {
    const schema = z.toJSONSchema(validator);
    delete schema.$schema;
    expect(openApiSpec.components.schemas[name]).toEqual(schema);
  });
  it('keeps the exact minimal fields and response component without identity or observations', () => {
    const schema = openApiSpec.components.schemas.ReviewNotificationItem;
    expect(Object.keys(schema.properties!).sort()).toEqual([
      'createdAt',
      'id',
      'projectId',
      'responseActionId',
      'reviewId',
      'status',
    ]);
    expect(schema.additionalProperties).toBe(false);
    expect(operation.responses['200'].content['application/json'].schema.$ref).toBe(
      '#/components/schemas/ReviewNotificationListResponse',
    );
  });
});
