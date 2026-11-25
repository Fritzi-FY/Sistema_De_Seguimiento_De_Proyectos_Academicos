import type {
  AICompletionRequest,
  AICompletionResponse,
  AIProviderPort,
} from '../ports/ai-provider.port.js';
import { AIProviderUnavailableError, AIRateLimitError } from '../ports/ai-provider.port.js';

export interface FakeAIProviderOptions {
  defaultResponse?: AICompletionResponse | string;
  latencyMs?: number;
  shouldTimeout?: boolean;
  shouldFailUnavailable?: boolean;
  shouldFailRateLimit?: boolean;
}

export class FakeAIProvider implements AIProviderPort {
  private defaultResponse: AICompletionResponse;
  private latencyMs: number;
  private shouldTimeout: boolean;
  private shouldFailUnavailable: boolean;
  private shouldFailRateLimit: boolean;

  private recordedRequests: AICompletionRequest[] = [];

  constructor(options: FakeAIProviderOptions = {}) {
    const rawDefault =
      options.defaultResponse ??
      JSON.stringify({
        progressSummary: 'Proyecto en buen ritmo con tareas en desarrollo.',
        riskSignals: ['Una tarea con fecha límite próxima.'],
        nextSteps: ['Completar revisión de código pendiente.'],
      });

    this.defaultResponse =
      typeof rawDefault === 'string'
        ? {
            content: rawDefault,
            model: 'fake-ai-model-v1',
            usage: { promptTokens: 120, completionTokens: 60, totalTokens: 180 },
          }
        : rawDefault;

    this.latencyMs = options.latencyMs ?? 0;
    this.shouldTimeout = options.shouldTimeout ?? false;
    this.shouldFailUnavailable = options.shouldFailUnavailable ?? false;
    this.shouldFailRateLimit = options.shouldFailRateLimit ?? false;
  }

  setResponse(response: AICompletionResponse | string): void {
    if (typeof response === 'string') {
      this.defaultResponse = {
        content: response,
        model: 'fake-ai-model-v1',
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    } else {
      this.defaultResponse = response;
    }
  }

  setLatency(ms: number): void {
    this.latencyMs = ms;
  }

  setShouldTimeout(value: boolean): void {
    this.shouldTimeout = value;
  }

  setShouldFailUnavailable(value: boolean): void {
    this.shouldFailUnavailable = value;
  }

  setShouldFailRateLimit(value: boolean): void {
    this.shouldFailRateLimit = value;
  }

  getLastRequest(): AICompletionRequest | undefined {
    return this.recordedRequests[this.recordedRequests.length - 1];
  }

  getAllRequests(): AICompletionRequest[] {
    return [...this.recordedRequests];
  }

  clearRecordedRequests(): void {
    this.recordedRequests = [];
  }

  async generateCompletion(
    request: AICompletionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AICompletionResponse> {
    this.recordedRequests.push(request);

    if (options?.signal?.aborted) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }

    if (this.latencyMs > 0) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, this.latencyMs);
        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('The user aborted a request.', 'AbortError'));
          });
        }
      });
    }

    if (this.shouldTimeout) {
      throw new DOMException('The user aborted a request.', 'AbortError');
    }

    if (this.shouldFailUnavailable) {
      throw new AIProviderUnavailableError();
    }

    if (this.shouldFailRateLimit) {
      throw new AIRateLimitError();
    }

    return this.defaultResponse;
  }
}
