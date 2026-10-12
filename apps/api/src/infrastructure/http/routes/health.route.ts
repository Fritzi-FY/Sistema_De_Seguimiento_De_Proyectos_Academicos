import { Hono } from 'hono';
import type { SystemClockPort } from '@is488/shared';
import { GetSystemHealthUseCase } from '../../../application/use-cases/get-system-health.use-case.js';

/**
 * Crea el enrutador de salud (/api/health) con inyección del reloj del sistema.
 */
export function createHealthRouter(clock: SystemClockPort, version: string = '0.1.0') {
  const router = new Hono();
  const useCase = new GetSystemHealthUseCase(clock, version);

  // Manejador para GET /api/health
  router.get('/', (c) => {
    const data = useCase.execute();
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.json(data, 200);
  });

  // Manejador estricto de métodos HTTP no soportados (405 Method Not Allowed)
  router.all('/', (c) => {
    c.header('Allow', 'GET');
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });

  return router;
}
