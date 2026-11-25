import type {
  AIQuotaCheckResult,
  AIQuotaPort,
  AIQuotaReleaseOutcome,
} from '../ports/ai-quota.port.js';

export interface InMemoryAIQuotaOptions {
  maxInFlightPerUserAndProject?: number;
  maxRequestsPerProjectInWindow?: number;
  windowMs?: number;
  inFlightStaleTtlMs?: number;
  clock?: () => number;
}

interface InFlightRecord {
  startedAt: number;
}

export class InMemoryAIQuotaAdapter implements AIQuotaPort {
  private inFlightMap = new Map<string, InFlightRecord>();
  private requestHistoryByProject = new Map<string, number[]>();

  private maxRequestsPerProjectInWindow: number;
  private windowMs: number;
  private inFlightStaleTtlMs: number;
  private now: () => number;

  constructor(options: InMemoryAIQuotaOptions = {}) {
    this.maxRequestsPerProjectInWindow = options.maxRequestsPerProjectInWindow ?? 5;
    this.windowMs = options.windowMs ?? 10 * 60 * 1000; // 10 minutes
    this.inFlightStaleTtlMs = options.inFlightStaleTtlMs ?? 30 * 1000; // 30 seconds
    this.now = options.clock ?? (() => Date.now());
  }

  private getKey(userId: string, projectId: string): string {
    return `${userId}:${projectId}`;
  }

  async checkAndAcquire(userId: string, projectId: string): Promise<AIQuotaCheckResult> {
    const currentTime = this.now();
    const key = this.getKey(userId, projectId);

    // 1. Guard de concurrencia: check in-flight
    const existingInFlight = this.inFlightMap.get(key);
    if (existingInFlight) {
      const isStale = currentTime - existingInFlight.startedAt > this.inFlightStaleTtlMs;
      if (!isStale) {
        return {
          allowed: false,
          reason: 'IN_FLIGHT_CONFLICT',
          retryAfterSeconds: Math.ceil(
            (this.inFlightStaleTtlMs - (currentTime - existingInFlight.startedAt)) / 1000,
          ),
        };
      }
      // If stale, it can be released / overwritten
      this.inFlightMap.delete(key);
    }

    // 2. Ventana deslizante: máx 5 análisis por proyecto en los últimos 10 min
    const timestamps = this.requestHistoryByProject.get(projectId) ?? [];
    const recentTimestamps = timestamps.filter((t) => currentTime - t <= this.windowMs);
    this.requestHistoryByProject.set(projectId, recentTimestamps);

    if (recentTimestamps.length >= this.maxRequestsPerProjectInWindow) {
      const oldestInWindow = recentTimestamps[0] ?? currentTime;
      const retryAfterMs = this.windowMs - (currentTime - oldestInWindow);
      return {
        allowed: false,
        reason: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
      };
    }

    // 3. Adquirir in-flight y registrar en el historial
    this.inFlightMap.set(key, { startedAt: currentTime });
    recentTimestamps.push(currentTime);
    this.requestHistoryByProject.set(projectId, recentTimestamps);

    return { allowed: true };
  }

  async release(
    userId: string,
    projectId: string,
    _outcome: AIQuotaReleaseOutcome,
  ): Promise<void> {
    const key = this.getKey(userId, projectId);
    this.inFlightMap.delete(key);
  }

  clear(): void {
    this.inFlightMap.clear();
    this.requestHistoryByProject.clear();
  }

  getInFlightCount(): number {
    return this.inFlightMap.size;
  }

  getProjectRequestCount(projectId: string): number {
    const currentTime = this.now();
    const timestamps = this.requestHistoryByProject.get(projectId) ?? [];
    return timestamps.filter((t) => currentTime - t <= this.windowMs).length;
  }
}
