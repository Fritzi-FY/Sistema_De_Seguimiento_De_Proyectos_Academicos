import {
  type AIAnalysisRequest,
  type AIAnalysisResponse,
  type ProjectAICapabilitiesResponse,
  AIAnalysisRequestSchema,
  AIAnalysisResponseSchema,
  ProjectAICapabilitiesResponseSchema,
} from '@is488/shared';
import { apiFetch, buildHeaders } from './api-client.js';
import type { DevUserHeaders } from './project.service.js';

export interface AIAssistantRequestOptions {
  signal?: AbortSignal;
}

export class AIAssistantServiceError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
    readonly reason?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(userMessage);
    this.name = 'AIAssistantServiceError';
  }
}

interface ServerErrorPayload {
  error?: string;
  message?: string;
  reason?: string;
  retryAfterSeconds?: number;
}

/**
 * Mapea los códigos de estado HTTP a mensajes amigables y accesibles para el usuario,
 * sin exponer detalles técnicos internos del servidor o proveedor.
 */
function mapHttpErrorToUserMessage(
  status: number,
  payload?: ServerErrorPayload | null,
): { userMessage: string; reason?: string; retryAfterSeconds?: number } {
  const reason = payload?.reason;
  const retryAfterSeconds = payload?.retryAfterSeconds;

  switch (status) {
    case 400:
      return {
        userMessage:
          'Parámetros de solicitud inválidos. Por favor verifique los datos del proyecto.',
      };
    case 401:
      return {
        userMessage: 'Sesión no autenticada. Inicie sesión nuevamente para consultar el asistente.',
      };
    case 403:
      return {
        userMessage: 'No tiene permisos para solicitar el análisis de este proyecto académico.',
      };
    case 404:
      return {
        userMessage: 'El proyecto académico no fue encontrado o no está disponible.',
      };
    case 429: {
      if (reason === 'IN_FLIGHT_CONFLICT') {
        const secs = retryAfterSeconds ?? 30;
        return {
          userMessage: `Ya existe un análisis en curso para este proyecto. Por favor espere ${secs} segundos antes de solicitar uno nuevo.`,
          reason,
          retryAfterSeconds: secs,
        };
      }
      if (reason === 'RATE_LIMIT_EXCEEDED') {
        const minutes = Math.max(1, Math.ceil((retryAfterSeconds ?? 600) / 60));
        return {
          userMessage: `Se ha alcanzado el límite de 5 análisis cada 10 minutos para este proyecto. Podrá generar uno nuevo en aproximadamente ${minutes} minuto(s).`,
          reason,
          retryAfterSeconds,
        };
      }
      return {
        userMessage: 'Límite de solicitudes de análisis excedido. Por favor intente más tarde.',
        reason,
        retryAfterSeconds,
      };
    }
    case 502:
      return {
        userMessage:
          'La respuesta generada por el proveedor de IA no tiene un formato válido. Intente nuevamente.',
      };
    case 503:
      return {
        userMessage:
          'El asistente de IA no se encuentra disponible temporalmente. Intente nuevamente en unos momentos.',
      };
    case 504:
      return {
        userMessage:
          'El proveedor de IA tardó demasiado en responder (tiempo límite de 8 segundos agotado). Intente nuevamente.',
      };
    default:
      return {
        userMessage:
          'Ocurrió un error inesperado al procesar la solicitud del asistente de IA. Intente nuevamente más tarde.',
      };
  }
}

/**
 * Solicita la generación de un análisis y resumen de avance con IA para un proyecto académico.
 * Endpoint: POST /api/projects/:projectId/ai/analysis
 */
export async function generateProjectAISummary(
  projectId: string,
  request: AIAnalysisRequest = { focus: 'full' },
  userHeaders?: DevUserHeaders,
  options?: AIAssistantRequestOptions,
): Promise<AIAnalysisResponse> {
  const parsedRequest = AIAnalysisRequestSchema.parse(request);

  const response = await apiFetch(`/api/projects/${projectId}/ai/analysis`, {
    method: 'POST',
    headers: buildHeaders(userHeaders),
    body: JSON.stringify(parsedRequest),
    signal: options?.signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ServerErrorPayload | null;
    const { userMessage, reason, retryAfterSeconds } = mapHttpErrorToUserMessage(
      response.status,
      errorBody,
    );
    throw new AIAssistantServiceError(response.status, userMessage, reason, retryAfterSeconds);
  }

  const rawJson: unknown = await response.json();
  const parsedResponse = AIAnalysisResponseSchema.safeParse(rawJson);

  if (!parsedResponse.success) {
    throw new AIAssistantServiceError(
      502,
      'La estructura del análisis devuelta por el servidor no coincide con el contrato esperado.',
    );
  }

  return parsedResponse.data;
}

/**
 * Consulta si el usuario autenticado tiene permiso efectivo para utilizar el asistente IA
 * en el proyecto especificado.
 * Endpoint: GET /api/projects/:projectId/ai/capabilities
 */
export async function getProjectAICapabilities(
  projectId: string,
  userHeaders?: DevUserHeaders,
  options?: AIAssistantRequestOptions,
): Promise<ProjectAICapabilitiesResponse> {
  const response = await apiFetch(`/api/projects/${projectId}/ai/capabilities`, {
    method: 'GET',
    headers: buildHeaders(userHeaders),
    signal: options?.signal,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ServerErrorPayload | null;
    const { userMessage, reason, retryAfterSeconds } = mapHttpErrorToUserMessage(
      response.status,
      errorBody,
    );
    throw new AIAssistantServiceError(response.status, userMessage, reason, retryAfterSeconds);
  }

  const rawJson: unknown = await response.json();
  const parsed = ProjectAICapabilitiesResponseSchema.safeParse(rawJson);

  if (!parsed.success) {
    throw new AIAssistantServiceError(
      502,
      'La respuesta de capacidades de IA devuelta por el servidor no coincide con el contrato esperado.',
    );
  }

  return parsed.data;
}
