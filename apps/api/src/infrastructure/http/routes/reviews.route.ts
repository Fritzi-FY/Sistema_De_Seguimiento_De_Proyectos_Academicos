import { Hono, type Context } from 'hono';
import { z } from 'zod';
import {
  CreateReviewRequestSchema,
  RespondReviewRequestSchema,
  ResubmitReviewRequestSchema,
  ReviewRequestSummaryResponseSchema,
  ReviewDetailResponseSchema,
  InvalidReviewTransitionError,
} from '@is488/shared';
import type { AuthMiddleware } from '../middleware/auth.middleware.js';
import type { RequestTeacherReviewUseCase } from '../../../application/use-cases/request-teacher-review.use-case.js';
import type { RespondTeacherReviewUseCase } from '../../../application/use-cases/respond-teacher-review.use-case.js';
import type { ResubmitTeacherReviewUseCase } from '../../../application/use-cases/resubmit-teacher-review.use-case.js';
import type { GetTeacherReviewUseCase } from '../../../application/use-cases/get-teacher-review.use-case.js';

const identifiers = z.object({
  projectId: z.string().uuid(),
  reviewId: z.string().uuid().optional(),
});

export function createReviewsRouter(
  request: RequestTeacherReviewUseCase,
  respond: RespondTeacherReviewUseCase,
  resubmit: ResubmitTeacherReviewUseCase,
  get: GetTeacherReviewUseCase,
  authentication: AuthMiddleware,
) {
  const router = new Hono();
  router.use('*', authentication);

  function handle(work: (context: Context) => Promise<Response>) {
    return async (context: Context) => {
      try {
        return await work(context);
      } catch (error) {
        const status = (error as { statusCode?: number } | null)?.statusCode;
        if (status === 403) return context.json({ error: 'Forbidden' }, 403);
        if (status === 404) return context.json({ error: 'Not Found' }, 404);
        if (status === 409 || error instanceof InvalidReviewTransitionError)
          return context.json({ error: 'Conflict' }, 409);
        return context.json({ error: 'Internal Server Error' }, 500);
      }
    };
  }

  async function input<Schema extends z.ZodType>(context: Context, schema: Schema) {
    const params = identifiers.safeParse(context.req.param());
    const body = schema.safeParse(await context.req.json().catch(() => undefined));
    if (!params.success || !body.success) return undefined;
    return { params: params.data, body: body.data };
  }

  router.post(
    '/',
    handle(async (context) => {
      const data = await input(context, CreateReviewRequestSchema);
      if (!data) return context.json({ error: 'Bad Request' }, 400);
      const result = await request.execute({
        ...data.body,
        projectId: data.params.projectId,
        requesterId: context.get('user').userId,
      });
      return context.json(ReviewRequestSummaryResponseSchema.parse(result), 201);
    }),
  );
  router.post(
    '/:reviewId/response',
    handle(async (context) => {
      const data = await input(context, RespondReviewRequestSchema);
      if (!data || !data.params.reviewId) return context.json({ error: 'Bad Request' }, 400);
      const result = await respond.execute({
        ...data.body,
        projectId: data.params.projectId,
        reviewId: data.params.reviewId,
        user: context.get('user'),
      });
      return context.json(ReviewRequestSummaryResponseSchema.parse(result), 200);
    }),
  );
  router.post(
    '/:reviewId/re-submit',
    handle(async (context) => {
      const data = await input(context, ResubmitReviewRequestSchema);
      if (!data || !data.params.reviewId) return context.json({ error: 'Bad Request' }, 400);
      const result = await resubmit.execute({
        ...data.body,
        projectId: data.params.projectId,
        reviewId: data.params.reviewId,
        studentId: context.get('user').userId,
      });
      return context.json(ReviewRequestSummaryResponseSchema.parse(result), 200);
    }),
  );
  router.get(
    '/:reviewId',
    handle(async (context) => {
      const params = identifiers.safeParse(context.req.param());
      if (!params.success || !params.data.reviewId)
        return context.json({ error: 'Bad Request' }, 400);
      const result = await get.execute({
        projectId: params.data.projectId,
        reviewId: params.data.reviewId,
        userId: context.get('user').userId,
      });
      return context.json(
        ReviewDetailResponseSchema.parse({
          ...result.request,
          actions: result.actions,
          timeline: result.timeline,
        }),
        200,
      );
    }),
  );
  return router;
}
