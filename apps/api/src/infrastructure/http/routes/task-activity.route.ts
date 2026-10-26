import { Hono } from 'hono';
import { z } from 'zod';
import { TaskActivityListResponseSchema } from '@is488/shared';
import type { GetTaskActivityUseCase } from '../../../application/use-cases/get-task-activity.use-case.js';
import { createDevAuthMiddleware } from '../middleware/dev-auth.middleware.js';

export function createTaskActivityRouter(useCase: GetTaskActivityUseCase, nodeEnv?: string) {
  const router = new Hono();
  router.use('*', createDevAuthMiddleware({ nodeEnv }));
  router.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  });
  router.get('/:projectId/tasks/:taskId/activity', async (c) => {
    const params = z
      .object({ projectId: z.string().uuid(), taskId: z.string().uuid() })
      .safeParse(c.req.param());
    if (!params.success)
      return c.json({ error: 'Bad Request', message: 'Identificadores inválidos' }, 400);
    try {
      const events = await useCase.execute({ ...params.data, requesterId: c.get('user').userId });
      return c.json(TaskActivityListResponseSchema.parse(events), 200);
    } catch (err) {
      if (err instanceof Error && 'statusCode' in err && err.statusCode === 404)
        return c.json({ error: 'Not Found', message: 'Recurso no encontrado' }, 404);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });
  router.all('/:projectId/tasks/:taskId/activity', (c) => {
    c.header('Allow', 'GET');
    return c.json({ error: 'Method Not Allowed' }, 405);
  });
  return router;
}
