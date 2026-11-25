import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AIAnalysisRequestSchema,
  AIAnalysisResponseSchema,
  ProjectAICapabilitiesResponseSchema,
} from '@is488/shared';
import { openApiSpec } from './openapi.contract.js';

describe('AI Assistant OpenAPI Contract Specification', () => {
  const pathItem = openApiSpec.paths['/api/projects/{projectId}/ai/analysis'];
  const operation = pathItem.post;

  it('debe registrar la ruta POST /api/projects/{projectId}/ai/analysis con SessionCookie', () => {
    expect(pathItem).toBeDefined();
    expect(Object.keys(pathItem)).toEqual(['post']);
    expect(operation.operationId).toBe('generateProjectAISummary');
    expect(operation.security).toEqual([{ SessionCookie: [] }]);
  });

  it('debe definir el parámetro de ruta projectId como UUID requerido', () => {
    expect(operation.parameters).toHaveLength(1);
    const param = operation.parameters[0]!;
    expect(param.name).toBe('projectId');
    expect(param.in).toBe('path');
    expect(param.required).toBe(true);
    expect(param.schema).toEqual({ type: 'string', format: 'uuid' });
  });

  it('debe documentar exactamente los códigos de respuesta esperados: 200, 400, 401, 403, 404, 429, 502, 503, 504', () => {
    const codes = Object.keys(operation.responses).sort();
    expect(codes).toEqual(['200', '400', '401', '403', '404', '429', '502', '503', '504']);
  });

  it('todas las respuestas deben incluir cabecera Cache-Control: no-store', () => {
    for (const [code, resp] of Object.entries(operation.responses)) {
      const response = resp as { headers?: Record<string, { schema: { const?: string } }> };
      expect(response.headers?.['Cache-Control']?.schema?.const, `Código ${code}`).toBe('no-store');
    }
  });

  it('la respuesta 429 debe documentar la cabecera Retry-After y el esquema de error de cuota', () => {
    const response429 = operation.responses['429'] as {
      headers: Record<string, unknown>;
      content: { 'application/json': { schema: { $ref: string } } };
    };
    expect(response429.headers['Retry-After']).toBeDefined();
    expect(response429.content['application/json'].schema.$ref).toBe(
      '#/components/schemas/AIRateLimitErrorResponse',
    );
  });

  it.each([
    ['AIAnalysisRequest', AIAnalysisRequestSchema],
    ['AIAnalysisResponse', AIAnalysisResponseSchema],
    ['ProjectAICapabilitiesResponse', ProjectAICapabilitiesResponseSchema],
  ] as const)('deriva %s directamente de los contratos Zod compartidos', (name, validator) => {
    const schema = z.toJSONSchema(validator);
    delete (schema as Record<string, unknown>).$schema;
    expect(openApiSpec.components.schemas[name]).toEqual(schema);
  });

  it('registra GET /api/projects/{projectId}/ai/capabilities con respuestas 200, 400, 401, 404', () => {
    const capPath = openApiSpec.paths['/api/projects/{projectId}/ai/capabilities'];
    expect(capPath).toBeDefined();
    expect(Object.keys(capPath)).toEqual(['get']);
    expect(capPath.get.operationId).toBe('getProjectAICapabilities');
    expect(capPath.get.security).toEqual([{ SessionCookie: [] }]);
    expect(Object.keys(capPath.get.responses).sort()).toEqual(['200', '400', '401', '404']);
  });
});
