import { describe, it, expect } from 'vitest';
import { HealthResponseSchema } from '@is488/shared';
import { openApiSpec } from './openapi.contract.js';

describe('OpenAPI 3.1 Contract Specification', () => {
  it('debe definir la versión OpenAPI 3.1.0 y metadatos del sistema', () => {
    expect(openApiSpec.openapi).toBe('3.1.0');
    expect(openApiSpec.info.title).toContain('IS488');
    expect(openApiSpec.info.version).toBe('0.1.0');
  });

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

    // Validar que una muestra conforme al esquema OpenAPI valida exitosamente con HealthResponseSchema
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
