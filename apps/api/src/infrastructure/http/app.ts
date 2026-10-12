import { Hono } from 'hono';
import type { SystemClockPort, ProjectRepositoryPort } from '@is488/shared';
import { SystemClock } from '../adapters/clock/system-clock.adapter.js';
import { InMemoryProjectRepository } from '../adapters/repositories/in-memory-project.repository.js';
import { createHealthRouter } from './routes/health.route.js';
import { createProjectsRouter } from './routes/projects.route.js';
import { openApiSpec } from '../openapi/openapi.contract.js';

export interface AppOptions {
  clock?: SystemClockPort;
  projectRepository?: ProjectRepositoryPort;
  version?: string;
  nodeEnv?: string;
}

/**
 * Fábrica de la aplicación Hono.
 * Permite inyectar dependencias para pruebas de integración independientes en memoria.
 */
export function createApp(options: AppOptions = {}) {
  const clock = options.clock ?? new SystemClock();
  const projectRepository = options.projectRepository ?? new InMemoryProjectRepository();
  const version = options.version ?? '0.1.0';
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV;

  const app = new Hono();

  // Manejo de errores global: nunca divulga stack traces internos ni variables de entorno
  app.onError((_err, c) => {
    return c.json({ error: 'Internal Server Error' }, 500);
  });

  // Montar endpoint técnico de diagnóstico en /api/health
  app.route('/api/health', createHealthRouter(clock, version));

  // Montar endpoint de proyectos en /api/projects
  app.route('/api/projects', createProjectsRouter(projectRepository, clock, { nodeEnv }));

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
