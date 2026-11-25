import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  AIAnalysisRequestSchema,
  AIInvalidResponseError,
  AIProviderUnavailableError,
  AITimeoutError,
  AIAuthenticationError,
} from '@is488/shared';
import type { AuthMiddleware } from '../middleware/auth.middleware.js';
import type { GenerateProjectAISummaryUseCase } from '../../../application/use-cases/generate-project-ai-summary.use-case.js';

const ParamSchema = z.object({
  projectId: z.string().uuid({ message: 'El identificador de proyecto debe ser un UUID válido' }),
});

export interface AIAssistantRouterOptions {
  nodeEnv?: string;
  authentication?: AuthMiddleware;
}

/**
 * Enrutador HTTP para el Asistente de IA (IS488).
 * Endpoint: POST /api/projects/:projectId/ai/analysis
 *
 * Directrices de seguridad y aislamiento:
 * 1. Autenticación estricta: userId proviene exclusivamente del contexto de sesión (c.get('user')).
 *    Cualquier intento de inyectar o suplantar userId mediante el cuerpo es rechazado con 400 (schema strict).
 * 2. Validación Zod en params y body antes de invocar el caso de uso.
 * 3. Mapeo explícito a códigos HTTP estándar: 200, 400, 401, 403, 404, 429, 502, 503, 504.
 * 4. Cabecera 'Cache-Control: no-store' en todas las respuestas para evitar almacenamiento de datos sensibles.
 */
export function createAIAssistantRouter(
  generateSummaryUseCase: GenerateProjectAISummaryUseCase,
  options: AIAssistantRouterOptions = {},
) {
  const router = new Hono();

  if (options.authentication) {
    router.use('*', options.authentication);
  }

  router.get('/:projectId/ai/capabilities', async (c: Context) => {
    const user = c.get('user');
    if (!user || !user.userId) {
      return c.json({ error: 'Unauthorized', message: 'Sesión no autenticada' }, 401, {
        'Cache-Control': 'no-store',
      });
    }

    const parsedParams = ParamSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de proyecto debe ser un UUID válido',
          details: parsedParams.error.format(),
        },
        400,
        { 'Cache-Control': 'no-store' },
      );
    }

    try {
      const capabilities = await generateSummaryUseCase.getCapabilities({
        projectId: parsedParams.data.projectId,
        userId: user.userId,
      });

      return c.json(capabilities, 200, { 'Cache-Control': 'no-store' });
    } catch (error: unknown) {
      const status = (error as { statusCode?: number } | null)?.statusCode;
      if (status === 404) {
        return c.json({ error: 'Not Found', message: (error as Error).message }, 404, {
          'Cache-Control': 'no-store',
        });
      }

      return c.json({ error: 'Internal Server Error' }, 500, { 'Cache-Control': 'no-store' });
    }
  });

  router.post('/:projectId/ai/analysis', async (c: Context) => {
    // 1. Extraer usuario autenticado del contexto de sesión
    const user = c.get('user');
    if (!user || !user.userId) {
      return c.json({ error: 'Unauthorized', message: 'Sesión no autenticada' }, 401, {
        'Cache-Control': 'no-store',
      });
    }

    // 2. Validar parámetro de ruta projectId
    const parsedParams = ParamSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de proyecto debe ser un UUID válido',
          details: parsedParams.error.format(),
        },
        400,
        { 'Cache-Control': 'no-store' },
      );
    }
    const { projectId } = parsedParams.data;

    // 3. Validar cuerpo de la solicitud
    let rawBody: unknown = {};
    const text = await c.req.text().catch(() => '');
    if (text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return c.json(
          { error: 'Bad Request', message: 'El cuerpo de la solicitud no es un JSON válido' },
          400,
          { 'Cache-Control': 'no-store' },
        );
      }
    }

    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return c.json(
        { error: 'Bad Request', message: 'El cuerpo de la solicitud debe ser un objeto JSON' },
        400,
        { 'Cache-Control': 'no-store' },
      );
    }

    const parsedBody = AIAnalysisRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return c.json(
        {
          error: 'Bad Request',
          message: 'Cuerpo de solicitud inválido o contiene campos no permitidos',
          details: parsedBody.error.format(),
        },
        400,
        { 'Cache-Control': 'no-store' },
      );
    }

    // 4. Ejecutar caso de uso con identidad inmutable de sesión
    try {
      const result = await generateSummaryUseCase.execute({
        projectId,
        userId: user.userId,
        focus: parsedBody.data.focus,
      });

      return c.json(result, 200, { 'Cache-Control': 'no-store' });
    } catch (error: unknown) {
      const status = (error as { statusCode?: number } | null)?.statusCode;

      if (status === 403) {
        return c.json({ error: 'Forbidden', message: (error as Error).message }, 403, {
          'Cache-Control': 'no-store',
        });
      }

      if (status === 404) {
        return c.json({ error: 'Not Found', message: (error as Error).message }, 404, {
          'Cache-Control': 'no-store',
        });
      }

      if (status === 429) {
        const detail = error as { message?: string; reason?: string; retryAfterSeconds?: number };
        const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
        if (detail.retryAfterSeconds !== undefined) {
          headers['Retry-After'] = String(detail.retryAfterSeconds);
        }

        return c.json(
          {
            error: 'Too Many Requests',
            message: detail.message ?? 'Límite de solicitudes de IA excedido',
            reason: detail.reason,
            retryAfterSeconds: detail.retryAfterSeconds,
          },
          429,
          headers,
        );
      }

      if (status === 502 || error instanceof AIInvalidResponseError) {
        return c.json(
          {
            error: 'Bad Gateway',
            message: 'La respuesta generada por el proveedor de IA no tiene un formato válido.',
          },
          502,
          { 'Cache-Control': 'no-store' },
        );
      }

      if (status === 504 || error instanceof AITimeoutError) {
        return c.json(
          {
            error: 'Gateway Timeout',
            message: 'El proveedor de IA no respondió dentro del tiempo máximo permitido.',
          },
          504,
          { 'Cache-Control': 'no-store' },
        );
      }

      if (
        status === 503 ||
        status === 401 ||
        error instanceof AIProviderUnavailableError ||
        error instanceof AIAuthenticationError
      ) {
        return c.json(
          {
            error: 'Service Unavailable',
            message: 'El servicio de IA no se encuentra disponible temporalmente.',
          },
          503,
          { 'Cache-Control': 'no-store' },
        );
      }

      return c.json({ error: 'Internal Server Error' }, 500, { 'Cache-Control': 'no-store' });
    }
  });

  return router;
}
