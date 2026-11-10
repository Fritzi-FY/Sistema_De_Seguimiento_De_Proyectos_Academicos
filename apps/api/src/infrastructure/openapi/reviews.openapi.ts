import { z } from 'zod';
import {
  CreateReviewRequestSchema,
  RespondReviewRequestSchema,
  ResubmitReviewRequestSchema,
  ReviewRequestSummaryResponseSchema,
  ReviewDetailResponseSchema,
} from '@is488/shared';

function schema(value: z.ZodType) {
  const result = z.toJSONSchema(value);
  delete result.$schema;
  return result;
}

export const reviewSchemas = {
  CreateReviewRequest: schema(CreateReviewRequestSchema),
  RespondReviewRequest: schema(RespondReviewRequestSchema),
  ResubmitReviewRequest: schema(ResubmitReviewRequestSchema),
  ReviewRequestSummaryResponse: schema(ReviewRequestSummaryResponseSchema),
  ReviewDetailResponse: schema(ReviewDetailResponseSchema),
};

function operation(operationId: string, requestSchema?: string, detail = false, created = false) {
  const response = (description: string) => ({
    description,
    headers: { 'Cache-Control': { schema: { type: 'string', const: 'no-store' } } },
  });
  return {
    operationId,
    security: [{ SessionCookie: [] }],
    description:
      'Identidad de sesión. Consulta exclusiva al solicitante activo y docente asignado; 404 uniforme. Historial por sequenceNumber ASC. Entrega de notificaciones diferida a EPIC-007.',
    parameters: [
      { name: 'projectId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
      ...(!created
        ? [
            {
              name: 'reviewId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ]
        : []),
    ],
    ...(requestSchema
      ? {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/' + requestSchema } },
            },
          },
        }
      : {}),
    responses: {
      [created ? '201' : '200']: {
        ...response('Revisión persistida; historial completo en la consulta.'),
        content: {
          'application/json': {
            schema: {
              $ref:
                '#/components/schemas/' +
                (detail ? 'ReviewDetailResponse' : 'ReviewRequestSummaryResponse'),
            },
          },
        },
      },
      '400': response('Identificadores o cuerpo inválidos'),
      '401': response('Sesión requerida'),
      '403': response(
        'Rol de sesión no permitido: student para solicitar o reenviar; teacher para responder',
      ),
      '404': response('Recurso inexistente o sin acceso'),
      '409': response('Conflicto de estado de revisión'),
      '500': response('Error interno sin detalles sensibles'),
    },
  };
}

export const reviewPaths = {
  '/api/projects/{projectId}/reviews': {
    post: operation('requestTeacherReview', 'CreateReviewRequest', false, true),
  },
  '/api/projects/{projectId}/reviews/{reviewId}/response': {
    post: operation('respondTeacherReview', 'RespondReviewRequest'),
  },
  '/api/projects/{projectId}/reviews/{reviewId}/re-submit': {
    post: operation('resubmitTeacherReview', 'ResubmitReviewRequest'),
  },
  '/api/projects/{projectId}/reviews/{reviewId}': {
    get: operation('getTeacherReview', undefined, true),
  },
};
