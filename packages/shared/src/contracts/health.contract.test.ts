import { describe, it, expect } from 'vitest';
import { HealthResponseSchema } from './health.contract.js';

describe('HealthResponseSchema', () => {
  it('debe validar exitosamente un payload correcto con status ok, timestamp ISO-8601 y version', () => {
    const validPayload = {
      status: 'ok',
      timestamp: '2026-10-10T12:00:00.000Z',
      version: '0.1.0',
    };

    const result = HealthResponseSchema.safeParse(validPayload);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ok');
      expect(result.data.timestamp).toBe('2026-10-10T12:00:00.000Z');
      expect(result.data.version).toBe('0.1.0');
    }
  });

  it('debe rechazar cualquier status distinto del literal "ok"', () => {
    const invalidStatuses = ['ready', 'degraded', 'error', 'healthy', '', 123, null];

    for (const status of invalidStatuses) {
      const payload = {
        status,
        timestamp: '2026-10-10T12:00:00.000Z',
        version: '0.1.0',
      };

      const result = HealthResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  it('debe rechazar timestamps que no cumplan el formato ISO-8601 UTC', () => {
    const invalidTimestamps = [
      '2026-10-10',
      '10/10/2026',
      'not-a-timestamp',
      '2026-13-45T99:99:99Z',
      '',
      1728561600000,
      null,
    ];

    for (const timestamp of invalidTimestamps) {
      const payload = {
        status: 'ok',
        timestamp,
        version: '0.1.0',
      };

      const result = HealthResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  it('debe rechazar una versión vacía o que no sea cadena', () => {
    const invalidVersions = ['', null, undefined, 123];

    for (const version of invalidVersions) {
      const payload = {
        status: 'ok',
        timestamp: '2026-10-10T12:00:00.000Z',
        version,
      };

      const result = HealthResponseSchema.safeParse(payload);
      expect(result.success).toBe(false);
    }
  });

  it('debe rechazar payloads a los que les falten campos obligatorios', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ok' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({ timestamp: '2026-10-10T12:00:00.000Z' }).success).toBe(
      false,
    );
    expect(HealthResponseSchema.safeParse({ version: '0.1.0' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({}).success).toBe(false);
  });
});
