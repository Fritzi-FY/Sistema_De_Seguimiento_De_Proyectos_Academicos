import {
  PostgresqlBoardRepository,
  PostgresqlTaskRepository,
  PostgresqlTaskActivityRepository,
} from '../postgresql/kanban.repositories.js';
import {
  PostgresqlTaskCreationAdapter,
  PostgresqlTaskUpdateAdapter,
  PostgresqlTaskMoveAdapter,
  PostgresqlBoardColumnDeletionAdapter,
} from '../postgresql/kanban.transactions.js';
import { PostgresqlTaskListAdapter } from '../postgresql/kanban-list.adapter.js';
import type { AuthMiddleware } from './middleware/auth.middleware.js';
import { createDevAuthMiddleware } from './middleware/dev-auth.middleware.js';
import { createAccessAuth, type AccessProfile } from './middleware/access-auth.middleware.js';
import { InMemoryTeacherProjectScopeAdapter } from '../adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { PostgresqlTeacherProjectScopeAdapter } from '../postgresql/teacher-project-scope.adapter.js';
import type { TeacherProjectScopePort } from '@is488/shared';
import type { ClientConfig } from 'pg';
import { SqlSession, sqlRequestScope } from '../postgresql/session.js';
import {
  PostgresqlProjectRepository,
  PostgresqlMembershipRepository,
  PostgresqlProjectCreationAdapter,
} from '../postgresql/repositories.js';
import { Hono } from 'hono';
import type {
  SystemClockPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  ProjectCreationPort,
  BoardRepositoryPort,
  BoardColumnDeletionPort,
  TaskCreationPort,
  TaskUpdatePort,
  TaskMovePort,
  TaskListPort,
  TaskRepositoryPort,
  TaskActivityRepositoryPort,
} from '@is488/shared';
import type { Project, ProjectMembership } from '@is488/shared';
import { SystemClock } from '../adapters/clock/system-clock.adapter.js';
import { InMemoryProjectRepository } from '../adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryProjectCreationAdapter } from '../adapters/repositories/in-memory-project-creation.adapter.js';
import { InMemoryKanbanProjectStorage } from '../adapters/repositories/in-memory-kanban-project.storage.js';
import { InMemoryBoardRepository } from '../adapters/repositories/in-memory-board.repository.js';
import { InMemoryBoardColumnDeletionAdapter } from '../adapters/repositories/in-memory-board-column-deletion.adapter.js';
import { InMemoryTaskCreationAdapter } from '../adapters/repositories/in-memory-task-creation.adapter.js';
import { InMemoryTaskUpdateAdapter } from '../adapters/repositories/in-memory-task-update.adapter.js';
import { InMemoryTaskMoveAdapter } from '../adapters/repositories/in-memory-task-move.adapter.js';
import { InMemoryTaskListAdapter } from '../adapters/repositories/in-memory-task-list.adapter.js';
import { createHealthRouter } from './routes/health.route.js';
import { createProjectsRouter } from './routes/projects.route.js';
import { createProjectMembersRouter } from './routes/project-members.route.js';
import { createBoardRouter } from './routes/board.route.js';
import { createTasksRouter } from './routes/tasks.route.js';
import { openApiSpec } from '../openapi/openapi.contract.js';
import { InMemoryTaskRepository } from '../adapters/repositories/in-memory-task.repository.js';
import { InMemoryTaskActivityRepository } from '../adapters/repositories/in-memory-task-activity.repository.js';
import { GetTaskActivityUseCase } from '../../application/use-cases/get-task-activity.use-case.js';
import { createTaskActivityRouter } from './routes/task-activity.route.js';

export interface AppOptions {
  authentication?: AuthMiddleware;
  remoteValidation?: 'A' | 'B';
  teacherProjectScope?: TeacherProjectScopePort;
  persistence?: { mode: 'memory' } | { mode: 'postgres'; connection: ClientConfig };
  persistenceFromEnvironment?: boolean;
  clock?: SystemClockPort;
  projectRepository?: ProjectRepositoryPort;
  membershipRepository?: MembershipRepositoryPort;
  projectCreationPort?: ProjectCreationPort;
  kanbanStorage?: InMemoryKanbanProjectStorage;
  boardRepository?: BoardRepositoryPort;
  boardColumnDeletionPort?: BoardColumnDeletionPort;
  taskCreationPort?: TaskCreationPort;
  taskUpdatePort?: TaskUpdatePort;
  taskMovePort?: TaskMovePort;
  taskListPort?: TaskListPort;
  taskRepository?: TaskRepositoryPort;
  taskActivityRepository?: TaskActivityRepositoryPort;
  version?: string;
  nodeEnv?: string;
}

/**
 * Fábrica de la aplicación Hono.
 * Permite inyectar dependencias para pruebas de integración independientes en memoria.
 *
 * PATRÓN B.1 — Composición compartida de Map:
 * Se crean exactamente UNA instancia de projectMap y UNA de membershipMap. Estas
 * referencias se inyectan en los repositorios individuales Y en el adaptador de creación
 * coordinada. Esta unicidad garantiza que las escrituras de InMemoryProjectCreationAdapter
 * sean visibles de forma inmediata a través de los repositorios individuales.
 *
 * PATRÓN B.2 — Storage Kanban único compartido por aplicación:
 * Se crea exactamente UNA instancia de InMemoryKanbanProjectStorage por instancia de createApp().
 * Esta instancia se inyecta en InMemoryBoardRepository, InMemoryBoardColumnDeletionAdapter,
 * InMemoryTaskCreationAdapter, InMemoryTaskUpdateAdapter, InMemoryTaskMoveAdapter e InMemoryTaskListAdapter.
 * Distintas instancias de createApp() NO comparten estado Kanban por defecto.
 */
export function createApp(options: AppOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const version = options.version ?? '0.1.0';
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  // ── UNA SOLA instancia de cada Map (Patrón B.1) ──────────────────────────────────────
  const projectMap = new Map<string, Project>();
  const membershipMap = new Map<string, ProjectMembership>();

  // ── Repositorios individuales: reciben la misma referencia de Map ─────────────────────
  if (
    (options.persistence?.mode === 'postgres' || options.persistenceFromEnvironment) &&
    (options.projectRepository ||
      options.membershipRepository ||
      options.projectCreationPort ||
      options.teacherProjectScope)
  ) {
    throw new Error('SQL persistence requires joint composition of all three ports');
  }
  function selectPort<T extends object>(memory: T, sql: T): T {
    return new Proxy(memory, {
      get(_target, property) {
        const scope = sqlRequestScope.getStore();
        if (scope === undefined) throw new Error('Persistence request scope required');
        const target = scope ? sql : memory;
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
  const projectRepository = selectPort<ProjectRepositoryPort>(
    options.projectRepository ?? new InMemoryProjectRepository(projectMap),
    new PostgresqlProjectRepository(),
  );

  const membershipRepository = selectPort<MembershipRepositoryPort>(
    options.membershipRepository ?? new InMemoryMembershipRepository(membershipMap),
    new PostgresqlMembershipRepository(),
  );

  // ── Adaptador de creación coordinada: recibe las mismas referencias de Map ────────────
  const projectCreationPort = selectPort<ProjectCreationPort>(
    options.projectCreationPort ?? new InMemoryProjectCreationAdapter(projectMap, membershipMap),
    new PostgresqlProjectCreationAdapter(),
  );

  // ── Dominio Kanban: UNA SOLA instancia compartida por app (Patrón B.2) ────────────────
  const kanbanStorage = options.kanbanStorage ?? new InMemoryKanbanProjectStorage();
  const boardRepository = selectPort<BoardRepositoryPort>(
    options.boardRepository ?? new InMemoryBoardRepository(kanbanStorage),
    new PostgresqlBoardRepository(),
  );
  const boardColumnDeletionPort = selectPort<BoardColumnDeletionPort>(
    options.boardColumnDeletionPort ?? new InMemoryBoardColumnDeletionAdapter(kanbanStorage),
    new PostgresqlBoardColumnDeletionAdapter(),
  );
  const taskCreationPort = selectPort<TaskCreationPort>(
    options.taskCreationPort ?? new InMemoryTaskCreationAdapter(kanbanStorage),
    new PostgresqlTaskCreationAdapter(),
  );
  const taskUpdatePort = selectPort<TaskUpdatePort>(
    options.taskUpdatePort ?? new InMemoryTaskUpdateAdapter(kanbanStorage),
    new PostgresqlTaskUpdateAdapter(),
  );
  const taskMovePort = selectPort<TaskMovePort>(
    options.taskMovePort ?? new InMemoryTaskMoveAdapter(kanbanStorage),
    new PostgresqlTaskMoveAdapter(),
  );
  const taskListPort = selectPort<TaskListPort>(
    options.taskListPort ?? new InMemoryTaskListAdapter(kanbanStorage),
    new PostgresqlTaskListAdapter(),
  );

  const teacherScope = selectPort<TeacherProjectScopePort>(
    options.teacherProjectScope ?? new InMemoryTeacherProjectScopeAdapter(),
    new PostgresqlTeacherProjectScopeAdapter(),
  );
  const app = new Hono();
  const localAuth = createDevAuthMiddleware({ nodeEnv });
  const routerAuth: AuthMiddleware = async (c, next) =>
    c.get('user') ? next() : localAuth(c, next);
  let accessCache: { key: string; auth: AuthMiddleware } | undefined;
  app.use('*', async (c, next) => {
    const env = c.env as Record<string, unknown> | undefined;
    const deployment = options.remoteValidation ?? env?.VALIDATION_DEPLOYMENT;
    if (deployment) {
      if (deployment !== 'A' && deployment !== 'B')
        return c.json({ error: 'Validation configuration required' }, 503);
      if ([...c.req.raw.headers.keys()].some((k) => k.toLowerCase().startsWith('x-dev-')))
        return c.json({ error: 'Unauthorized' }, 401);
      const path = c.req.path;
      const method = c.req.method;
      const allowed =
        (method === 'GET' && path === '/api/health') ||
        (['GET', 'POST'].includes(method) && path === '/api/projects') ||
        (method === 'GET' && /^\/api\/projects\/[^/]+$/.test(path)) ||
        (['GET', 'POST'].includes(method) && /^\/api\/projects\/[^/]+\/members$/.test(path)) ||
        (method === 'DELETE' && /^\/api\/projects\/[^/]+\/members\/[^/]+$/.test(path));
      if (!allowed) return c.json({ error: 'Not Found' }, 404);
      let auth = options.authentication;
      if (!auth) {
        try {
          const key = JSON.stringify([
            env?.ACCESS_ISSUER,
            env?.ACCESS_AUDIENCE,
            env?.ACCESS_SYNTHETIC_ACTORS,
          ]);
          if (accessCache?.key !== key)
            accessCache = {
              key,
              auth: createAccessAuth({
                issuer: String(env?.ACCESS_ISSUER ?? ''),
                audience: String(env?.ACCESS_AUDIENCE ?? ''),
                actors: JSON.parse(String(env?.ACCESS_SYNTHETIC_ACTORS ?? '')),
              } as AccessProfile),
            };
          auth = accessCache.auth;
        } catch {
          return c.json({ error: 'Validation configuration required' }, 503);
        }
      }
      return auth(c, async () => {
        if (!c.get('user')) {
          c.res = c.json({ error: 'Unauthorized' }, 401);
          return;
        }
        if (
          env?.PERSISTENCE_MODE !== 'postgres' ||
          !(env?.HYPERDRIVE as { connectionString?: string } | undefined)?.connectionString
        ) {
          c.res = c.json({ error: 'Validation configuration required' }, 503);
          return;
        }
        c.header('Cache-Control', 'private, no-store');
        c.header('X-Validation-Deployment', String(deployment));
        await next();
      });
    }
    if (options.authentication) return options.authentication(c, next);
    await next();
  });

  app.use('*', async (c, next) => {
    const env = (c.env ?? {}) as {
      VALIDATION_DEPLOYMENT?: string;
      PERSISTENCE_MODE?: string;
      DATABASE_URL?: string;
      HYPERDRIVE?: { connectionString: string };
    };
    const remote = !!(options.remoteValidation || env.VALIDATION_DEPLOYMENT);
    const mode = remote
      ? 'postgres'
      : (options.persistence?.mode ??
        (options.persistenceFromEnvironment ? (env.PERSISTENCE_MODE ?? 'memory') : 'memory'));
    if (mode === 'memory') return sqlRequestScope.run(null, next);
    if (mode !== 'postgres') throw new Error('Invalid persistence mode');
    let connection: ClientConfig;
    if (remote) {
      if (!env.HYPERDRIVE?.connectionString) throw new Error('Validation binding required');
      connection = { connectionString: env.HYPERDRIVE.connectionString };
    } else if (options.persistence?.mode === 'postgres')
      connection = options.persistence.connection;
    else if (env.HYPERDRIVE?.connectionString)
      connection = { connectionString: env.HYPERDRIVE.connectionString };
    else {
      if (!env.DATABASE_URL || !['development', 'test'].includes(nodeEnv ?? ''))
        throw new Error('SQL configuration required');
      const url = new URL(env.DATABASE_URL);
      if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
        throw new Error('Local SQL connection required');
      connection = { connectionString: env.DATABASE_URL };
    }
    const session = new SqlSession(connection, () => c.get('user')?.userId);
    return sqlRequestScope.run(session, async () => {
      try {
        await next();
      } finally {
        if (!(await session.close())) c.header('X-Persistence-Close', 'unconfirmed');
      }
    });
  });

  // Manejo de errores global: nunca divulga stack traces internos ni variables de entorno
  app.onError((_err, c) => {
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  // Montar endpoint técnico de diagnóstico en /api/health
  app.route('/api/health', createHealthRouter(clock, version));

  // Montar endpoint de proyectos en /api/projects
  app.route(
    '/api/projects',
    createProjectsRouter(projectRepository, projectCreationPort, membershipRepository, clock, {
      nodeEnv,
      authentication: routerAuth,
      teacherScope,
    }),
  );

  // Montar enrutador de miembros bajo /api/projects
  app.route(
    '/api/projects',
    createProjectMembersRouter(membershipRepository, projectRepository, clock, {
      nodeEnv,
      authentication: routerAuth,
    }),
  );

  // Montar enrutador de tablero y columnas bajo /api/projects
  app.route(
    '/api/projects',
    createBoardRouter(
      boardRepository,
      boardColumnDeletionPort,
      projectRepository,
      membershipRepository,
      clock,
      { nodeEnv, authentication: routerAuth },
    ),
  );

  // Montar enrutador de tareas bajo /api/projects
  app.route(
    '/api/projects',
    createTasksRouter(
      taskCreationPort,
      taskListPort,
      taskUpdatePort,
      taskMovePort,
      projectRepository,
      membershipRepository,
      clock,
      { nodeEnv, authentication: routerAuth },
    ),
  );

  // Exponer contrato OpenAPI para clientes y herramientas de documentación
  app.route(
    '/api/projects',
    createTaskActivityRouter(
      new GetTaskActivityUseCase(
        projectRepository,
        membershipRepository,
        selectPort<TaskRepositoryPort>(
          options.taskRepository ?? new InMemoryTaskRepository(kanbanStorage),
          new PostgresqlTaskRepository(),
        ),
        selectPort<TaskActivityRepositoryPort>(
          options.taskActivityRepository ?? new InMemoryTaskActivityRepository(kanbanStorage),
          new PostgresqlTaskActivityRepository(),
        ),
      ),
      nodeEnv,
      routerAuth,
    ),
  );

  app.get('/api/openapi.json', (c) => {
    return c.json(openApiSpec, 200);
  });

  return app;
}

/**
 * Instancia predeterminada de la aplicación Hono con dependencias de producción.
 */
export const app = createApp({ persistenceFromEnvironment: true });
