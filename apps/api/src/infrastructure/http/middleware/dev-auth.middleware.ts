import type { Context, MiddlewareHandler, Next } from 'hono';

export type { AuthUserContext } from './auth.middleware.js';
export interface DevAuthOptions {
  nodeEnv?: string;
}

/**
 * Middleware de contexto de identidad simulado para desarrollo local (IS488).
 *
 * POLÍTICA DE SEGURIDAD ESTRICTA:
 * 1. Deshabilitado por defecto: si no se envía la cabecera explícita X-Dev-User-Id, la petición es rechazada con HTTP 401.
 * 2. Rechazo absoluto en producción o entorno no configurado: solo se habilita explícitamente para
 *    'development' o 'test'. Cualquier otro entorno (producción, undefined, vacío) es rechazado de inmediato
 *    con HTTP 401 Unauthorized sin excepción.
 * 3. Compatible con CORS: peticiones preflight (OPTIONS) no son interceptadas por este middleware.
 * 4. No constituye autenticación real: es un andamiaje provisional para desarrollo y pruebas (ADR-004).
 */
export function createDevAuthMiddleware(options: DevAuthOptions = {}): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    // Si la petición es OPTIONS (CORS preflight), no interceptar con autenticación
    if (c.req.method === 'OPTIONS') {
      return next();
    }

    const currentEnv = options.nodeEnv ?? process.env.NODE_ENV;
    const isAllowed = currentEnv === 'development' || currentEnv === 'test';

    // En producción o entorno no configurado se rechaza cualquier intento de usar identidad simulada
    if (!isAllowed) {
      return c.json(
        {
          error: 'Unauthorized',
          message:
            'El contexto de identidad simulado está estrictamente deshabilitado en entornos de producción o no configurados.',
        },
        401,
      );
    }

    const devUserId = c.req.header('X-Dev-User-Id')?.trim();
    const devUserRole = c.req.header('X-Dev-User-Role')?.trim() || 'student';

    // Deshabilitado por defecto si no se especifica explícitamente en el request
    if (!devUserId) {
      return c.json(
        {
          error: 'Unauthorized',
          message:
            'Acceso no autorizado: el contexto de identidad simulado requiere la cabecera explícita X-Dev-User-Id.',
        },
        401,
      );
    }

    c.set('user', {
      userId: devUserId,
      role: devUserRole,
    });

    await next();
  };
}
