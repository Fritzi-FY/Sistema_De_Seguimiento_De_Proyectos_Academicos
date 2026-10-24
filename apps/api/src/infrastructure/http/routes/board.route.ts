import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod';
import type {
  BoardRepositoryPort,
  BoardColumnDeletionPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
} from '@is488/shared';
import {
  CreateBoardColumnSchema,
  UpdateBoardColumnSchema,
  DeleteBoardColumnQuerySchema,
} from '@is488/shared';
import { GetProjectBoardUseCase } from '../../../application/use-cases/get-project-board.use-case.js';
import { CreateBoardColumnUseCase } from '../../../application/use-cases/create-board-column.use-case.js';
import { UpdateBoardColumnUseCase } from '../../../application/use-cases/update-board-column.use-case.js';
import { DeleteBoardColumnUseCase } from '../../../application/use-cases/delete-board-column.use-case.js';
import { createDevAuthMiddleware } from '../middleware/dev-auth.middleware.js';

export interface BoardRouterOptions {
  nodeEnv?: string;
}

const UuidSchema = z.string().uuid({ message: 'El identificador debe ser un UUID valido' });

/**
 * Enrutador HTTP para la gestión de tableros y columnas Kanban.
 * Debe montarse bajo /api/projects para que las rutas efectivas sean:
 *   GET    /api/projects/:projectId/board
 *   POST   /api/projects/:projectId/board/columns
 *   PATCH  /api/projects/:projectId/board/columns/:columnId
 *   DELETE /api/projects/:projectId/board/columns/:columnId
 */
export function createBoardRouter(
  boardRepository: BoardRepositoryPort,
  boardColumnDeletionPort: BoardColumnDeletionPort,
  projectRepository: ProjectRepositoryPort,
  membershipRepository: MembershipRepositoryPort,
  clock: SystemClockPort,
  options: BoardRouterOptions = {},
) {
  const router = new Hono();

  const getBoardUseCase = new GetProjectBoardUseCase(
    boardRepository,
    projectRepository,
    membershipRepository,
  );
  const createColumnUseCase = new CreateBoardColumnUseCase(
    boardRepository,
    projectRepository,
    membershipRepository,
  );
  const updateColumnUseCase = new UpdateBoardColumnUseCase(
    boardRepository,
    projectRepository,
    membershipRepository,
  );
  const deleteColumnUseCase = new DeleteBoardColumnUseCase(
    boardColumnDeletionPort,
    projectRepository,
    membershipRepository,
    clock,
  );

  // Aplicar middleware de autenticación de desarrollo a todas las rutas de este router
  router.use('*', createDevAuthMiddleware({ nodeEnv: options.nodeEnv }));

  /**
   * GET /:projectId/board — Consulta o inicialización perezosa e idempotente del tablero Kanban
   * Respuestas: 200, 400, 401, 404, 405, 500
   */
  router.get('/:projectId/board', async (c) => {
    const rawProjectId = c.req.param('projectId');
    const parseProjectId = UuidSchema.safeParse(rawProjectId);
    if (!parseProjectId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de proyecto debe ser un UUID valido',
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const board = await getBoardUseCase.execute({
        projectId: parseProjectId.data,
        requesterId: user.userId,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(board, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * POST /:projectId/board/columns — Crear una nueva columna en el tablero
   * Respuestas: 201, 400, 401, 404, 405, 500
   */
  router.post('/:projectId/board/columns', async (c) => {
    const rawProjectId = c.req.param('projectId');
    const parseProjectId = UuidSchema.safeParse(rawProjectId);
    if (!parseProjectId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de proyecto debe ser un UUID valido',
        },
        400,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El cuerpo de la petición no es un JSON válido',
        },
        400,
      );
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El cuerpo de la petición debe ser un objeto JSON',
        },
        400,
      );
    }

    const parseBody = CreateBoardColumnSchema.safeParse(rawBody);
    if (!parseBody.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los datos de la columna',
          details: parseBody.error.issues,
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const column = await createColumnUseCase.execute({
        projectId: parseProjectId.data,
        requesterId: user.userId,
        name: parseBody.data.name,
        category: parseBody.data.category,
        color: parseBody.data.color,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(column, 201);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * PATCH /:projectId/board/columns/:columnId — Actualizar atributos o reordenar contiguamente una columna
   * Respuestas: 200, 400, 401, 404, 405, 500
   */
  router.patch('/:projectId/board/columns/:columnId', async (c) => {
    const rawProjectId = c.req.param('projectId');
    const parseProjectId = UuidSchema.safeParse(rawProjectId);
    if (!parseProjectId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de proyecto debe ser un UUID valido',
        },
        400,
      );
    }

    const rawColumnId = c.req.param('columnId');
    const parseColumnId = UuidSchema.safeParse(rawColumnId);
    if (!parseColumnId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de columna debe ser un UUID valido',
        },
        400,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El cuerpo de la petición no es un JSON válido',
        },
        400,
      );
    }

    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El cuerpo de la petición debe ser un objeto JSON',
        },
        400,
      );
    }

    const parseBody = UpdateBoardColumnSchema.safeParse(rawBody);
    if (!parseBody.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los datos de la columna',
          details: parseBody.error.issues,
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const column = await updateColumnUseCase.execute({
        projectId: parseProjectId.data,
        columnId: parseColumnId.data,
        requesterId: user.userId,
        name: parseBody.data.name,
        category: parseBody.data.category,
        color: parseBody.data.color,
        orderIndex: parseBody.data.orderIndex,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(column, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * DELETE /:projectId/board/columns/:columnId — Eliminar una columna de forma atómica
   * Si la columna contiene tareas, exige targetColumnId para migración atómica (409 Conflict si falta).
   * Rechaza si es la última columna restante (400 Bad Request).
   * Respuestas: 200, 400, 401, 404, 409, 405, 500
   */
  router.delete('/:projectId/board/columns/:columnId', async (c) => {
    const rawProjectId = c.req.param('projectId');
    const parseProjectId = UuidSchema.safeParse(rawProjectId);
    if (!parseProjectId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de proyecto debe ser un UUID valido',
        },
        400,
      );
    }

    const rawColumnId = c.req.param('columnId');
    const parseColumnId = UuidSchema.safeParse(rawColumnId);
    if (!parseColumnId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de columna debe ser un UUID valido',
        },
        400,
      );
    }

    const targetColumnIdQuery = c.req.query('targetColumnId');
    const queryPayload: { targetColumnId?: string } = {};
    if (targetColumnIdQuery !== undefined) {
      queryPayload.targetColumnId = targetColumnIdQuery;
    }
    const parseQuery = DeleteBoardColumnQuerySchema.safeParse(queryPayload);
    if (!parseQuery.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los parámetros de consulta',
          details: parseQuery.error.issues,
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const result = await deleteColumnUseCase.execute({
        projectId: parseProjectId.data,
        columnId: parseColumnId.data,
        requesterId: user.userId,
        targetColumnId: parseQuery.data.targetColumnId,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  // Manejo de métodos no permitidos (405 Method Not Allowed)
  // LIMITACIÓN DE ALCANCE: El preflight CORS (OPTIONS) queda fuera del alcance de este enrutador
  // (delegado a Vite proxy en local y a Cloudflare en producción). Peticiones OPTIONS pasan a 404 Not Found por defecto.
  router.all('/:projectId/board', (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    c.header('Allow', 'GET');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  router.all('/:projectId/board/columns', (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    c.header('Allow', 'POST');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  router.all('/:projectId/board/columns/:columnId', (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    c.header('Allow', 'PATCH, DELETE');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  return router;
}

/**
 * Mapea errores de casos de uso y de validación a respuestas HTTP uniformes.
 */
function handleUseCaseError(err: unknown, c: Context): Response {
  c.header('Cache-Control', 'no-store');

  if (err instanceof ZodError) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Error de validación',
        details: err.issues,
      },
      400,
    ) as Response;
  }

  const statusCode = (err as { statusCode?: number }).statusCode;
  const message = err instanceof Error ? err.message : 'Error al procesar la solicitud';

  if (statusCode === 400) {
    return c.json({ error: 'Bad Request', message }, 400) as Response;
  }
  if (statusCode === 403) {
    return c.json({ error: 'Forbidden', message }, 403) as Response;
  }
  if (statusCode === 404) {
    return c.json({ error: 'Not Found', message }, 404) as Response;
  }
  if (statusCode === 409) {
    return c.json({ error: 'Conflict', message }, 409) as Response;
  }
  if (statusCode === 422) {
    return c.json({ error: 'Unprocessable Entity', message }, 422) as Response;
  }

  // Error inesperado — el manejador global de Hono (app.onError) devolverá 500 sin detalles internos
  throw err;
}
