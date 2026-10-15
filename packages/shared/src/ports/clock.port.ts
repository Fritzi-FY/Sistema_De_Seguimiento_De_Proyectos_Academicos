/**
 * Puerto de dominio hexagonal para el desacoplamiento de la provisión de marcas temporales.
 * Permite que los casos de uso dependan de una abstracción en lugar de invocar directamente `new Date()`.
 */
export interface SystemClockPort {
  /**
   * Retorna la fecha y hora actual como objeto Date.
   */
  now(): Date;

  /**
   * Retorna la fecha y hora actual formateada como cadena ISO-8601 (UTC).
   */
  isoString(): string;
}
