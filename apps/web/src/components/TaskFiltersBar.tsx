import { useState } from 'react';
import { ListTasksQuerySchema } from '@is488/shared';
import type { BoardColumnResponse, ListTasksQuery } from '@is488/shared';

export type TaskFilters = Pick<
  ListTasksQuery,
  'search' | 'columnId' | 'priority' | 'label' | 'assigneeId'
>;

interface Props {
  columns: BoardColumnResponse[];
  columnsLoading: boolean;
  columnsError: string | null;
  onRetryColumns: () => void;
  onApply: (filters: TaskFilters) => void;
}

const fieldClass =
  'min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet';
const buttonClass =
  'min-h-11 rounded-lg border border-slate-400 bg-white px-4 text-sm font-semibold text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet disabled:opacity-50';

export function TaskFiltersBar({
  columns,
  columnsLoading,
  columnsError,
  onRetryColumns,
  onApply,
}: Props) {
  const [draft, setDraft] = useState({
    search: '',
    columnId: '',
    priority: '',
    label: '',
    assigneeId: '',
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      aria-label="Filtros de tareas"
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = ListTasksQuerySchema.safeParse({
          page: 1,
          limit: 20,
          search: draft.search.trim() || undefined,
          columnId: draft.columnId || undefined,
          priority: draft.priority || undefined,
          label: draft.label.trim() || undefined,
          assigneeId: draft.assigneeId.trim() || undefined,
        });
        if (!parsed.success) {
          setError(parsed.error.issues.map((issue) => issue.message).join(', '));
          return;
        }
        setError(null);
        const { search, columnId, priority, label, assigneeId } = parsed.data;
        onApply({
          ...(search ? { search } : {}),
          ...(columnId ? { columnId } : {}),
          ...(priority ? { priority } : {}),
          ...(label ? { label } : {}),
          ...(assigneeId ? { assigneeId } : {}),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-sm font-medium text-slate-800">
          Buscar texto
          <input
            className={fieldClass}
            value={draft.search}
            aria-describedby={error ? 'task-filter-error' : 'task-search-help'}
            onChange={(event) => setDraft({ ...draft, search: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-800">
          Columna
          <select
            className={fieldClass}
            value={draft.columnId}
            disabled={columnsLoading || columnsError !== null}
            onChange={(event) => setDraft({ ...draft, columnId: event.target.value })}
          >
            <option value="">Todas las columnas</option>
            {columns.map((column) => (
              <option key={column.id} value={column.id}>
                {column.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-800">
          Prioridad
          <select
            className={fieldClass}
            value={draft.priority}
            onChange={(event) => setDraft({ ...draft, priority: event.target.value })}
          >
            <option value="">Todas las prioridades</option>
            <option value="LOW">Baja</option>
            <option value="MEDIUM">Media</option>
            <option value="HIGH">Alta</option>
            <option value="URGENT">Urgente</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-800">
          Responsable (UUID)
          <input
            className={fieldClass}
            value={draft.assigneeId}
            aria-describedby={error ? 'task-filter-error' : 'task-assignee-help'}
            onChange={(event) => setDraft({ ...draft, assigneeId: event.target.value })}
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-800">
          Etiqueta exacta
          <input
            className={fieldClass}
            value={draft.label}
            aria-describedby={error ? 'task-filter-error' : 'task-label-help'}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
      </div>
      <p id="task-search-help" className="text-sm text-slate-700">
        Busca en título o descripción, hasta 100 caracteres.
      </p>
      <p id="task-label-help" className="text-sm text-slate-700">
        Etiqueta exacta, distingue mayúsculas, hasta 30 caracteres. Los filtros se combinan.
      </p>
      <p id="task-assignee-help" className="text-sm text-slate-700">
        Usa el identificador UUID del responsable que aparece entre los integrantes del proyecto.
      </p>
      {columnsLoading && <p role="status">Cargando columnas...</p>}
      {columnsError && (
        <div role="alert">
          <p>No se pudieron cargar las columnas: {columnsError}</p>
          <button type="button" className={buttonClass} onClick={onRetryColumns}>
            Reintentar columnas
          </button>
        </div>
      )}
      {error && (
        <p id="task-filter-error" role="alert">
          Revisa los filtros: {error}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClass}>
          Aplicar filtros
        </button>
        <button
          type="button"
          className={buttonClass}
          onClick={() => {
            setDraft({ search: '', columnId: '', priority: '', label: '', assigneeId: '' });
            setError(null);
            onApply({});
          }}
        >
          Limpiar filtros
        </button>
      </div>
    </form>
  );
}
