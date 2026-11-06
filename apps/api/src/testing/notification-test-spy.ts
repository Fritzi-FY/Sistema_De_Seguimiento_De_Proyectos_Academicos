import type { ReviewNotificationPort, ReviewNotificationPayload } from '@is488/shared';

/**
 * Doble de prueba (test spy) para ReviewNotificationPort.
 *
 * Registra todas las invocaciones a notifyReviewCompleted permitiendo
 * verificar en pruebas unitarias y de integración que la emisión
 * contractual ocurre con los parámetros exactos esperados.
 *
 * DEPENDENCIA DE ENTREGA EFECTIVA:
 * Este spy valida únicamente la emisión del evento en EPIC-006.
 * La entrega efectiva al usuario final según configuración de preferencias
 * depende de EPIC-007 (audit-reports-notifications).
 *
 * COMPORTAMIENTO CONFIGURABLE:
 * Puede configurarse para lanzar un error en la siguiente invocación
 * mediante configureToThrow(), útil para verificar el comportamiento
 * del caso de uso ante fallos del puerto de notificaciones.
 */
export class NotificationTestSpy implements ReviewNotificationPort {
  /** Lista inmutable de todas las cargas recibidas, en orden cronológico. */
  private readonly _calls: ReviewNotificationPayload[] = [];

  private _shouldThrow = false;
  private _throwMessage = 'Error simulado del puerto de notificaciones';

  /**
   * Configura el spy para lanzar un error en la próxima invocación.
   * Útil para verificar el comportamiento del caso de uso ante fallos del puerto.
   */
  configureToThrow(message = 'Error simulado del puerto de notificaciones'): void {
    this._shouldThrow = true;
    this._throwMessage = message;
  }

  /**
   * Reinicia el estado del spy: vacía el historial de llamadas y desactiva el modo error.
   */
  reset(): void {
    this._calls.length = 0;
    this._shouldThrow = false;
  }

  async notifyReviewCompleted(payload: ReviewNotificationPayload): Promise<void> {
    if (this._shouldThrow) {
      this._shouldThrow = false; // consume la configuración de un solo uso
      throw new Error(this._throwMessage);
    }
    // Almacenar copia para evitar mutaciones posteriores del caller
    this._calls.push({ ...payload, recipientUserIds: [...payload.recipientUserIds] });
  }

  /** Lista de todas las cargas recibidas (copia de solo lectura). */
  get calls(): readonly ReviewNotificationPayload[] {
    return [...this._calls];
  }

  /** Última carga recibida, o undefined si no hubo invocaciones. */
  get lastCall(): ReviewNotificationPayload | undefined {
    return this._calls.length > 0 ? { ...this._calls[this._calls.length - 1]! } : undefined;
  }

  /** Número total de invocaciones recibidas. */
  get callCount(): number {
    return this._calls.length;
  }
}
