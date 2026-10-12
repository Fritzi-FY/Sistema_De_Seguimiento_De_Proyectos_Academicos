import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchSystemHealth } from './health.service.js';

describe('fetchSystemHealth Service', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('debe retornar datos validados cuando la respuesta del servidor es exitosa y conforme al contrato', async () => {
    const validData = {
      status: 'ok',
      timestamp: '2026-10-10T12:00:00.000Z',
      version: '0.1.0',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => validData,
    } as Response);

    const result = await fetchSystemHealth();

    expect(result).toEqual(validData);
    expect(fetch).toHaveBeenCalledWith('/api/health', {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  });

  it('debe lanzar error cuando el servidor retorna un código HTTP no exitoso', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    } as Response);

    await expect(fetchSystemHealth()).rejects.toThrow(
      'Error en la consulta de diagnóstico: 500 Internal Server Error',
    );
  });

  it('debe lanzar error de validación cuando la carga útil no cumple con el contrato HealthResponseSchema', async () => {
    const invalidData = {
      status: 'degraded',
      timestamp: 'fecha-invalida',
      version: '',
    };

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => invalidData,
    } as Response);

    await expect(fetchSystemHealth()).rejects.toThrow(
      /Respuesta inválida según el contrato de salud/i,
    );
  });
});
