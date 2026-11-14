import { useCallback, useEffect, useRef, useState } from 'react';
import type { CurrentUser, ReviewNotificationListResponse } from '@is488/shared';
import {
  getReviewNotifications,
  ReviewNotificationFetchError,
  type ReviewNotificationQuery,
} from '../services/review-notification.service.js';

export type ReviewNotificationFetcher = (
  query: ReviewNotificationQuery,
  options?: { signal?: AbortSignal },
) => Promise<ReviewNotificationListResponse>;

type InboxState =
  | { status: 'loading' }
  | { status: 'error'; denied: boolean; message: string }
  | { status: 'success'; page: ReviewNotificationListResponse };

const button =
  'min-h-11 rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-unsch-garnet disabled:opacity-50';

export function ReviewNotificationInbox({
  user,
  fetcher = getReviewNotifications,
}: {
  user: Pick<CurrentUser, 'userId' | 'role'>;
  fetcher?: ReviewNotificationFetcher;
}) {
  if (user.role !== 'student') return null;
  return <Inbox key={`${user.userId}/${user.role}`} fetcher={fetcher} />;
}

function Inbox({ fetcher }: { fetcher: ReviewNotificationFetcher }) {
  const [state, setState] = useState<InboxState>({ status: 'loading' });
  const generation = useRef(0);
  const controller = useRef<AbortController>();
  const requestedCursor = useRef<string>();
  const denied = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  const focusAfterLoad = useRef(false);

  useEffect(() => {
    if (state.status !== 'loading' && focusAfterLoad.current) {
      focusAfterLoad.current = false;
      title.current?.focus();
    }
  }, [state]);

  const load = useCallback(
    (cursor?: string) => {
      const version = ++generation.current;
      controller.current?.abort();
      const request = new AbortController();
      controller.current = request;
      requestedCursor.current = cursor;
      setState({ status: 'loading' });
      void (async () => {
        try {
          const page = await fetcher({ limit: 20, cursor }, { signal: request.signal });
          if (version === generation.current && !request.signal.aborted) {
            denied.current = false;
            setState({ status: 'success', page });
          }
        } catch (error) {
          if (version !== generation.current || request.signal.aborted) return;
          const status = error instanceof ReviewNotificationFetchError ? error.status : undefined;
          denied.current = status === 401 || status === 403;
          if (denied.current) requestedCursor.current = undefined;
          setState({
            status: 'error',
            denied: denied.current,
            message:
              error instanceof ReviewNotificationFetchError
                ? error.message
                : 'No se pudieron consultar las notificaciones. Vuelve a intentarlo.',
          });
        }
      })();
    },
    [fetcher],
  );

  useEffect(() => {
    load();
    const refresh = () => {
      if (!denied.current) load();
    };
    const clear = () => {
      generation.current++;
      controller.current?.abort();
      requestedCursor.current = undefined;
      denied.current = true;
      setState({
        status: 'error',
        denied: true,
        message: 'La sesión terminó. Vuelve a iniciar sesión.',
      });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('identity:unauthorized', clear);
    return () => {
      generation.current++;
      controller.current?.abort();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('identity:unauthorized', clear);
    };
  }, [load]);

  return (
    <section
      aria-labelledby="review-inbox-title"
      aria-busy={state.status === 'loading'}
      className="min-w-0 space-y-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2
            id="review-inbox-title"
            ref={title}
            tabIndex={-1}
            className="text-xl font-bold text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet"
          >
            Notificaciones de revisión
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Respuestas docentes de tus proyectos con acceso vigente.
          </p>
        </div>
        <button
          type="button"
          className={button}
          disabled={state.status === 'loading' || (state.status === 'error' && state.denied)}
          onClick={() => load()}
        >
          Actualizar notificaciones
        </button>
      </div>
      {state.status === 'loading' && <p role="status">Cargando notificaciones...</p>}
      {state.status === 'error' && (
        <div role="alert" className="space-y-3 text-sm text-slate-800">
          <p>{state.message}</p>
          {!state.denied && (
            <button type="button" className={button} onClick={() => load(requestedCursor.current)}>
              Reintentar notificaciones
            </button>
          )}
        </div>
      )}
      {state.status === 'success' && (
        <>
          <p role="status" className="text-sm text-slate-600">
            {state.page.items.length === 0
              ? 'No hay notificaciones de revisión disponibles.'
              : `${state.page.items.length} notificaciones en esta página.`}
          </p>
          {state.page.items.length > 0 && (
            <ol aria-label="Respuestas docentes" className="divide-y divide-slate-200">
              {state.page.items.map((item) => (
                <li key={item.id} className="min-w-0 space-y-2 py-4">
                  <h3 className="font-semibold text-slate-900">
                    {item.status === 'APPROVED' ? 'Revisión aprobada' : 'Cambios solicitados'}
                  </h3>
                  <time className="text-sm text-slate-700" dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString('es-PE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'UTC',
                    })}{' '}
                    (UTC)
                  </time>
                  <dl className="space-y-1 text-sm text-slate-600">
                    <div>
                      <dt className="font-medium">Proyecto</dt>
                      <dd className="break-all">{item.projectId}</dd>
                    </div>
                    <div>
                      <dt className="font-medium">Revisión</dt>
                      <dd className="break-all">{item.reviewId}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ol>
          )}
          {state.page.nextCursor !== null && (
            <button
              type="button"
              className={button}
              onClick={() => {
                focusAfterLoad.current = true;
                load(state.page.nextCursor!);
              }}
            >
              Siguiente
            </button>
          )}
        </>
      )}
      <p className="text-xs text-slate-600">
        Se muestra una página a la vez. Al cargar otra página o actualizar se vuelve a comprobar el
        acceso.
      </p>
    </section>
  );
}
