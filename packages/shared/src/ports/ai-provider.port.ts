/**
 * Interfaces y puerto de abstracción para capacidades de Inteligencia Artificial (IS488).
 * Desacoplado de cualquier proveedor específico (OpenRouter, Cloudflare Workers AI, etc.).
 */

export interface AICompletionRequest {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'json_object' | 'text';
}

export interface AICompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AICompletionResponse {
  content: string;
  model: string;
  usage?: AICompletionUsage;
}

export interface AIProviderPort {
  generateCompletion(
    request: AICompletionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<AICompletionResponse>;
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
  ) {
    super(message);
    this.name = 'AIProviderError';
  }
}

export class AIProviderUnavailableError extends AIProviderError {
  constructor(
    message: string = 'El proveedor de IA no se encuentra disponible temporalmente.',
    statusCode: number = 503,
  ) {
    super(message, statusCode);
    this.name = 'AIProviderUnavailableError';
  }
}

export class AITimeoutError extends AIProviderUnavailableError {
  constructor(
    message: string = 'El proveedor de IA no respondió dentro del tiempo máximo permitido.',
  ) {
    super(message, 504);
    this.name = 'AITimeoutError';
  }
}

export class AIRateLimitError extends AIProviderError {
  constructor(message: string = 'Se ha superado el límite de solicitudes al proveedor de IA.') {
    super(message, 429);
    this.name = 'AIRateLimitError';
  }
}

export class AIInsufficientCreditsError extends AIProviderError {
  constructor(message: string = 'La cuota o créditos del proveedor de IA han sido agotados.') {
    super(message, 402);
    this.name = 'AIInsufficientCreditsError';
  }
}

export class AIAuthenticationError extends AIProviderError {
  constructor(message: string = 'Credenciales del proveedor de IA inválidas o no configuradas.') {
    super(message, 401);
    this.name = 'AIAuthenticationError';
  }
}

export class AIInvalidResponseError extends AIProviderError {
  constructor(
    message: string = 'La respuesta generada por el proveedor de IA no tiene un formato válido.',
  ) {
    super(message, 502);
    this.name = 'AIInvalidResponseError';
  }
}
