import { Hono, type Context } from 'hono';
import { ZodError } from 'zod';
import type { ProjectRepositoryPort, MembershipRepositoryPort, SystemClockPort } from '@is488/shared';
import { AddMemberRequestSchema } from '@is488/shared';
import { AddMemberUseCase } from '../../../application/use-cases/add-member.use-case.js';
import { RemoveMemberUseCase } from '../../../application/use-cases/remove-member.use-case.js';
import { ListMembersUseCase } from '../../../application/use-cases/list-members.use-case.js';
import { createDevAuthMiddleware } from '../middleware/dev-auth.middleware.js';

export interface ProjectMembersRouterOptions {
  nodeEnv?: string;
}

/**
 * Crea el enrutador de miembros de proyectos bajo /:projectId/members.
 * Debe montarse bajo /api/projects para que las rutas queden en:
 *   POST   /api/projects/:projectId/members
 *   DELETE /api/projects/:projectId/members/:userId
 *   GET    /api/projects/:projectId/members
 */
export function createProjectMembersRouter(
  membershipRepository: MembershipRepositoryPort,
  projectRepository: ProjectRepositoryPort,
  clock: SystemClockPort,
  options: ProjectMembersRouterOptions = {},
) {
  const router = new Hono();

  const addMemberUseCase = new AddMemberUseCase(projectRepository, membershipRepository, clock);
  const removeMemberUseCase = new RemoveMemberUseCase(projectRepository, membershipRepository, clock);
  const listMembersUseCase = new ListMembersUseCase(projectRepository, membershipRepository);

  // Aplicar middleware de autenticación de desarrollo a todas las rutas
  router.use('*', createDevAuthMiddleware({ nodeEnv: options.nodeEnv }));

  /**
   * POST /:projectId/members — Agregar un colaborador al proyecto
   * Respuestas: 201, 400, 401, 403, 404, 409
   */
  router.post('/:projectId/members', async (c) => {
    const projectId = c.req.param('projectId');
    const user = c.get('user');

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        { error: 'Bad Request', message: 'El cuerpo de la petición no es un JSON válido' },
        400,
      );
    }

    // Validar con el schema Zod (solo acepta role: 'collaborator')
    const parseResult = AddMemberRequestSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los datos de membresía',
          details: parseResult.error.issues,
        },
        400,
      );
    }

    try {
      const membership = await addMemberUseCase.execute({
        projectId,
        requesterId: user.userId,
        userId: parseResult.data.userId,
      });
      return c.json(membership, 201);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * DELETE /:projectId/members/:userId — Retirar un colaborador del proyecto
   * Respuestas: 200, 401, 403, 404, 422
   */
  router.delete('/:projectId/members/:userId', async (c) => {
    const projectId = c.req.param('projectId');
    const targetUserId = c.req.param('userId');
    const user = c.get('user');

    try {
      const membership = await removeMemberUseCase.execute({
        projectId,
        requesterId: user.userId,
        targetUserId,
      });
      return c.json(membership, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * GET /:projectId/members — Listar miembros activos del proyecto
   * Respuestas: 200, 401, 404
   */
  router.get('/:projectId/members', async (c) => {
    const projectId = c.req.param('projectId');
    const user = c.get('user');

    try {
      const members = await listMembersUseCase.execute({
        projectId,
        requesterId: user.userId,
      });
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      return c.json(members, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  // 405 para métodos no soportados en /:projectId/members
  router.all('/:projectId/members', (c) => {
    c.header('Allow', 'GET, POST');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  // 405 para métodos no soportados en /:projectId/members/:userId
  router.all('/:projectId/members/:userId', (c) => {
    c.header('Allow', 'DELETE');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  return router;
}

/**
 * Mapea los errores de los casos de uso a respuestas HTTP apropiadas.
 * Los casos de uso adjuntan `statusCode` a los errores para indicar el código HTTP correcto.
 */
function handleUseCaseError(err: unknown, c: Context): Response {
  if (err instanceof ZodError) {
    return c.json(
      { error: 'Bad Request', message: 'Error de validación', details: err.issues },
      400,
    ) as Response;
  }

  const statusCode = (err as { statusCode?: number }).statusCode;
  const message = err instanceof Error ? err.message : 'Error al procesar la solicitud';

  if (statusCode === 403) {
    return c.json({ error: 'Forbidden', message }, 403) as Response;
  }
  if (statusCode === 404) {
    return c.json({ error: 'Not Found', message: 'Recurso no encontrado' }, 404) as Response;
  }
  if (statusCode === 409) {
    return c.json({ error: 'Conflict', message }, 409) as Response;
  }
  if (statusCode === 422) {
    return c.json({ error: 'Unprocessable Entity', message }, 422) as Response;
  }

  // Error inesperado — el manejador global de Hono (onError) devolverá 500
  throw err;
}
