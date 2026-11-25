import { z } from 'zod';
import {
  AIAnalysisRequestSchema,
  AIAnalysisResponseSchema,
  ProjectAICapabilitiesResponseSchema,
} from '@is488/shared';

function schema(value: z.ZodType) {
  const result = z.toJSONSchema(value);
  delete (result as Record<string, unknown>).$schema;
  return result;
}

export const aiAssistantSchemas = {
  AIAnalysisRequest: schema(AIAnalysisRequestSchema),
  AIAnalysisResponse: schema(AIAnalysisResponseSchema),
  ProjectAICapabilitiesResponse: schema(ProjectAICapabilitiesResponseSchema),
  AIRateLimitErrorResponse: {
    type: 'object',
    properties: {
      error: { type: 'string', const: 'Too Many Requests' },
      message: { type: 'string' },
      reason: { type: 'string', enum: ['IN_FLIGHT_CONFLICT', 'RATE_LIMIT_EXCEEDED'] },
      retryAfterSeconds: { type: 'integer' },
    },
    required: ['error', 'message'],
  },
};

export const aiAssistantPaths = {
  '/api/projects/{projectId}/ai/analysis': {
    post: {
      operationId: 'generateProjectAISummary',
      summary: 'Genera un análisis y resumen de avance con IA para el proyecto',
      description:
        'Genera bajo demanda un análisis estructurado (resumen de avance, señales de riesgo y próximos pasos) respetando salvaguardas éticas. Requiere membresía activa o alcance docente asignado. No califica ni emite juicios académicos evaluativos. Sujeto a cuota máxima de 1 análisis en vuelo por usuario/proyecto y 5 análisis en ventana móvil de 10 minutos por proyecto.',
      security: [{ SessionCookie: [] }],
      parameters: [
        {
          name: 'projectId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Identificador único (UUID) del proyecto académico',
        },
      ],
      requestBody: {
        required: false,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/AIAnalysisRequest' },
          },
        },
      },
      responses: {
        '200': {
          description:
            'Análisis de IA generado exitosamente con descargo formativo inyectado por el servidor.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AIAnalysisResponse' },
            },
          },
        },
        '400': {
          description: 'Identificador de proyecto inválido o cuerpo de solicitud malformado.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '401': {
          description: 'Sesión no autenticada.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '403': {
          description: 'Acceso denegado: el usuario no es creador, miembro activo ni docente asignado.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '404': {
          description: 'Proyecto no encontrado.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '429': {
          description:
            'Límite de solicitudes de IA excedido (análisis en vuelo o cuota de 5 en 10 min superada).',
          headers: {
            'Cache-Control': { schema: { type: 'string', const: 'no-store' } },
            'Retry-After': { schema: { type: 'string' }, description: 'Segundos para reintentar' },
          },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AIRateLimitErrorResponse' },
            },
          },
        },
        '502': {
          description: 'Respuesta inválida o malformada del modelo de IA.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '503': {
          description: 'Asistente de IA no disponible temporalmente o no configurado.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '504': {
          description: 'Tiempo de espera del proveedor de IA agotado (8 segundos).',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
      },
    },
  },
  '/api/projects/{projectId}/ai/capabilities': {
    get: {
      operationId: 'getProjectAICapabilities',
      summary: 'Consulta si el usuario autenticado puede utilizar el asistente IA en el proyecto',
      description:
        'Evalúa en servidor si el usuario autenticado es creador, miembro activo o docente asignado del proyecto, sin exponer reglas paralelas ni otorgar acceso por sí mismo.',
      security: [{ SessionCookie: [] }],
      parameters: [
        {
          name: 'projectId',
          in: 'path',
          required: true,
          schema: { type: 'string', format: 'uuid' },
          description: 'Identificador único (UUID) del proyecto académico',
        },
      ],
      responses: {
        '200': {
          description: 'Capacidad efectiva del usuario autenticado respecto al asistente IA.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ProjectAICapabilitiesResponse' },
            },
          },
        },
        '400': {
          description: 'Identificador de proyecto inválido.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '401': {
          description: 'Sesión no autenticada.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
        '404': {
          description: 'Proyecto no encontrado.',
          headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
        },
      },
    },
  },
};
