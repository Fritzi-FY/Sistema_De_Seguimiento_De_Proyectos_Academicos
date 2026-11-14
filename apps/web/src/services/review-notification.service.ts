import {
  ListReviewNotificationsQuerySchema,
  ReviewNotificationListResponseSchema,
  type ReviewNotificationListResponse,
} from '@is488/shared';
import { apiFetch, buildHeaders } from './api-client.js';

export interface ReviewNotificationQuery {
  limit?: number;
  cursor?: string;
}

export class ReviewNotificationFetchError extends Error {
  constructor(readonly status?: number) {
    super(
      status === 401
        ? 'La sesión terminó. Vuelve a iniciar sesión.'
        : status === 403
          ? 'Esta bandeja está disponible solo para estudiantes.'
          : 'No se pudieron consultar las notificaciones. Vuelve a intentarlo.',
    );
    this.name = 'ReviewNotificationFetchError';
  }
}

export async function getReviewNotifications(
  query: ReviewNotificationQuery = {},
  options?: { signal?: AbortSignal },
): Promise<ReviewNotificationListResponse> {
  const parsed = ListReviewNotificationsQuerySchema.safeParse(query);
  if (!parsed.success) throw new ReviewNotificationFetchError(400);
  const params = new URLSearchParams({ limit: String(parsed.data.limit) });
  if (parsed.data.cursor !== undefined) params.set('cursor', parsed.data.cursor);
  const response = await apiFetch('/api/review-notifications?' + params.toString(), {
    method: 'GET',
    headers: buildHeaders(),
    cache: 'no-store',
    signal: options?.signal,
  });
  if (!response.ok) throw new ReviewNotificationFetchError(response.status);
  try {
    return ReviewNotificationListResponseSchema.parse(await response.json());
  } catch {
    throw new ReviewNotificationFetchError();
  }
}
