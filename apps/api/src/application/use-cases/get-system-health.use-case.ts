import type { SystemClockPort, HealthResponse } from '@is488/shared';
import { HealthResponseSchema } from '@is488/shared';

/**
 * Caso de uso de la capa de aplicación para consultar la salud y diagnóstico operativo del sistema.
 * Respeta la arquitectura hexagonal dependiendo exclusivamente del puerto de dominio SystemClockPort.
 */
export class GetSystemHealthUseCase {
  constructor(
    private readonly clock: SystemClockPort,
    private readonly version: string = '0.1.0',
  ) {}

  /**
   * Ejecuta la consulta de diagnóstico retornando la carga útil validada por el contrato de salud.
   */
  execute(): HealthResponse {
    const payload = {
      status: 'ok' as const,
      timestamp: this.clock.isoString(),
      version: this.version,
    };

    return HealthResponseSchema.parse(payload);
  }
}
