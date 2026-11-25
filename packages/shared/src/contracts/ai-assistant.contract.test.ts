import { describe, it, expect } from 'vitest';
import {
  AI_ASSISTANT_DISCLAIMER,
  AIAnalysisFocusSchema,
  AIAnalysisRequestSchema,
  AIModelPayloadSchema,
  AIAnalysisSectionsSchema,
  AIAnalysisMetaSchema,
  AIAnalysisResponseSchema,
} from './ai-assistant.contract.js';
import {
  AIProviderError,
  AIProviderUnavailableError,
  AITimeoutError,
  AIRateLimitError,
  AIInsufficientCreditsError,
  AIAuthenticationError,
  AIInvalidResponseError,
} from '../ports/ai-provider.port.js';
import { FakeAIProvider } from '../testing/fake-ai-provider.js';
import { InMemoryAIQuotaAdapter } from '../testing/in-memory-ai-quota.adapter.js';

describe('AI Assistant Contracts & Schemas', () => {
  describe('AIAnalysisFocusSchema', () => {
    it('accepts valid focus values', () => {
      expect(AIAnalysisFocusSchema.parse('full')).toBe('full');
      expect(AIAnalysisFocusSchema.parse('risks')).toBe('risks');
      expect(AIAnalysisFocusSchema.parse('progress')).toBe('progress');
    });

    it('rejects invalid focus values', () => {
      expect(() => AIAnalysisFocusSchema.parse('chat')).toThrow();
      expect(() => AIAnalysisFocusSchema.parse('grading')).toThrow();
      expect(() => AIAnalysisFocusSchema.parse('')).toThrow();
    });
  });

  describe('AIAnalysisRequestSchema', () => {
    it('defaults to full focus when empty object is provided', () => {
      const parsed = AIAnalysisRequestSchema.parse({});
      expect(parsed.focus).toBe('full');
    });

    it('accepts explicit valid focus', () => {
      const parsed = AIAnalysisRequestSchema.parse({ focus: 'risks' });
      expect(parsed.focus).toBe('risks');
    });

    it('rejects unknown fields in strict mode', () => {
      expect(() =>
        AIAnalysisRequestSchema.parse({
          focus: 'full',
          prompt: 'Dime la nota del alumno',
        }),
      ).toThrow();
    });
  });

  describe('AIModelPayloadSchema', () => {
    const validModelPayload = {
      progressSummary: 'El sprint avanza según lo planificado.',
      riskSignals: ['Riesgo de retraso en módulo de autenticación'],
      nextSteps: ['Completar pruebas unitarias de adaptadores'],
    };

    it('accepts valid raw model payload', () => {
      const parsed = AIModelPayloadSchema.parse(validModelPayload);
      expect(parsed.progressSummary).toBe(validModelPayload.progressSummary);
      expect(parsed.riskSignals).toEqual(validModelPayload.riskSignals);
      expect(parsed.nextSteps).toEqual(validModelPayload.nextSteps);
    });

    it('accepts empty riskSignals and nextSteps arrays', () => {
      const parsed = AIModelPayloadSchema.parse({
        progressSummary: 'Todo en orden sin riesgos identificados.',
        riskSignals: [],
        nextSteps: [],
      });
      expect(parsed.riskSignals).toEqual([]);
      expect(parsed.nextSteps).toEqual([]);
    });

    it('rejects empty progressSummary', () => {
      expect(() =>
        AIModelPayloadSchema.parse({
          ...validModelPayload,
          progressSummary: '   ',
        }),
      ).toThrow();
    });

    it('rejects empty strings in riskSignals or nextSteps', () => {
      expect(() =>
        AIModelPayloadSchema.parse({
          ...validModelPayload,
          riskSignals: [''],
        }),
      ).toThrow();
    });

    it('rejects missing required sections', () => {
      expect(() =>
        AIModelPayloadSchema.parse({
          progressSummary: 'Faltan riesgos y pasos',
        }),
      ).toThrow();
    });

    it('rejects unexpected additional properties in strict mode', () => {
      expect(() =>
        AIModelPayloadSchema.parse({
          ...validModelPayload,
          grade: 18,
          status: 'APPROVED',
        }),
      ).toThrow();
    });
  });

  describe('AIAnalysisSectionsSchema', () => {
    it('accepts valid sections', () => {
      const parsed = AIAnalysisSectionsSchema.parse({
        progressSummary: 'Progreso activo',
        riskSignals: ['Riesgo 1'],
        nextSteps: ['Paso 1'],
      });
      expect(parsed.progressSummary).toBe('Progreso activo');
      expect(parsed.riskSignals).toEqual(['Riesgo 1']);
    });

    it('rejects empty progress summary', () => {
      expect(() =>
        AIAnalysisSectionsSchema.parse({
          progressSummary: '',
          riskSignals: [],
          nextSteps: [],
        }),
      ).toThrow();
    });
  });

  describe('AIAnalysisMetaSchema', () => {
    it('accepts valid metadata with exact server disclaimer', () => {
      const validMeta = {
        model: 'openrouter/google/gemini-2.0-flash-lite:free',
        generatedAt: new Date().toISOString(),
        disclaimer: AI_ASSISTANT_DISCLAIMER,
      };
      const parsed = AIAnalysisMetaSchema.parse(validMeta);
      expect(parsed.disclaimer).toBe(AI_ASSISTANT_DISCLAIMER);
    });

    it('rejects non-matching or tampered disclaimer', () => {
      expect(() =>
        AIAnalysisMetaSchema.parse({
          model: 'gpt-4o',
          generatedAt: new Date().toISOString(),
          disclaimer: 'Calificación oficial emitida por IA',
        }),
      ).toThrow();
    });

    it('rejects invalid datetime', () => {
      expect(() =>
        AIAnalysisMetaSchema.parse({
          model: 'fake-model',
          generatedAt: 'invalid-date',
          disclaimer: AI_ASSISTANT_DISCLAIMER,
        }),
      ).toThrow();
    });
  });

  describe('AIAnalysisResponseSchema', () => {
    const validResponse = {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      analysis: {
        progressSummary: 'Se han completado 8 de 10 tareas del sprint.',
        riskSignals: ['2 tareas de alta prioridad pendientes.'],
        nextSteps: ['Reasignar tareas del módulo crítico.'],
      },
      meta: {
        model: 'openrouter/google/gemini-2.0-flash-lite:free',
        generatedAt: '2026-11-18T12:00:00.000Z',
        disclaimer: AI_ASSISTANT_DISCLAIMER,
      },
    };

    it('accepts complete valid analysis response', () => {
      const parsed = AIAnalysisResponseSchema.parse(validResponse);
      expect(parsed.projectId).toBe(validResponse.projectId);
      expect(parsed.analysis.progressSummary).toBe(validResponse.analysis.progressSummary);
      expect(parsed.meta.disclaimer).toBe(AI_ASSISTANT_DISCLAIMER);
    });

    it('rejects non-uuid projectId', () => {
      expect(() =>
        AIAnalysisResponseSchema.parse({
          ...validResponse,
          projectId: 'invalid-uuid-string',
        }),
      ).toThrow();
    });

    it('rejects extraneous properties in strict mode', () => {
      expect(() =>
        AIAnalysisResponseSchema.parse({
          ...validResponse,
          officialGrade: 20,
        }),
      ).toThrow();
    });
  });

  describe('AI Domain Errors', () => {
    it('exposes correct status codes and names', () => {
      const unavail = new AIProviderUnavailableError();
      expect(unavail.statusCode).toBe(503);
      expect(unavail.name).toBe('AIProviderUnavailableError');

      const timeout = new AITimeoutError();
      expect(timeout.statusCode).toBe(504);
      expect(timeout.name).toBe('AITimeoutError');
      expect(timeout).toBeInstanceOf(AIProviderUnavailableError);

      const rateLimit = new AIRateLimitError();
      expect(rateLimit.statusCode).toBe(429);
      expect(rateLimit.name).toBe('AIRateLimitError');

      const credits = new AIInsufficientCreditsError();
      expect(credits.statusCode).toBe(402);
      expect(credits.name).toBe('AIInsufficientCreditsError');

      const auth = new AIAuthenticationError();
      expect(auth.statusCode).toBe(401);
      expect(auth.name).toBe('AIAuthenticationError');

      const invalidResp = new AIInvalidResponseError();
      expect(invalidResp.statusCode).toBe(502);
      expect(invalidResp.name).toBe('AIInvalidResponseError');

      const baseError = new AIProviderError('Custom', 500);
      expect(baseError.statusCode).toBe(500);
    });
  });

  describe('FakeAIProvider', () => {
    it('generates default completion without making network calls', async () => {
      const provider = new FakeAIProvider();
      const response = await provider.generateCompletion({
        systemPrompt: 'Instrucciones del sistema',
        userPrompt: 'Datos del proyecto',
      });

      expect(response.content).toBeDefined();
      expect(response.model).toBe('fake-ai-model-v1');
      expect(response.usage?.totalTokens).toBeGreaterThan(0);

      const lastReq = provider.getLastRequest();
      expect(lastReq?.systemPrompt).toBe('Instrucciones del sistema');
      expect(lastReq?.userPrompt).toBe('Datos del proyecto');
    });

    it('allows customizing responses as string or object', async () => {
      const provider = new FakeAIProvider();
      provider.setResponse(
        JSON.stringify({
          progressSummary: 'Resumen personalizado',
          riskSignals: [],
          nextSteps: ['Paso 1'],
        }),
      );

      const response = await provider.generateCompletion({
        systemPrompt: 'System',
        userPrompt: 'User',
      });

      expect(response.content).toContain('Resumen personalizado');
    });

    it('records all requests and supports clearing', async () => {
      const provider = new FakeAIProvider();
      await provider.generateCompletion({ systemPrompt: 'S1', userPrompt: 'U1' });
      await provider.generateCompletion({ systemPrompt: 'S2', userPrompt: 'U2' });

      expect(provider.getAllRequests()).toHaveLength(2);
      expect(provider.getLastRequest()?.systemPrompt).toBe('S2');

      provider.clearRecordedRequests();
      expect(provider.getAllRequests()).toHaveLength(0);
      expect(provider.getLastRequest()).toBeUndefined();
    });

    it('simulates timeout via shouldTimeout', async () => {
      const provider = new FakeAIProvider({ shouldTimeout: true });
      await expect(
        provider.generateCompletion({ systemPrompt: 'S', userPrompt: 'U' }),
      ).rejects.toThrow('The user aborted a request.');
    });

    it('respects pre-aborted AbortSignal', async () => {
      const provider = new FakeAIProvider();
      const controller = new AbortController();
      controller.abort();

      await expect(
        provider.generateCompletion(
          { systemPrompt: 'S', userPrompt: 'U' },
          { signal: controller.signal },
        ),
      ).rejects.toThrow('The user aborted a request.');
    });

    it('handles simulated latency and abortion during latency', async () => {
      const provider = new FakeAIProvider({ latencyMs: 50 });
      const controller = new AbortController();

      setTimeout(() => controller.abort(), 10);

      await expect(
        provider.generateCompletion(
          { systemPrompt: 'S', userPrompt: 'U' },
          { signal: controller.signal },
        ),
      ).rejects.toThrow('The user aborted a request.');
    });

    it('simulates unavailable and rate-limit errors', async () => {
      const provider = new FakeAIProvider();

      provider.setShouldFailUnavailable(true);
      await expect(
        provider.generateCompletion({ systemPrompt: 'S', userPrompt: 'U' }),
      ).rejects.toBeInstanceOf(AIProviderUnavailableError);

      provider.setShouldFailUnavailable(false);
      provider.setShouldFailRateLimit(true);
      await expect(
        provider.generateCompletion({ systemPrompt: 'S', userPrompt: 'U' }),
      ).rejects.toBeInstanceOf(AIRateLimitError);
    });
  });

  describe('InMemoryAIQuotaAdapter', () => {
    it('allows initial request and acquires in-flight lock', async () => {
      const quota = new InMemoryAIQuotaAdapter();
      const result = await quota.checkAndAcquire('user-1', 'proj-1');

      expect(result.allowed).toBe(true);
      expect(quota.getInFlightCount()).toBe(1);
    });

    it('rejects concurrent in-flight request for same user and project', async () => {
      const quota = new InMemoryAIQuotaAdapter();
      const first = await quota.checkAndAcquire('user-1', 'proj-1');
      expect(first.allowed).toBe(true);

      const second = await quota.checkAndAcquire('user-1', 'proj-1');
      expect(second.allowed).toBe(false);
      expect(second.reason).toBe('IN_FLIGHT_CONFLICT');
      expect(second.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('allows concurrent requests for different users or different projects', async () => {
      const quota = new InMemoryAIQuotaAdapter();
      const r1 = await quota.checkAndAcquire('user-1', 'proj-1');
      const r2 = await quota.checkAndAcquire('user-2', 'proj-1');
      const r3 = await quota.checkAndAcquire('user-1', 'proj-2');

      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(true);
      expect(quota.getInFlightCount()).toBe(3);
    });

    it('allows subsequent request after previous is released', async () => {
      const quota = new InMemoryAIQuotaAdapter();
      await quota.checkAndAcquire('user-1', 'proj-1');
      await quota.release('user-1', 'proj-1', 'success');

      expect(quota.getInFlightCount()).toBe(0);

      const second = await quota.checkAndAcquire('user-1', 'proj-1');
      expect(second.allowed).toBe(true);
    });

    it('releases stale in-flight lock after 30 seconds TTL', async () => {
      let currentTime = 1000000;
      const quota = new InMemoryAIQuotaAdapter({
        clock: () => currentTime,
        inFlightStaleTtlMs: 30000,
      });

      await quota.checkAndAcquire('user-1', 'proj-1');

      // Avanzar el reloj 31 segundos (lock se vuelve stale)
      currentTime += 31000;

      const second = await quota.checkAndAcquire('user-1', 'proj-1');
      expect(second.allowed).toBe(true);
    });

    it('enforces maximum 5 requests per project in a 10-minute sliding window', async () => {
      let currentTime = 1000000;
      const quota = new InMemoryAIQuotaAdapter({
        clock: () => currentTime,
        maxRequestsPerProjectInWindow: 5,
        windowMs: 600000,
      });

      const projectId = 'proj-window-test';

      // Realizar 5 requests liberándolos inmediatamente
      for (let i = 1; i <= 5; i++) {
        const check = await quota.checkAndAcquire(`user-${i}`, projectId);
        expect(check.allowed).toBe(true);
        await quota.release(`user-${i}`, projectId, 'success');
      }

      expect(quota.getProjectRequestCount(projectId)).toBe(5);

      // El 6to request dentro de la ventana de 10 min debe ser rechazado
      const sixth = await quota.checkAndAcquire('user-6', projectId);
      expect(sixth.allowed).toBe(false);
      expect(sixth.reason).toBe('RATE_LIMIT_EXCEEDED');
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);

      // Otro proyecto debe operar con normalidad
      const otherProject = await quota.checkAndAcquire('user-6', 'proj-other');
      expect(otherProject.allowed).toBe(true);

      // Avanzar el reloj más allá de los 10 minutos (601 segundos)
      currentTime += 601000;

      const afterWindow = await quota.checkAndAcquire('user-6', projectId);
      expect(afterWindow.allowed).toBe(true);
    });
  });
});
