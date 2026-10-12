import type { SystemClockPort } from '@is488/shared';

/**
 * Adaptador de infraestructura para el reloj del sistema de producción.
 * Implementa SystemClockPort utilizando la API nativa de Date del runtime.
 */
export class SystemClock implements SystemClockPort {
  now(): Date {
    return new Date();
  }

  isoString(): string {
    return new Date().toISOString();
  }
}
