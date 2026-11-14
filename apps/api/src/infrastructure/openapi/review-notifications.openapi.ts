import { z } from 'zod';
import {
  ReviewNotificationCursorSchema,
  ReviewNotificationItemSchema,
  ReviewNotificationListResponseSchema,
} from '@is488/shared';

function schema(value: z.ZodType) {
  const result = z.toJSONSchema(value);
  delete result.$schema;
  return result;
}

export const reviewNotificationSchemas = {
  ReviewNotificationCursor: schema(ReviewNotificationCursorSchema),
  ReviewNotificationItem: schema(ReviewNotificationItemSchema),
  ReviewNotificationListResponse: schema(ReviewNotificationListResponseSchema),
};

function response(description: string) {
  return {
    description,
    headers: {
      'Cache-Control': { schema: { type: 'string', enum: ['no-store', 'private, no-store'] } },
    },
  };
}

export const reviewNotificationPaths = {
  '/api/review-notifications': {
    get: {
      operationId: 'listStudentReviewNotifications',
      summary: 'Bandeja de revisiones del estudiante autenticado',
      description:
        'Solo rol student de la sesión. Filtra destinatario, solicitante original y membresía activa antes de paginar en cada petición. Orden created_at DESC, id DESC; lookahead autorizado y cursor del último item devuelto. Estado histórico, sin escrituras, reparación ni emisión. Paginación viva, sin snapshot compartido ni revocación retroactiva.',
      security: [{ SessionCookie: [] }],
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
        {
          name: 'cursor',
          in: 'query',
          required: false,
          description:
            'Posición v1: base64url sin padding de JSON UTF-8 con claves exactas v=1, createdAt e id. createdAt UTC YYYY-MM-DDTHH:mm:ss.ffffffZ conserva seis decimales; id UUID canónico minúsculo. No pasar por Date. No contiene identidad ni concede permisos; puede ser ajeno o inexistente. Se rechazan parámetros desconocidos, repetidos y selectores de identidad/proyecto.',
          schema: { $ref: '#/components/schemas/ReviewNotificationCursor' },
        },
      ],
      responses: {
        '200': {
          ...response(
            'Página autorizada, o items vacío con nextCursor null si no hay más filas autorizadas.',
          ),
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ReviewNotificationListResponse' },
            },
          },
        },
        '400': response('Query o cursor inválido; no consulta el almacén.'),
        '401': response('Sesión válida requerida; headers de desarrollo no sustituyen la sesión.'),
        '403': response('La sesión no tiene rol student.'),
        '500': response('Error interno saneado, sin página parcial, falso vacío ni detalles SQL.'),
      },
    },
  },
};
