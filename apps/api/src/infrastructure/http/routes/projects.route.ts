import type { AuthMiddleware } from '../middleware/auth.middleware.js';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import type {
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  TeacherProjectScopePort,
  SystemClockPort,
  ProjectCreationPort,
} from '@is488/shared';
import { CreateProjectUseCase } from '../../../application/use-cases/create-project.use-case.js';
import {
  ListProjectsUseCase,
  GetProjectByIdUseCase,
} from '../../../application/use-cases/list-projects.use-case.js';
import { createDevAuthMiddleware } from '../middleware/dev-auth.middleware.js';

export interface ProjectsRouterOptions {
  nodeEnv?: string;
  authentication?: AuthMiddleware;
  teacherScope?: TeacherProjectScopePort;
}

/**
 * Crea el enrutador de proyectos (/api/projects) con inyección de repositorio,
 * puerto de creación, repositorio de membresías y reloj.
 */
export function createProjectsRouter(
  projectRepository: ProjectRepositoryPort,
  projectCreationPort: ProjectCreationPort,
  membershipRepository: MembershipRepositoryPort,
  clock: SystemClockPort,
  options: ProjectsRouterOptions = {},
) {
  const router = new Hono();

  const createUseCase = new CreateProjectUseCase(projectCreationPort, clock);
  const listUseCase = new ListProjectsUseCase(
    projectRepository,
    membershipRepository,
    options.teacherScope,
  );
  const getByIdUseCase = new GetProjectByIdUseCase(
    projectRepository,
    membershipRepository,
    options.teacherScope,
  );

  // Aplicar middleware de autenticación de desarrollo a todas las rutas de proyectos
  router.use('*', options.authentication ?? createDevAuthMiddleware({ nodeEnv: options.nodeEnv }));

  // GET /api/projects: Listar proyectos autorizados para el usuario
  router.get('/', async (c) => {
    const user = c.get('user');
    const projects = await listUseCase.execute({
      user: { userId: user.userId, role: user.role },
    });

    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.json(projects, 200);
  });

  // POST /api/projects: Crear un nuevo proyecto
  router.post('/', async (c) => {
    const user = c.get('user');
    let body: unknown;

    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: 'Bad Request',
          message: 'El cuerpo de la petición no es un JSON válido',
        },
        400,
      );
    }

    if (!body || typeof body !== 'object') {
      return c.json(
        {
          error: 'Bad Request',
          message: 'El cuerpo de la petición debe ser un objeto',
        },
        400,
      );
    }

    try {
      const created = await createUseCase.execute({
        ...(body as Record<string, unknown>),
        title: (body as { title?: unknown }).title as string,
        courseCode: (body as { courseCode?: unknown }).courseCode as string,
        startDate: (body as { startDate?: unknown }).startDate as string,
        targetDate: (body as { targetDate?: unknown }).targetDate as string,
        description: (body as { description?: unknown }).description as string | undefined,
        creatorId: user.userId,
      });

      return c.json(created, 201);
    } catch (err) {
      if (err instanceof ZodError) {
        return c.json(
          {
            error: 'Bad Request',
            message: 'Error de validación en los datos del proyecto',
            details: err.issues,
          },
          400,
        );
      }

      const errorMessage = err instanceof Error ? err.message : 'Error al procesar la solicitud';
      return c.json(
        {
          error: 'Bad Request',
          message: errorMessage,
        },
        400,
      );
    }
  });

  // GET /api/projects/:id: Consultar detalle de proyecto con autorización estricta
  router.get('/:id', async (c) => {
    const id = c.req.param('id');
    const user = c.get('user');

    const project = await getByIdUseCase.execute({
      id,
      user: { userId: user.userId, role: user.role },
    });

    if (!project) {
      // 404 para no revelar existencia si el usuario no tiene permisos
      c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      return c.json(
        {
          error: 'Not Found',
          message: 'Proyecto no encontrado',
        },
        404,
      );
    }

    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.json(project, 200);
  });

  // Manejador de métodos no soportados en la raíz /api/projects
  router.all('/', (c) => {
    c.header('Allow', 'GET, POST');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  // Manejador de métodos no soportados en /api/projects/:id
  router.all('/:id', (c) => {
    c.header('Allow', 'GET');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  return router;
}
