import { describe, it, expect } from 'vitest';
import { HealthResponseSchema } from '@is488/shared';
import type { SystemClockPort } from '@is488/shared';
import { createApp, app } from './app.js';

class FakeSystemClock implements SystemClockPort {
  constructor(private readonly isoValue: string) {}

  now(): Date {
    return new Date(this.isoValue);
  }

  isoString(): string {
    return this.isoValue;
  }
}

describe('Pruebas de integración HTTP en memoria (Hono app.request)', () => {
  it('GET /api/health debe retornar 200, payload JSON válido y cabecera Cache-Control estricta', async () => {
    const res = await app.request('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');

    const json = await res.json();
    const validation = HealthResponseSchema.safeParse(json);

    expect(validation.success).toBe(true);
    if (validation.success) {
      expect(validation.data.status).toBe('ok');
      expect(typeof validation.data.timestamp).toBe('string');
      expect(validation.data.version).toBe('0.1.0');
    }
  });

  it('GET /api/health debe responder de forma determinista cuando se inyecta FakeSystemClock', async () => {
    const fixedIso = '2026-10-10T14:45:00.000Z';
    const testApp = createApp({
      clock: new FakeSystemClock(fixedIso),
      version: '0.1.0',
    });

    const res = await testApp.request('/api/health');
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json).toEqual({
      status: 'ok',
      timestamp: fixedIso,
      version: '0.1.0',
    });
  });

  it('POST /api/health debe ser rechazado con 405 Method Not Allowed sin divulgar datos internos', async () => {
    const res = await app.request('/api/health', {
      method: 'POST',
      body: JSON.stringify({ invalid: 'data' }),
      headers: { 'Content-Type': 'application/json' },
    });

    expect(res.status).toBe(405);
    expect(res.headers.get('Allow')).toBe('GET');
    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');

    const json = (await res.json()) as { error?: string; stack?: unknown; env?: unknown };
    expect(json.error).toBe('Method Not Allowed');
    expect(json.stack).toBeUndefined();
    expect(json.env).toBeUndefined();
  });

  it('DELETE /api/health debe ser rechazado con 405 Method Not Allowed', async () => {
    const res = await app.request('/api/health', {
      method: 'DELETE',
    });

    expect(res.status).toBe(405);
    const json = (await res.json()) as { error?: string };
    expect(json.error).toBe('Method Not Allowed');
  });

  it('PUT /api/health y PATCH /api/health deben ser rechazados con 405 Method Not Allowed', async () => {
    const putRes = await app.request('/api/health', { method: 'PUT' });
    expect(putRes.status).toBe(405);

    const patchRes = await app.request('/api/health', { method: 'PATCH' });
    expect(patchRes.status).toBe(405);
  });

  it('GET /api/openapi.json debe retornar el contrato OpenAPI 3.1 con status 200', async () => {
    const res = await app.request('/api/openapi.json');

    expect(res.status).toBe(200);
    const json = (await res.json()) as { openapi?: string; paths?: Record<string, unknown> };
    expect(json.openapi).toBe('3.1.0');
    expect(json.paths?.['/api/health']).toBeDefined();
  });

  it('Rutas no existentes deben responder 404 Not Found', async () => {
    const res = await app.request('/api/inexistente');
    expect(res.status).toBe(404);
  });
});
