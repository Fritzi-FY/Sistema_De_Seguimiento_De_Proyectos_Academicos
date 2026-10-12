/**
 * Especificación OpenAPI 3.1 declarada para el contrato de la API del sistema IS488.
 * Garantiza total coincidencia con el esquema Zod (HealthResponseSchema) de @is488/shared.
 */
export const openApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'Sistema de Seguimiento de Proyectos Académicos IS488 - API',
    version: '0.1.0',
    description:
      'API técnica y operativa del Sistema de Seguimiento de Proyectos Académicos (UNSCH IS488).',
  },
  paths: {
    '/api/health': {
      get: {
        summary: 'Diagnóstico de salud operativa',
        description:
          'Retorna el estado de disponibilidad operativa, versión activa y marca de tiempo del servidor.',
        operationId: 'getSystemHealth',
        responses: {
          '200': {
            description: 'Servicio operativo y disponible.',
            headers: {
              'Cache-Control': {
                description: 'Directivas de caché obligatorias para evitar almacenamiento erróneo.',
                schema: {
                  type: 'string',
                  example: 'no-cache, no-store, must-revalidate',
                },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: {
                      type: 'string',
                      const: 'ok',
                      description: 'Estado de operatividad del sistema.',
                    },
                    timestamp: {
                      type: 'string',
                      format: 'date-time',
                      description: 'Marca de tiempo actual del servidor en formato ISO-8601 UTC.',
                    },
                    version: {
                      type: 'string',
                      minLength: 1,
                      description: 'Versión técnica del sistema en ejecución.',
                    },
                  },
                  required: ['status', 'timestamp', 'version'],
                  additionalProperties: false,
                },
              },
            },
          },
          '405': {
            description: 'Método HTTP no admitido sobre el endpoint de diagnóstico.',
            headers: {
              Allow: {
                description: 'Métodos HTTP permitidos para este recurso.',
                schema: {
                  type: 'string',
                  example: 'GET',
                },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    error: {
                      type: 'string',
                      example: 'Method Not Allowed',
                    },
                  },
                  required: ['error'],
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type OpenApiSpec = typeof openApiSpec;
