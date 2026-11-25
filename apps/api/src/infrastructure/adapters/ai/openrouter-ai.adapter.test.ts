import {
  AIAuthenticationError,
  AIInsufficientCreditsError,
  AIProviderUnavailableError,
  AIRateLimitError,
  AITimeoutError,
  type AICompletionRequest,
  type AICompletionResponse,
} from '@is488/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenRouterAIAdapter } from './openrouter-ai.adapter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const SAMPLE_REQUEST: AICompletionRequest = {
  systemPrompt: 'You are a helpful assistant.',
  userPrompt: 'Summarize this project.',
  maxTokens: 600,
  temperature: 0.3,
  responseFormat: 'json_object',
};

function okResponse(body: object = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number): Response {
  return new Response(JSON.stringify({ error: { message: 'upstream error' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const validOpenRouterBody = {
  id: 'chatcmpl-abc123',
  model: 'google/gemini-2.0-flash-lite:free',
  choices: [
    {
      message: { content: '{"progressSummary":"ok","riskSignals":[],"nextSteps":[]}' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
};

// ── Setup ─────────────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('OpenRouterAIAdapter', () => {
  describe('construcción correcta de cabeceras y body', () => {
    it('envía las cabeceras obligatorias a OpenRouter', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(validOpenRouterBody));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await adapter.generateCompletion(SAMPLE_REQUEST);

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer test-key');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['HTTP-Referer']).toBe('https://is488.unsch.edu.pe');
      expect(headers['X-Title']).toBe('IS488 Academic Projects Tracker');
    });

    it('incluye messages, model, max_tokens y temperature en el body', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(validOpenRouterBody));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key', model: 'my/model' });

      await adapter.generateCompletion(SAMPLE_REQUEST);

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['model']).toBe('my/model');
      expect(body['max_tokens']).toBe(600);
      expect(body['temperature']).toBe(0.3);
      expect(body['response_format']).toEqual({ type: 'json_object' });
      const messages = body['messages'] as Array<{ role: string; content: string }>;
      expect(messages[0]?.role).toBe('system');
      expect(messages[0]?.content).toBe(SAMPLE_REQUEST.systemPrompt);
      expect(messages[1]?.role).toBe('user');
      expect(messages[1]?.content).toBe(SAMPLE_REQUEST.userPrompt);
    });

    it('no incluye response_format cuando responseFormat es "text"', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(validOpenRouterBody));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await adapter.generateCompletion({ ...SAMPLE_REQUEST, responseFormat: 'text' });

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body['response_format']).toBeUndefined();
    });

    it('devuelve el contenido, modelo y usage correctamente', async () => {
      fetchMock.mockResolvedValueOnce(okResponse(validOpenRouterBody));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      const result: AICompletionResponse = await adapter.generateCompletion(SAMPLE_REQUEST);

      expect(result.content).toBe('{"progressSummary":"ok","riskSignals":[],"nextSteps":[]}');
      expect(result.model).toBe('google/gemini-2.0-flash-lite:free');
      expect(result.usage).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });
    });
  });

  describe('manejo de AbortSignal y timeout', () => {
    it('rechaza con AITimeoutError (statusCode 504 e instancia de AIProviderUnavailableError) al expirar el timeout interno (8 s)', async () => {
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((_, reject) => {
          // Simula que fetch nunca resuelve; el AbortController interno lo cancelará
          setTimeout(() => reject(Object.assign(new DOMException('aborted', 'AbortError'))), 50);
        }),
      );
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key', timeoutMs: 10 });

      let thrownError: unknown;
      try {
        await adapter.generateCompletion(SAMPLE_REQUEST);
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(AITimeoutError);
      expect(thrownError).toBeInstanceOf(AIProviderUnavailableError);
      expect((thrownError as AITimeoutError).statusCode).toBe(504);
    }, 2_000);

    it('rechaza con AITimeoutError cuando la señal externa es abortada con error de timeout o AbortError', async () => {
      const controller = new AbortController();
      fetchMock.mockImplementationOnce(
        () => new Promise<Response>((_, reject) => {
          setTimeout(() => {
            controller.abort();
            reject(Object.assign(new DOMException('aborted', 'AbortError')));
          }, 10);
        }),
      );
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      let thrownError: unknown;
      try {
        await adapter.generateCompletion(SAMPLE_REQUEST, { signal: controller.signal });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).toBeInstanceOf(AITimeoutError);
      expect((thrownError as AITimeoutError).statusCode).toBe(504);
    }, 2_000);
  });

  describe('mapeo de códigos HTTP a errores tipados', () => {
    it('HTTP 401 → AIAuthenticationError', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(401));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIAuthenticationError,
      );
    });

    it('HTTP 402 → AIInsufficientCreditsError', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(402));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIInsufficientCreditsError,
      );
    });

    it('HTTP 429 → AIRateLimitError', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(429));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIRateLimitError,
      );
    });

    it('HTTP 500 → AIProviderUnavailableError', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(500));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIProviderUnavailableError,
      );
    });

    it('HTTP 503 → AIProviderUnavailableError (statusCode 503)', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(503));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      let thrown: unknown;
      try {
        await adapter.generateCompletion(SAMPLE_REQUEST);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AIProviderUnavailableError);
      expect((thrown as AIProviderUnavailableError).statusCode).toBe(503);
    });

    it('HTTP 504 → AITimeoutError (statusCode 504) distinguiendo timeout de indisponibilidad', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(504));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      let thrown: unknown;
      try {
        await adapter.generateCompletion(SAMPLE_REQUEST);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(AITimeoutError);
      expect(thrown).toBeInstanceOf(AIProviderUnavailableError);
      expect((thrown as AITimeoutError).statusCode).toBe(504);
    });

    it('los mensajes de error no filtran detalles del proveedor (cabeceras, body crudo)', async () => {
      fetchMock.mockResolvedValueOnce(errorResponse(401));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      try {
        await adapter.generateCompletion(SAMPLE_REQUEST);
        expect.fail('Debería haber lanzado una excepción');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : '';
        // No debe filtrar la API key ni el body crudo del proveedor
        expect(message).not.toContain('test-key');
        expect(message).not.toContain('upstream error');
      }
    });
  });

  describe('API key no configurada', () => {
    it('lanza AIAuthenticationError si no hay API key (ni config ni env)', async () => {
      const original = process.env['OPENROUTER_API_KEY'];
      delete process.env['OPENROUTER_API_KEY'];
      const adapter = new OpenRouterAIAdapter();

      try {
        await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
          AIAuthenticationError,
        );
      } finally {
        if (original !== undefined) process.env['OPENROUTER_API_KEY'] = original;
      }
      // fetch no debe haber sido llamado
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('respuesta con estructura inesperada', () => {
    it('lanza AIProviderUnavailableError si choices está vacío', async () => {
      fetchMock.mockResolvedValueOnce(okResponse({ choices: [] }));
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIProviderUnavailableError,
      );
    });

    it('lanza AIProviderUnavailableError si content es null', async () => {
      fetchMock.mockResolvedValueOnce(
        okResponse({
          ...validOpenRouterBody,
          choices: [{ message: { content: null }, finish_reason: 'stop' }],
        }),
      );
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIProviderUnavailableError,
      );
    });

    it('lanza AIProviderUnavailableError si el body no es JSON válido', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response('not-json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
      );
      const adapter = new OpenRouterAIAdapter({ apiKey: 'test-key' });

      await expect(adapter.generateCompletion(SAMPLE_REQUEST)).rejects.toBeInstanceOf(
        AIProviderUnavailableError,
      );
    });
  });
});
