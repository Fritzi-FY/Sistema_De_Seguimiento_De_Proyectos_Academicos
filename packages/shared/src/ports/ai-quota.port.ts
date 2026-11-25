/**
 * Puerto para el control de cuotas y concurrencia de solicitudes de IA (IS488).
 * Diseñado para desacoplar el caso de uso del almacenamiento persistente (PostgreSQL en prod, InMemory en tests).
 */

export interface AIQuotaCheckResult {
  allowed: boolean;
  reason?: 'IN_FLIGHT_CONFLICT' | 'RATE_LIMIT_EXCEEDED' | string;
  retryAfterSeconds?: number;
}

export type AIQuotaReleaseOutcome = 'success' | 'error' | 'timeout';

export interface AIQuotaPort {
  /**
   * Verifica la cuota del proyecto y el guard de concurrencia para (userId, projectId).
   * Si es permitido, adquiere inmediatamente el bloqueo in-flight de forma atómica.
   */
  checkAndAcquire(userId: string, projectId: string): Promise<AIQuotaCheckResult>;

  /**
   * Libera el estado in-flight actualizando el registro al resultado correspondiente.
   */
  release(userId: string, projectId: string, outcome: AIQuotaReleaseOutcome): Promise<void>;
}
