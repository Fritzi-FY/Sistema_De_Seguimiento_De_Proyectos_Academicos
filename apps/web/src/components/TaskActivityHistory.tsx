import { useEffect, useState } from 'react';
import type { TaskActivityListResponse } from '@is488/shared';
import { getTaskActivity } from '../services/task.service.js';

export type TaskActivityFetcher = (
  projectId: string,
  taskId: string,
  options?: { signal?: AbortSignal },
) => Promise<TaskActivityListResponse>;
const fetchActivity: TaskActivityFetcher = (projectId, taskId, options) =>
  getTaskActivity(projectId, taskId, undefined, options);
const actions = {
  CREATED: 'Creación',
  UPDATED: 'Edición',
  MOVED: 'Movimiento',
  COLUMN_DELETED_REALLOCATION: 'Reasignación por eliminación de columna',
  DELETED: 'Eliminación',
};

export function TaskActivityHistory(props: {
  projectId: string;
  taskId: string;
  fetcher?: TaskActivityFetcher;
}) {
  return <History key={`${props.projectId}/${props.taskId}`} {...props} />;
}
function History({
  projectId,
  taskId,
  fetcher = fetchActivity,
}: {
  projectId: string;
  taskId: string;
  fetcher?: TaskActivityFetcher;
}) {
  const [events, setEvents] = useState<TaskActivityListResponse>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setEvents([]);
    setError(null);
    setLoading(true);
    void (async () => {
      try {
        const result = await fetcher(projectId, taskId, { signal: controller.signal });
        if (current) setEvents(result);
      } catch (err) {
        if (current) setError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [projectId, taskId, fetcher, retry]);
  return (
    <section
      aria-label="Historial de actividad"
      className="space-y-2 text-sm text-slate-800"
      aria-busy={loading}
    >
      <h3 className="font-semibold">Historial de actividad</h3>
      {loading && <p role="status">Cargando historial...</p>}
      {error && (
        <div role="status">
          <p>No se pudo cargar el historial: {error}</p>
          <button
            type="button"
            onClick={() => setRetry((value) => value + 1)}
            className="min-h-11 rounded-lg border border-slate-400 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet"
          >
            Reintentar historial
          </button>
        </div>
      )}
      {!loading &&
        !error &&
        (events.length === 0 ? (
          <p role="status">Sin actividad registrada.</p>
        ) : (
          <ol className="space-y-2">
            {events.map((event) => (
              <li key={event.id} className="break-words border-b border-slate-200 pb-2">
                <span>{actions[event.action]}</span> · <span>Actor: {event.actorId}</span> ·{' '}
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toISOString()} (UTC)
                </time>
              </li>
            ))}
          </ol>
        ))}
    </section>
  );
}
