import { Hono } from 'hono';
import { ReviewNotificationListResponseSchema } from '@is488/shared';
import type { ListStudentReviewNotificationsUseCase } from '../../../application/use-cases/list-student-review-notifications.use-case.js';
import type { AuthMiddleware } from '../middleware/auth.middleware.js';

export function createReviewNotificationsRouter(
  useCase: ListStudentReviewNotificationsUseCase,
  authentication: AuthMiddleware,
) {
  const router = new Hono();
  router.use('*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    await next();
  });
  router.use('*', authentication);
  router.get('/', async (context) => {
    try {
      const result = await useCase.execute({
        session: context.get('user'),
        query: Object.fromEntries(
          Object.entries(context.req.queries()).map(([name, values]) => [
            name,
            values.length === 1 ? values[0] : values,
          ]),
        ),
      });
      return context.json(ReviewNotificationListResponseSchema.parse(result), 200);
    } catch (error) {
      const status = (error as { statusCode?: number } | null)?.statusCode;
      if (status === 400) return context.json({ error: 'Bad Request' }, 400);
      if (status === 403) return context.json({ error: 'Forbidden' }, 403);
      return context.json({ error: 'Internal Server Error' }, 500);
    }
  });
  return router;
}
