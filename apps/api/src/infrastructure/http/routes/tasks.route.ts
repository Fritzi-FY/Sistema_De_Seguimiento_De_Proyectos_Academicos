import { Hono, type Context } from 'hono';
import { z, ZodError } from 'zod';
import type {
  TaskCreationPort,
  TaskListPort,
  TaskUpdatePort,
  TaskMovePort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  SystemClockPort,
} from '@is488/shared';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  MoveTaskSchema,
  ListTasksQuerySchema,
} from '@is488/shared';
import { CreateTaskUseCase } from '../../../application/use-cases/create-task.use-case.js';
import { ListTasksUseCase } from '../../../application/use-cases/list-tasks.use-case.js';
import { UpdateTaskUseCase } from '../../../application/use-cases/update-task.use-case.js';
import { MoveTaskUseCase } from '../../../application/use-cases/move-task.use-case.js';
import { createDevAuthMiddleware } from '../middleware/dev-auth.middleware.js';

export interface TasksRouterOptions {
  nodeEnv?: string;
}

const UuidSchema = z.string().uuid({ message: 'El identificador debe ser un UUID valido' });

/**
 * Lista exhaustiva de campos de identidad, proyecto y movimiento cuyo intento de
 * modificación mediante PATCH /tasks/:taskId está estrictamente prohibido.
 * Se verifican antes del análisis de Zod para evitar que Zod los descarte silenciosamente.
 */
const PROTECTED_TASK_FIELDS = [
  'id',
  'projectId',
  'targetProjectId',
  'newProjectId',
  'creatorId',
  'columnId',
  'orderIndex',
  'createdAt',
  'updatedAt',
] as const;

/**
 * Campos permitidos en cada operación de mutación de tarea.
 * Se verifican antes del parseo Zod para que campos desconocidos devuelvan 400 explícito
 * en lugar de ser descartados silenciosamente, conforme a additionalProperties:false del
 * contrato OpenAPI (CreateTaskRequest, UpdateTaskRequest, MoveTaskRequest).
 */
const KNOWN_CREATE_TASK_FIELDS = new Set([
  'title',
  'description',
  'columnId',
  'priority',
  'dueDate',
  'labels',
  'assigneeIds',
]);

const KNOWN_UPDATE_TASK_FIELDS = new Set([
  'title',
  'description',
  'priority',
  'dueDate',
  'labels',
  'assigneeIds',
]);

const KNOWN_MOVE_TASK_FIELDS = new Set(['destinationColumnId', 'destinationIndex']);

/**
 * Devuelve el primer campo del body que no está en el conjunto de campos conocidos,
 * o undefined si el body es conforme.
 */
function findUnknownField(body: Record<string, unknown>, known: Set<string>): string | undefined {
  return Object.keys(body).find((k) => !known.has(k));
}

/**
 * Enrutador HTTP para la gestión de tareas del tablero Kanban.
 * Debe montarse bajo /api/projects para que las rutas efectivas sean:
 *   GET   /api/projects/:projectId/tasks
 *   POST  /api/projects/:projectId/tasks
 *   PATCH /api/projects/:projectId/tasks/:taskId
 *   POST  /api/projects/:projectId/tasks/:taskId/move
 */
export function createTasksRouter(
  taskCreationPort: TaskCreationPort,
  taskListPort: TaskListPort,
  taskUpdatePort: TaskUpdatePort,
  taskMovePort: TaskMovePort,
  projectRepository: ProjectRepositoryPort,
  membershipRepository: MembershipRepositoryPort,
  clock: SystemClockPort,
  options: TasksRouterOptions = {},
) {
  const router = new Hono();

  const createTaskUseCase = new CreateTaskUseCase(
    taskCreationPort,
    projectRepository,
    membershipRepository,
    clock,
  );
  const listTasksUseCase = new ListTasksUseCase(
    taskListPort,
    projectRepository,
    membershipRepository,
  );
  const updateTaskUseCase = new UpdateTaskUseCase(
    taskUpdatePort,
    projectRepository,
    membershipRepository,
    clock,
  );
  const moveTaskUseCase = new MoveTaskUseCase(
    taskMovePort,
    projectRepository,
    membershipRepository,
    clock,
  );

  // Aplicar middleware de autenticación de desarrollo a todas las rutas de este router
  router.use('*', createDevAuthMiddleware({ nodeEnv: options.nodeEnv }));

  /**
   * GET /:projectId/tasks — Listado paginado y filtrado de tareas del proyecto
   * Filtros disponibles: columnId, priority, assigneeId, label, search.
   * Paginación: page (default 1), limit (default 20, max 100).
   * Respuestas: 200, 400, 401, 404, 405, 500
   */
  router.get('/:projectId/tasks', async (c) => {
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

    const queryObj = c.req.query();
    const parseQuery = ListTasksQuerySchema.safeParse(queryObj);
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
      const result = await listTasksUseCase.execute({
        projectId: parseProjectId.data,
        requesterId: user.userId,
        page: parseQuery.data.page,
        limit: parseQuery.data.limit,
        columnId: parseQuery.data.columnId,
        priority: parseQuery.data.priority,
        assigneeId: parseQuery.data.assigneeId,
        label: parseQuery.data.label,
        search: parseQuery.data.search,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * POST /:projectId/tasks — Crear una nueva tarea en una columna del tablero
   * Valida datos con CreateTaskSchema y elegibilidad activa de asignados.
   * Emite auditoría CREATED.
   * Respuestas: 201, 400, 401, 404, 405, 500
   */
  router.post('/:projectId/tasks', async (c) => {
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

    const unknownCreateField = findUnknownField(
      rawBody as Record<string, unknown>,
      KNOWN_CREATE_TASK_FIELDS,
    );
    if (unknownCreateField !== undefined) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: `El campo '${unknownCreateField}' no está permitido en la creación de tarea`,
        },
        400,
      );
    }

    const parseBody = CreateTaskSchema.safeParse(rawBody);
    if (!parseBody.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los datos de la tarea',
          details: parseBody.error.issues,
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const task = await createTaskUseCase.execute({
        projectId: parseProjectId.data,
        requesterId: user.userId,
        columnId: parseBody.data.columnId,
        title: parseBody.data.title,
        description: parseBody.data.description,
        priority: parseBody.data.priority,
        dueDate: parseBody.data.dueDate,
        labels: parseBody.data.labels,
        assigneeIds: parseBody.data.assigneeIds,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(task, 201);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * POST /:projectId/tasks/:taskId/move — Mover una tarea a otra columna o posición
   * Clampea índices superiores al final de la columna destino.
   * Operación idempotente si la posición no cambia. Emite auditoría MOVED.
   * Respuestas: 200, 400, 401, 404, 405, 500
   */
  router.post('/:projectId/tasks/:taskId/move', async (c) => {
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

    const rawTaskId = c.req.param('taskId');
    const parseTaskId = UuidSchema.safeParse(rawTaskId);
    if (!parseTaskId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de tarea debe ser un UUID valido',
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

    const unknownMoveField = findUnknownField(
      rawBody as Record<string, unknown>,
      KNOWN_MOVE_TASK_FIELDS,
    );
    if (unknownMoveField !== undefined) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: `El campo '${unknownMoveField}' no está permitido en el movimiento de tarea`,
        },
        400,
      );
    }

    const parseBody = MoveTaskSchema.safeParse(rawBody);
    if (!parseBody.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los datos de movimiento de la tarea',
          details: parseBody.error.issues,
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const result = await moveTaskUseCase.execute({
        projectId: parseProjectId.data,
        taskId: parseTaskId.data,
        destinationColumnId: parseBody.data.destinationColumnId,
        destinationIndex: parseBody.data.destinationIndex,
        requestingUserId: user.userId,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result.task, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  /**
   * PATCH /:projectId/tasks/:taskId — Actualizar campos editables de una tarea
   * Soporta actualización parcial y semántica de vaciado.
   * Rechaza estrictamente la inclusión de campos protegidos o de movimiento con 400 Bad Request.
   * Emite auditoría UPDATED.
   * Respuestas: 200, 400, 401, 404, 405, 500
   */
  router.patch('/:projectId/tasks/:taskId', async (c) => {
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

    const rawTaskId = c.req.param('taskId');
    const parseTaskId = UuidSchema.safeParse(rawTaskId);
    if (!parseTaskId.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'El identificador de tarea debe ser un UUID valido',
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

    // Rechazar con 400 campos protegidos de identidad o movimiento antes de que Zod los descarte
    const bodyRecord = rawBody as Record<string, unknown>;
    for (const field of PROTECTED_TASK_FIELDS) {
      if (field in bodyRecord) {
        c.header('Cache-Control', 'no-store');
        return c.json(
          {
            error: 'Bad Request',
            message: `No se permite modificar campos protegidos o de movimiento mediante la actualización de tarea (${field})`,
          },
          400,
        );
      }
    }

    const unknownUpdateField = findUnknownField(bodyRecord, KNOWN_UPDATE_TASK_FIELDS);
    if (unknownUpdateField !== undefined) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: `El campo '${unknownUpdateField}' no está permitido en la actualización de tarea`,
        },
        400,
      );
    }

    const parseBody = UpdateTaskSchema.safeParse(rawBody);
    if (!parseBody.success) {
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          error: 'Bad Request',
          message: 'Error de validación en los datos de la tarea',
          details: parseBody.error.issues,
        },
        400,
      );
    }

    const user = c.get('user');

    try {
      const result = await updateTaskUseCase.execute({
        projectId: parseProjectId.data,
        taskId: parseTaskId.data,
        requesterId: user.userId,
        title: parseBody.data.title,
        description: parseBody.data.description,
        priority: parseBody.data.priority,
        dueDate: parseBody.data.dueDate,
        labels: parseBody.data.labels,
        assigneeIds: parseBody.data.assigneeIds,
      });
      c.header('Cache-Control', 'no-store');
      return c.json(result.task, 200);
    } catch (err) {
      return handleUseCaseError(err, c);
    }
  });

  // ── Manejo de métodos no permitidos (405 Method Not Allowed) ──────────────────────────
  // LIMITACIÓN PENDIENTE: El preflight CORS (OPTIONS) no está implementado en este enrutador.
  // Peticiones OPTIONS no coinciden con los handlers POST/GET/PATCH y pasan al manejador .all(),
  // que las deja pasar con next(). El soporte completo de CORS queda como trabajo futuro.
  router.all('/:projectId/tasks/:taskId/move', (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    c.header('Allow', 'POST');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  router.all('/:projectId/tasks/:taskId', (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    c.header('Allow', 'PATCH');
    c.header('Cache-Control', 'no-store');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  router.all('/:projectId/tasks', (c, next) => {
    if (c.req.method === 'OPTIONS') {
      return next();
    }
    c.header('Allow', 'GET, POST');
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
