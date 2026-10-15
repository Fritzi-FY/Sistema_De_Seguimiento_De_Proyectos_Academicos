import { Hono } from 'hono';
import type {
  SystemClockPort,
  ProjectRepositoryPort,
  MembershipRepositoryPort,
  ProjectCreationPort,
} from '@is488/shared';
import type { Project, ProjectMembership } from '@is488/shared';
import { SystemClock } from '../adapters/clock/system-clock.adapter.js';
import { InMemoryProjectRepository } from '../adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryProjectCreationAdapter } from '../adapters/repositories/in-memory-project-creation.adapter.js';
import { createHealthRouter } from './routes/health.route.js';
import { createProjectsRouter } from './routes/projects.route.js';
import { createProjectMembersRouter } from './routes/project-members.route.js';
import { openApiSpec } from '../openapi/openapi.contract.js';

export interface AppOptions {
  clock?: SystemClockPort;
  projectRepository?: ProjectRepositoryPort;
  membershipRepository?: MembershipRepositoryPort;
  projectCreationPort?: ProjectCreationPort;
  version?: string;
  nodeEnv?: string;
}

/**
 * Fábrica de la aplicación Hono.
 * Permite inyectar dependencias para pruebas de integración independientes en memoria.
 *
 * PATRÓN B.1 — Composición compartida de Map:
 * Se crean exactamente UNA instancia de `projectMap` y UNA de `membershipMap`. Estas
 * referencias se inyectan en los repositorios individuales Y en el adaptador de creación
 * coordinada. Esta unicidad garantiza que las escrituras de `InMemoryProjectCreationAdapter`
 * sean visibles de forma inmediata a través de los repositorios individuales.
 */
export function createApp(options: AppOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const version = options.version ?? '0.1.0';
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  // ── UNA SOLA instancia de cada Map (Patrón B.1) ──────────────────────────────────────
  const projectMap = new Map<string, Project>();
  const membershipMap = new Map<string, ProjectMembership>();

  // ── Repositorios individuales: reciben la misma referencia de Map ─────────────────────
  const projectRepository = options.projectRepository ?? new InMemoryProjectRepository(projectMap);

  const membershipRepository =
    options.membershipRepository ?? new InMemoryMembershipRepository(membershipMap);

  // ── Adaptador de creación coordinada: recibe las mismas referencias de Map ────────────
  const projectCreationPort =
    options.projectCreationPort ?? new InMemoryProjectCreationAdapter(projectMap, membershipMap);

  const app = new Hono();

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
    createProjectMembersRouter(membershipRepository, projectRepository, clock, { nodeEnv }),
  );

  // Exponer contrato OpenAPI para clientes y herramientas de documentación
  app.get('/api/openapi.json', (c) => {
    return c.json(openApiSpec, 200);
  });

  return app;
}

/**
 * Instancia predeterminada de la aplicación Hono con dependencias de producción.
 */
export const app = createApp();
