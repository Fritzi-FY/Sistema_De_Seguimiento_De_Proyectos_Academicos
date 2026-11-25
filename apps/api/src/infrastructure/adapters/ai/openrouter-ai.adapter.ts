import {
  AIAuthenticationError,
  AIInsufficientCreditsError,
  AIProviderUnavailableError,
  AIRateLimitError,
  AITimeoutError,
  type AICompletionRequest,
  type AICompletionResponse,
  type AIProviderPort,
} from '@is488/shared';

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_TIMEOUT_MS = 8_000;

export interface OpenRouterAIAdapterConfig {
  /** API key de OpenRouter. Se lee de OPENROUTER_API_KEY si no se pasa explícitamente. */
  apiKey?: string;
  /** Nombre del modelo. Se lee de OPENROUTER_MODEL con fallback a 'google/gemini-2.0-flash-lite:free'. */
  model?: string;
  /** Timeout en milisegundos. Por defecto: 8000. */
  timeoutMs?: number;
}

interface OpenRouterResponseBody {
  id?: string;
  model?: string;
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Adaptador de infraestructura para el proveedor de IA OpenRouter.
 * Implementa AIProviderPort usando fetch nativo con AbortController.
 * No incluye ni registra en logs la API key ni datos sensibles del proveedor.
 */
export class OpenRouterAIAdapter implements AIProviderPort {
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(config: OpenRouterAIAdapterConfig = {}) {
    this.apiKey = config.apiKey ?? process.env['OPENROUTER_API_KEY'];
    this.model = config.model ?? process.env['OPENROUTER_MODEL'] ?? 'google/gemini-2.0-flash-lite:free';
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generateCompletion(
    request: AICompletionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AICompletionResponse> {
    if (!this.apiKey) {
      throw new AIAuthenticationError(
        'Credenciales del proveedor de IA no configuradas (OPENROUTER_API_KEY).',
      );
    }

    const internalController = new AbortController();
    const timer = setTimeout(() => internalController.abort('timeout'), this.timeoutMs);

    const signal = options?.signal
      ? AbortSignal.any([internalController.signal, options.signal])
      : internalController.signal;

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userPrompt },
      ],
      max_tokens: request.maxTokens ?? 600,
      temperature: request.temperature ?? 0.3,
      ...(request.responseFormat === 'json_object'
        ? { response_format: { type: 'json_object' } }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(OPENROUTER_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://is488.unsch.edu.pe',
          'X-Title': 'IS488 Academic Projects Tracker',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (err: unknown) {
      clearTimeout(timer);
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && (err.name === 'AbortError' || err.message === 'timeout'))
      ) {
        throw new AITimeoutError(
          'La solicitud al proveedor de IA superó el tiempo máximo permitido.',
        );
      }
      throw new AIProviderUnavailableError(
        'No se pudo conectar con el proveedor de IA.',
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      await this.#handleHttpError(response);
    }

    let parsed: OpenRouterResponseBody;
    try {
      parsed = (await response.json()) as OpenRouterResponseBody;
    } catch {
      throw new AIProviderUnavailableError(
        'El proveedor de IA devolvió una respuesta que no pudo ser procesada.',
      );
    }

    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new AIProviderUnavailableError(
        'El proveedor de IA devolvió una estructura de respuesta inesperada.',
      );
    }

    return {
      content,
      model: parsed.model ?? this.model,
      usage: parsed.usage
        ? {
            promptTokens: parsed.usage.prompt_tokens ?? 0,
            completionTokens: parsed.usage.completion_tokens ?? 0,
            totalTokens: parsed.usage.total_tokens ?? 0,
          }
        : undefined,
    };
  }

  async #handleHttpError(response: Response): Promise<never> {
    // Consumir el cuerpo para no filtrar detalles internos en logs
    try {
      await response.text();
    } catch {
      // ignorar error al consumir cuerpo
    }

    switch (response.status) {
      case 401:
        throw new AIAuthenticationError(
          'Credenciales del proveedor de IA rechazadas.',
        );
      case 402:
        throw new AIInsufficientCreditsError(
          'Los créditos del proveedor de IA han sido agotados.',
        );
      case 429:
        throw new AIRateLimitError(
          'El proveedor de IA ha rechazado la solicitud por exceso de tasa.',
        );
      case 504:
        throw new AITimeoutError(
          'El proveedor de IA no respondió a tiempo (504 Gateway Timeout).',
        );
      default:
        throw new AIProviderUnavailableError(
          'El proveedor de IA no está disponible temporalmente.',
        );
    }
  }
}
