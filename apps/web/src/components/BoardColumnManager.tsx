import { useEffect, useRef, useState } from 'react';
import {
  CreateBoardColumnSchema,
  UpdateBoardColumnSchema,
  type BoardResponse,
  type TaskResponse,
  type ColumnCategoryDto,
} from '@is488/shared';

export type ColumnAction =
  | { kind: 'create'; name: string; category: ColumnCategoryDto }
  | { kind: 'update'; columnId: string; name?: string; orderIndex?: number }
  | { kind: 'delete'; columnId: string; targetColumnId?: string };

export interface BoardColumnManagerProps {
  board: BoardResponse;
  tasks: TaskResponse[];
  open: boolean;
  disabled: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onAction: (action: ColumnAction) => Promise<void>;
}

const buttonClass =
  'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-unsch-garnet disabled:opacity-50 disabled:cursor-not-allowed';
const inputClass =
  'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet';
const categories: Array<{ value: ColumnCategoryDto; label: string }> = [
  { value: 'TODO', label: 'Por hacer' },
  { value: 'IN_PROGRESS', label: 'En progreso' },
  { value: 'IN_REVIEW', label: 'En revisión' },
  { value: 'DONE', label: 'Hecho' },
];

export function BoardColumnManager({
  board,
  tasks,
  open,
  disabled,
  pending,
  onOpenChange,
  onAction,
}: BoardColumnManagerProps) {
  const [mode, setMode] = useState<{ kind: 'rename' | 'delete'; id: string } | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ColumnCategoryDto>('TODO');
  const [target, setTarget] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const mounted = useRef(false);
  const submitting = useRef(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    if (mode?.kind === 'delete') cancel.current?.focus();
    else input.current?.focus();
  }, [mode, open]);
  useEffect(() => {
    if (notice && !pending) toggle.current?.focus();
  }, [notice, pending]);
  const columns = [...board.columns].sort((a, b) => a.orderIndex - b.orderIndex);
  const selected = columns.find((column) => column.id === mode?.id);
  const count = tasks.filter((task) => task.columnId === mode?.id).length;
  const locked = disabled || pending;

  async function perform(action: ColumnAction) {
    if (locked || submitting.current) return;
    setError(null);
    setNotice('');
    try {
      const validation =
        action.kind === 'create'
          ? CreateBoardColumnSchema.safeParse({ name: action.name, category: action.category })
          : action.kind === 'update'
            ? UpdateBoardColumnSchema.safeParse({
                name: action.name,
                orderIndex: action.orderIndex,
              })
            : null;
      if (validation && !validation.success)
        throw new Error(validation.error.issues.map((issue) => issue.message).join('. '));
      submitting.current = true;
      await onAction(action);
      if (!mounted.current) return;
      setNotice('Cambio de columnas confirmado.');
      if (action.kind !== 'update' || action.name !== undefined) {
        setMode(null);
        setName('');
      }
      toggle.current?.focus();
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : 'No se pudo confirmar el cambio');
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section aria-label="Gestión de columnas" className="mb-4 space-y-3">
      <button
        ref={toggle}
        type="button"
        className={buttonClass}
        disabled={locked}
        aria-expanded={open}
        aria-controls="column-management-panel"
        onClick={() => {
          setMode(null);
          setName('');
          setError(null);
          setNotice('');
          onOpenChange(!open);
        }}
      >
        {open ? 'Cerrar gestión de columnas' : 'Gestionar columnas'}
      </button>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="text-sm text-rose-800">
          {error}
        </p>
      )}
      {open && (
        <div
          id="column-management-panel"
          className="space-y-4 rounded-xl border border-slate-300 bg-slate-50 p-4"
          aria-busy={pending}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !pending && !submitting.current) {
              onOpenChange(false);
              toggle.current?.focus();
            }
          }}
        >
          <h4 className="font-semibold text-slate-900">Columnas del tablero</h4>
          <p className="text-sm text-slate-700">
            Añade solo las etapas que necesite el proyecto. «En revisión» es opcional.
          </p>
          <ol className="space-y-2">
            {columns.map((column, index) => (
              <li
                key={column.id}
                className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2"
              >
                <span className="min-w-0 break-words font-medium text-slate-900">
                  {index + 1}. {column.name}
                </span>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={locked}
                  aria-label={`Renombrar ${column.name}`}
                  onClick={() => {
                    setMode({ kind: 'rename', id: column.id });
                    setName(column.name);
                    setError(null);
                  }}
                >
                  Renombrar
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={locked || index === 0}
                  aria-label={`Mover ${column.name} antes`}
                  onClick={() =>
                    void perform({ kind: 'update', columnId: column.id, orderIndex: index - 1 })
                  }
                >
                  Mover antes
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={locked || index === columns.length - 1}
                  aria-label={`Mover ${column.name} después`}
                  onClick={() =>
                    void perform({ kind: 'update', columnId: column.id, orderIndex: index + 1 })
                  }
                >
                  Mover después
                </button>
                <button
                  type="button"
                  className={buttonClass}
                  disabled={locked || columns.length <= 1}
                  aria-label={`Eliminar ${column.name}`}
                  onClick={() => {
                    setMode({ kind: 'delete', id: column.id });
                    setTarget('');
                    setError(null);
                  }}
                >
                  Eliminar
                </button>
              </li>
            ))}
          </ol>
          {columns.length <= 1 && (
            <p className="text-sm text-slate-700">No se puede eliminar la última columna.</p>
          )}
          {mode?.kind === 'delete' && selected ? (
            <form
              aria-label={`Confirmar eliminación de ${selected.name}`}
              onSubmit={(event) => {
                event.preventDefault();
                if (count > 0 && !target) {
                  setError('Selecciona una columna destino para las tareas.');
                  return;
                }
                void perform({
                  kind: 'delete',
                  columnId: selected.id,
                  targetColumnId: target || undefined,
                });
              }}
            >
              <fieldset disabled={locked} className="space-y-3">
                <legend className="font-semibold text-slate-900">
                  ¿Eliminar «{selected.name}»?
                </legend>
                <p className="text-sm text-slate-700">
                  Esta acción elimina la columna.{' '}
                  {count > 0
                    ? `${count} tarea(s) se trasladarán al final del destino elegido, conservando su orden.`
                    : 'No contiene tareas en la última consulta. El servidor comprobará su estado al eliminar.'}
                </p>
                <label className="block text-sm text-slate-800">
                  Destino de las tareas {count > 0 ? '(obligatorio)' : '(si hay tareas nuevas)'}
                  <select
                    className={inputClass}
                    value={target}
                    onChange={(event) => setTarget(event.target.value)}
                    required={count > 0}
                  >
                    <option value="">Selecciona un destino</option>
                    {columns
                      .filter((column) => column.id !== selected.id)
                      .map((column) => (
                        <option key={column.id} value={column.id}>
                          {column.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    ref={cancel}
                    type="button"
                    className={buttonClass}
                    onClick={() => {
                      setMode(null);
                      setName('');
                      toggle.current?.focus();
                    }}
                  >
                    Cancelar eliminación
                  </button>
                  <button type="submit" className={buttonClass}>
                    Confirmar eliminación
                  </button>
                </div>
              </fieldset>
            </form>
          ) : (
            <form
              aria-label={mode?.kind === 'rename' ? 'Renombrar columna' : 'Crear columna'}
              onSubmit={(event) => {
                event.preventDefault();
                if (mode?.kind === 'rename')
                  void perform({ kind: 'update', columnId: mode.id, name: name.trim() });
                else void perform({ kind: 'create', name: name.trim(), category });
              }}
            >
              <fieldset disabled={locked} className="space-y-3">
                <legend className="font-semibold text-slate-900">
                  {mode ? 'Renombrar columna' : 'Crear columna'}
                </legend>
                <label className="block text-sm text-slate-800">
                  Nombre de columna
                  <input
                    ref={input}
                    className={inputClass}
                    value={name}
                    maxLength={50}
                    required
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                {!mode && (
                  <label className="block text-sm text-slate-800">
                    Categoría de columna
                    <select
                      className={inputClass}
                      value={category}
                      onChange={(event) => setCategory(event.target.value as ColumnCategoryDto)}
                    >
                      {categories.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className={buttonClass}>
                    {pending ? 'Guardando columna…' : mode ? 'Guardar nombre' : 'Crear columna'}
                  </button>
                  {mode && (
                    <button
                      type="button"
                      className={buttonClass}
                      onClick={() => {
                        setMode(null);
                        setName('');
                      }}
                    >
                      Cancelar cambio de nombre
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
          {pending && <p role="status">Esperando confirmación y actualización del tablero…</p>}
        </div>
      )}
    </section>
  );
}
