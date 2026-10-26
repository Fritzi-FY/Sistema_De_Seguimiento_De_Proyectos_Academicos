import React, { useEffect, useRef, useState } from 'react';
import type {
  BoardColumnResponse,
  CreateTaskRequest,
  TaskPriorityDto,
  TaskResponse,
  MembershipResponse,
} from '@is488/shared';
import { CreateTaskSchema } from '@is488/shared';
import { AlertCircle, Loader2, X } from 'lucide-react';
import { TaskAssigneePicker } from './TaskAssigneePicker.js';

export interface CreateTaskModalProps {
  projectId?: string;
  membersFetcher?: (projectId: string) => Promise<MembershipResponse[]>;
  isOpen: boolean;
  columns: BoardColumnResponse[];
  initialColumnId?: string;
  onClose: () => void;
  onSubmit: (data: CreateTaskRequest) => Promise<TaskResponse>;
  returnFocusRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

const PRIORITIES: Array<{ value: TaskPriorityDto; label: string }> = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },
];

function toUtcDate(date: string): string | undefined {
  return date ? `${date}T00:00:00.000Z` : undefined;
}

export const CreateTaskModal: React.FC<CreateTaskModalProps> = ({
  isOpen,
  columns,
  initialColumnId,
  onClose,
  onSubmit,
  returnFocusRef,
  projectId,
  membersFetcher,
}) => {
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [columnId, setColumnId] = useState(initialColumnId ?? '');
  const [priority, setPriority] = useState<TaskPriorityDto>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
    };
  }, []);
  useEffect(() => {
    operationRef.current += 1;
    submittingRef.current = false;
    setSubmitting(false);
    setAssigneeIds([]);
    setErrorMessage(null);
  }, [isOpen, projectId]);

  useEffect(() => {
    if (!isOpen) return;
    setColumnId(initialColumnId ?? columns[0]?.id ?? '');
    titleInputRef.current?.focus();
  }, [initialColumnId, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submittingRef.current) {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last!.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first!.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) return;
    returnFocusRef?.current?.focus();
  }, [isOpen, returnFocusRef]);

  if (!isOpen) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;

    setErrorMessage(null);
    const payload: CreateTaskRequest = {
      title: title.trim(),
      description: description.trim() || undefined,
      columnId,
      priority,
      dueDate: toUtcDate(dueDate),
      labels: [],
      assigneeIds,
    };
    const validation = CreateTaskSchema.safeParse(payload);
    if (!validation.success) {
      setErrorMessage(validation.error.issues.map((issue) => issue.message).join('. '));
      return;
    }

    submittingRef.current = true;
    const operation = operationRef.current;
    setSubmitting(true);
    try {
      await onSubmit(validation.data);
      if (!mountedRef.current || operationRef.current !== operation) return;
      setTitle('');
      setDescription('');
      setDueDate('');
      setPriority('MEDIUM');
      setAssigneeIds([]);
      onClose();
    } catch (error) {
      if (!mountedRef.current || operationRef.current !== operation) return;
      if (error instanceof Error && error.name === 'StaleTaskCreationError') {
        return;
      }
      setErrorMessage(
        `${error instanceof Error ? error.message : 'No se pudo confirmar la creación de la tarea'}. Comprueba el tablero antes de repetir el envío.`,
      );
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-task-modal-title"
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 id="create-task-modal-title" className="text-lg font-bold text-slate-900">
            Nueva tarea
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar modal de nueva tarea"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {errorMessage && (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800"
          >
            <AlertCircle className="mr-2 inline h-4 w-4" aria-hidden="true" />
            {errorMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="task-title" className="block text-sm font-semibold text-slate-700">
              Título *
            </label>
            <input
              ref={titleInputRef}
              id="task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              minLength={3}
              maxLength={140}
              required
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
            />
          </div>

          <div>
            <label
              htmlFor="task-description"
              className="block text-sm font-semibold text-slate-700"
            >
              Descripción
            </label>
            <textarea
              id="task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="task-column" className="block text-sm font-semibold text-slate-700">
                Columna *
              </label>
              <select
                id="task-column"
                value={columnId}
                onChange={(event) => setColumnId(event.target.value)}
                required
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
              >
                <option value="">Selecciona una columna</option>
                {columns.map((column) => (
                  <option key={column.id} value={column.id}>
                    {column.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="task-priority" className="block text-sm font-semibold text-slate-700">
                Prioridad
              </label>
              <select
                id="task-priority"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriorityDto)}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
              >
                {PRIORITIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="task-due-date" className="block text-sm font-semibold text-slate-700">
              Fecha límite
            </label>
            <input
              id="task-due-date"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
            />
          </div>

          {projectId && (
            <TaskAssigneePicker
              key={projectId}
              projectId={projectId}
              selectedIds={assigneeIds}
              onChange={setAssigneeIds}
              disabled={submitting}
              membersFetcher={membersFetcher}
              legend="Responsables"
            />
          )}
          <div aria-live="polite" className="min-h-5 text-sm text-slate-600">
            {submitting && (
              <span role="status">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
                Creando tarea. No cierres ni repitas el envío.
              </span>
            )}
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex min-h-11 items-center rounded-lg bg-unsch-garnet px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Crear tarea
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
