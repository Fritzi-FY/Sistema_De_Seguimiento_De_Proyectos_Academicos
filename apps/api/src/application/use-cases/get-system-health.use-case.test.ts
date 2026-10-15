import { describe, it, expect } from 'vitest';
import type { SystemClockPort } from '@is488/shared';
import { GetSystemHealthUseCase } from './get-system-health.use-case.js';

/**
 * Doble de prueba (Fake) que implementa SystemClockPort de manera determinista.
 */
class FakeSystemClock implements SystemClockPort {
  private readonly fixedDate: Date;

  constructor(private readonly isoValue: string) {
    this.fixedDate = new Date(isoValue);
  }

  now(): Date {
    return this.fixedDate;
  }

  isoString(): string {
    return this.isoValue;
  }
}

describe('GetSystemHealthUseCase (Pruebas unitarias hexagonales)', () => {
  it('debe retornar un diagnóstico de salud exitoso con timestamp y versión deterministas', () => {
    const fixedIso = '2026-10-10T12:00:00.000Z';
    const fakeClock = new FakeSystemClock(fixedIso);
    const useCase = new GetSystemHealthUseCase(fakeClock, '0.1.0');

    const result = useCase.execute();

    expect(result).toEqual({
      status: 'ok',
      timestamp: fixedIso,
      version: '0.1.0',
    });
  });

  it('debe emplear la versión predeterminada "0.1.0" si no se suministra explícitamente', () => {
    const fixedIso = '2026-10-10T15:30:00.000Z';
    const fakeClock = new FakeSystemClock(fixedIso);
    const useCase = new GetSystemHealthUseCase(fakeClock);

    const result = useCase.execute();

    expect(result.version).toBe('0.1.0');
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBe(fixedIso);
  });

  it('debe rechazar versiones vacías lanzando error de validación del esquema de contrato', () => {
    const fakeClock = new FakeSystemClock('2026-10-10T12:00:00.000Z');
    const useCase = new GetSystemHealthUseCase(fakeClock, '');

    expect(() => useCase.execute()).toThrow();
  });
});
