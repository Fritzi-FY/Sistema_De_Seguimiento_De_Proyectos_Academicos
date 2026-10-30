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
    (options.projectRepository || options.membershipRepository || options.projectCreationPort)
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
  const boardRepository = options.boardRepository ?? new InMemoryBoardRepository(kanbanStorage);
  const boardColumnDeletionPort =
    options.boardColumnDeletionPort ?? new InMemoryBoardColumnDeletionAdapter(kanbanStorage);
  const taskCreationPort =
    options.taskCreationPort ?? new InMemoryTaskCreationAdapter(kanbanStorage);
  const taskUpdatePort = options.taskUpdatePort ?? new InMemoryTaskUpdateAdapter(kanbanStorage);
  const taskMovePort = options.taskMovePort ?? new InMemoryTaskMoveAdapter(kanbanStorage);
  const taskListPort = options.taskListPort ?? new InMemoryTaskListAdapter(kanbanStorage);

  const app = new Hono();
  app.use('*', async (c, next) => {
    const env = (c.env ?? {}) as {
      PERSISTENCE_MODE?: string;
      DATABASE_URL?: string;
      HYPERDRIVE?: { connectionString: string };
    };
    const mode =
      options.persistence?.mode ??
      (options.persistenceFromEnvironment ? (env.PERSISTENCE_MODE ?? 'memory') : 'memory');
    if (mode === 'memory') return sqlRequestScope.run(null, next);
    if (mode !== 'postgres') throw new Error('Invalid persistence mode');
    let connection: ClientConfig;
    if (options.persistence?.mode === 'postgres') connection = options.persistence.connection;
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
    const session = new SqlSession(connection);
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
    }),
  );

  // Montar enrutador de miembros bajo /api/projects
  app.route(
    '/api/projects',
    createProjectMembersRouter(membershipRepository, projectRepository, clock, {
      nodeEnv,
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
      { nodeEnv },
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
      { nodeEnv },
    ),
  );

  // Exponer contrato OpenAPI para clientes y herramientas de documentación
  app.route(
    '/api/projects',
    createTaskActivityRouter(
      new GetTaskActivityUseCase(
        projectRepository,
        membershipRepository,
        options.taskRepository ?? new InMemoryTaskRepository(kanbanStorage),
        options.taskActivityRepository ?? new InMemoryTaskActivityRepository(kanbanStorage),
      ),
      nodeEnv,
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
