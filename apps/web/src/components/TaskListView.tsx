import { useEffect, useState } from 'react';
import type { BoardResponse, ListTasksQuery, PaginatedTasksResponse } from '@is488/shared';
import { getTasks } from '../services/task.service.js';
import { getBoard } from '../services/board.service.js';
import { TaskFiltersBar } from './TaskFiltersBar.js';

export type TaskPageFetcher = (
  projectId: string,
  query: ListTasksQuery,
  options?: { signal?: AbortSignal },
) => Promise<PaginatedTasksResponse>;

const fetchPage: TaskPageFetcher = (id, query, options) => getTasks(id, query, undefined, options);
const fetchBoard = (id: string, options?: { signal?: AbortSignal }) =>
  getBoard(id, undefined, options);

export interface TaskListViewProps {
  refreshKey?: number;
  projectId: string;
  tasksFetcher?: TaskPageFetcher;
  boardFetcher?: (projectId: string, options?: { signal?: AbortSignal }) => Promise<BoardResponse>;
}

export function TaskListView(props: TaskListViewProps) {
  return <ProjectTaskList key={props.projectId} {...props} />;
}

function ProjectTaskList({
  refreshKey = 0,
  projectId,
  tasksFetcher = fetchPage,
  boardFetcher = fetchBoard,
}: TaskListViewProps) {
  const [query, setQuery] = useState<ListTasksQuery>({ page: 1, limit: 20 });
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [columnsLoading, setColumnsLoading] = useState(true);
  const [columnsError, setColumnsError] = useState<string | null>(null);
  const [columnsRetry, setColumnsRetry] = useState(0);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<PaginatedTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setBoard(null);
    setColumnsError(null);
    setColumnsLoading(true);
    void (async () => {
      try {
        const result = await boardFetcher(projectId, { signal: controller.signal });
        if (current) setBoard(result);
      } catch (err) {
        if (current) setColumnsError(err instanceof Error ? err.message : 'Error desconocido');
      } finally {
        if (current) setColumnsLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [projectId, boardFetcher, columnsRetry, refreshKey]);

  useEffect(() => {
    let current = true;
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    void (async () => {
      try {
        const result = await tasksFetcher(projectId, query, {
          signal: controller.signal,
        });
        if (current) setData(result);
      } catch (err) {
        if (current)
          setError(err instanceof Error ? err.message : 'No se pudieron cargar las tareas');
      } finally {
        if (current) setLoading(false);
      }
    })();
    return () => {
      current = false;
      controller.abort();
    };
  }, [projectId, query, retry, tasksFetcher, refreshKey]);

  const buttonClass =
    'min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-unsch-garnet disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <div aria-label="Lista de tareas" aria-busy={loading} className="space-y-4">
      <TaskFiltersBar
        columns={board?.columns ?? []}
        columnsLoading={columnsLoading}
        columnsError={columnsError}
        onRetryColumns={() => setColumnsRetry((value) => value + 1)}
        onApply={(filters) => setQuery({ ...filters, page: 1, limit: 20 })}
      />
      {loading && <p role="status">Cargando lista de tareas...</p>}
      {error && (
        <div
          role="alert"
          className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-900"
        >
          <p>No se pudo cargar la lista: {error}</p>
          <button
            type="button"
            className={buttonClass}
            onClick={() => setRetry((value) => value + 1)}
          >
            Reintentar
          </button>
        </div>
      )}
      {data && !loading && (
        <>
          {data.items.length === 0 ? (
            <p role="status">Sin coincidencias</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm text-slate-800">
                <caption className="sr-only">Tareas del proyecto, página {data.page}</caption>
                <thead className="bg-slate-50">
                  <tr>
                    <th scope="col" className="p-3">
                      Tarea
                    </th>
                    <th scope="col" className="p-3">
                      Prioridad
                    </th>
                    <th scope="col" className="p-3">
                      Fecha límite (UTC)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((task) => (
                    <tr key={task.id} className="border-t border-slate-200">
                      <th scope="row" className="max-w-sm break-words p-3 font-medium">
                        {task.title}
                      </th>
                      <td className="p-3">
                        {
                          { LOW: 'Baja', MEDIUM: 'Media', HIGH: 'Alta', URGENT: 'Urgente' }[
                            task.priority
                          ]
                        }
                      </td>
                      <td className="p-3">
                        {task.dueDate ? task.dueDate.slice(0, 10) : 'Sin fecha'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p role="status" className="text-sm text-slate-700">
            {data.totalItems === 0
              ? '0 tareas'
              : `${data.totalItems} tareas · Página ${data.page} de ${data.totalPages} · ${data.limit} por página`}
          </p>
        </>
      )}
      <nav aria-label="Paginación de tareas" className="flex flex-wrap gap-3">
        <button
          type="button"
          className={buttonClass}
          disabled={loading || !data || data.totalItems === 0 || data.page <= 1}
          onClick={() => setQuery((current) => ({ ...current, page: data!.page - 1 }))}
        >
          Anterior
        </button>
        <button
          type="button"
          className={buttonClass}
          disabled={loading || !data || data.totalItems === 0 || data.page >= data.totalPages}
          onClick={() => setQuery((current) => ({ ...current, page: data!.page + 1 }))}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
}
