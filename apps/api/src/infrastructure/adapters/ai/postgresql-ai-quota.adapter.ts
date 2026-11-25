import type { AIQuotaCheckResult, AIQuotaPort, AIQuotaReleaseOutcome } from '@is488/shared';
import { currentSqlSession, type SqlSession } from '../../postgresql/session.js';

const RATE_LIMIT_WINDOW_SECONDS = 600; // 10 minutos
const MAX_ANALYSES_PER_WINDOW = 5;
const IN_FLIGHT_EXPIRY_SECONDS = 30;

/**
 * Adaptador de cuotas de IA respaldado por PostgreSQL.
 * Implementa AIQuotaPort con garantías de atomicidad y seguridad ante concurrencia.
 *
 * Estrategia:
 * 1. Expirar registros in_flight antiguos (> 30 s) para liberar bloqueos fantasma.
 * 2. Verificar la ventana deslizante de 10 minutos del proyecto (máx. 5 análisis).
 * 3. Intentar insertar una fila in_flight con restricción unique parcial.
 *    - Si hay conflicto (23505): devolver IN_FLIGHT_CONFLICT.
 *    - Si hay más de 5 en la ventana: devolver RATE_LIMIT_EXCEEDED.
 * 4. Release: actualizar status a completed/failed/timeout con clock_timestamp().
 */
export class PostgresqlAIQuotaAdapter implements AIQuotaPort {
  constructor(private readonly session: () => SqlSession = currentSqlSession) {}

  async checkAndAcquire(userId: string, projectId: string): Promise<AIQuotaCheckResult> {
    const sql = this.session();
    return sql.transaction(async () => {
      // Serialización transaccional por project_id:
      // Adquiere un bloqueo consultivo exclusivo a nivel de transacción (pg_advisory_xact_lock)
      // indexado por el hash del project_id. Garantiza que las comprobaciones de concurrencia
      // y la evaluación de la ventana deslizante (máximo 5) se ejecuten de manera estrictamente
      // serializada entre múltiples usuarios concurrentes para el mismo proyecto.
      await sql.query('SELECT pg_advisory_xact_lock(488, hashtext($1))', [projectId]);

      // Paso 1: Expirar registros in_flight cuyo started_at es mayor al umbral de expiración.
      await sql.query(
        `UPDATE public.ai_analysis_quota
            SET status = 'timeout', completed_at = clock_timestamp()
          WHERE user_id = $1
            AND project_id = $2
            AND status = 'in_flight'
            AND started_at < clock_timestamp() - ($3 || ' seconds')::interval`,
        [userId, projectId, String(IN_FLIGHT_EXPIRY_SECONDS)],
      );

      // Paso 2: Verificar ventana deslizante del proyecto.
      const windowResult = await sql.query<{
        count: number;
        oldest: string | null;
      }>(
        `SELECT count(*)::int AS count, min(started_at) AS oldest
           FROM public.ai_analysis_quota
          WHERE project_id = $1
            AND started_at > clock_timestamp() - ($2 || ' seconds')::interval`,
        [projectId, String(RATE_LIMIT_WINDOW_SECONDS)],
      );

      const windowCount = windowResult.rows[0]?.count ?? 0;
      const oldestInWindow = windowResult.rows[0]?.oldest ?? null;

      if (windowCount >= MAX_ANALYSES_PER_WINDOW) {
        let retryAfterSeconds = RATE_LIMIT_WINDOW_SECONDS;
        if (oldestInWindow) {
          const oldestMs = new Date(oldestInWindow).getTime();
          const windowEndMs = oldestMs + RATE_LIMIT_WINDOW_SECONDS * 1000;
          const remaining = Math.ceil((windowEndMs - Date.now()) / 1000);
          retryAfterSeconds = Math.max(1, remaining);
        }
        return {
          allowed: false,
          reason: 'RATE_LIMIT_EXCEEDED',
          retryAfterSeconds,
        } satisfies AIQuotaCheckResult;
      }

      // Paso 3: Intentar insertar fila in_flight.
      // Si existe conflicto en el índice único parcial (status = 'in_flight'),
      // PostgreSQL lanza error 23505 (unique_violation), capturado por SqlSession
      // como PersistenceTransactionError con sqlState = '23505'.
      try {
        await sql.query(
          `INSERT INTO public.ai_analysis_quota (user_id, project_id, status, started_at)
           VALUES ($1, $2, 'in_flight', clock_timestamp())`,
          [userId, projectId],
        );
      } catch (err: unknown) {
        // El driver `pg` expone el código SQLSTATE en `.code`; PersistenceTransactionError
        // lo reenvuelve en `.sqlState`. Se comprueban ambos para capturar el conflicto
        // tanto si se lanza desde el driver directamente como si ya fue envuelto.
        const pgErr = err as { sqlState?: string; code?: string; constraint?: string };
        if (pgErr.sqlState === '23505' || pgErr.code === '23505') {
          return {
            allowed: false,
            reason: 'IN_FLIGHT_CONFLICT',
            retryAfterSeconds: IN_FLIGHT_EXPIRY_SECONDS,
          } satisfies AIQuotaCheckResult;
        }
        throw err;
      }

      return { allowed: true } satisfies AIQuotaCheckResult;
    });
  }

  async release(userId: string, projectId: string, outcome: AIQuotaReleaseOutcome): Promise<void> {
    const dbStatus: 'completed' | 'failed' | 'timeout' =
      outcome === 'success' ? 'completed' : outcome === 'error' ? 'failed' : 'timeout';

    await this.session().query(
      `UPDATE public.ai_analysis_quota
          SET status = $1, completed_at = clock_timestamp()
        WHERE user_id = $2
          AND project_id = $3
          AND status = 'in_flight'`,
      [dbStatus, userId, projectId],
    );
  }
}
