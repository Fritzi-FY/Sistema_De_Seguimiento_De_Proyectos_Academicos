import React, { useEffect, useRef, useState } from 'react';
import { UpdateTaskSchema } from '@is488/shared';
import type {
  MembershipResponse,
  TaskPriorityDto,
  TaskResponse,
  UpdateTaskRequest,
} from '@is488/shared';
import { TaskAssigneePicker } from './TaskAssigneePicker.js';
import { TaskActivityHistory, type TaskActivityFetcher } from './TaskActivityHistory.js';
import { AlertCircle, Loader2, X } from 'lucide-react';

export interface EditTaskModalProps {
  activityFetcher?: TaskActivityFetcher;
  membersFetcher?: (projectId: string) => Promise<MembershipResponse[]>;
  isOpen: boolean;
  task: TaskResponse | null;
  onClose: () => void;
  onSubmit: (data: UpdateTaskRequest) => Promise<TaskResponse>;
  returnFocusRef?: React.MutableRefObject<HTMLButtonElement | null>;
}

const PRIORITIES: Array<{ value: TaskPriorityDto; label: string }> = [
  { value: 'LOW', label: 'Baja' },
  { value: 'MEDIUM', label: 'Media' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'URGENT', label: 'Urgente' },
];

function toDateInputValue(isoDate?: string): string {
  return isoDate ? isoDate.slice(0, 10) : '';
}

function toUtcDate(date: string): string | null {
  return date ? `${date}T00:00:00.000Z` : null;
}

function labelsInputValue(labels: string[]): string {
  return labels.join(', ');
}

function parseLabels(value: string): string[] {
  return value
    .split(',')
    .map((label) => label.trim())
    .filter((label, index, labels) => label.length > 0 && labels.indexOf(label) === index);
}

export const EditTaskModal: React.FC<EditTaskModalProps> = ({
  isOpen,
  task,
  onClose,
  onSubmit,
  returnFocusRef,
  membersFetcher,
  activityFetcher,
}) => {
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriorityDto>('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [labels, setLabels] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

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
    setErrorMessage(null);
    if (isOpen && task) {
      setTitle(task.title);
      setDescription(task.description ?? '');
      setPriority(task.priority);
      setDueDate(toDateInputValue(task.dueDate));
      setLabels(labelsInputValue(task.labels));
      setAssigneeIds([...task.assigneeIds]);
      titleInputRef.current?.focus();
    }
  }, [isOpen, task]);

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

  if (!isOpen || !task) return null;

  const currentValues = {
    title: task.title,
    description: task.description ?? '',
    priority: task.priority,
    dueDate: toDateInputValue(task.dueDate),
    labels: task.labels,
  };
  const nextLabels = parseLabels(labels);
  const patch: UpdateTaskRequest = {};
  if (title.trim() !== currentValues.title) patch.title = title.trim();
  if (description.trim() !== currentValues.description) patch.description = description.trim();
  if (priority !== currentValues.priority) patch.priority = priority;
  if (dueDate !== currentValues.dueDate) patch.dueDate = toUtcDate(dueDate);
  if (JSON.stringify(nextLabels) !== JSON.stringify(currentValues.labels))
    patch.labels = nextLabels;
  if (JSON.stringify([...assigneeIds].sort()) !== JSON.stringify([...task.assigneeIds].sort()))
    patch.assigneeIds = assigneeIds;
  const hasChanges = Object.keys(patch).length > 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current || !hasChanges) return;
    const parsed = UpdateTaskSchema.safeParse(patch);
    if (!parsed.success) {
      setErrorMessage(parsed.error.issues.map((issue) => issue.message).join(', '));
      return;
    }
    const operation = operationRef.current;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      await onSubmit(parsed.data);
      if (mountedRef.current && operationRef.current === operation) onClose();
    } catch (error) {
      if (!mountedRef.current || operationRef.current !== operation) return;
      if (error instanceof Error && error.name === 'StaleTaskUpdateError') return;
      setErrorMessage(
        `${error instanceof Error ? error.message : 'La actualización no pudo confirmarse'}. La actualización no pudo confirmarse; comprueba el tablero antes de repetir.`,
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
      aria-labelledby="edit-task-modal-title"
    >
      <div
        ref={dialogRef}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h2 id="edit-task-modal-title" className="text-lg font-bold text-slate-900">
            Editar tarea
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Cerrar modal de edición de tarea"
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
            <label htmlFor="edit-task-title" className="block text-sm font-semibold text-slate-700">
              Título *
            </label>
            <input
              ref={titleInputRef}
              id="edit-task-title"
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
              htmlFor="edit-task-description"
              className="block text-sm font-semibold text-slate-700"
            >
              Descripción
            </label>
            <textarea
              id="edit-task-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={2000}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="edit-task-priority"
                className="block text-sm font-semibold text-slate-700"
              >
                Prioridad
              </label>
              <select
                id="edit-task-priority"
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
            <div>
              <label
                htmlFor="edit-task-due-date"
                className="block text-sm font-semibold text-slate-700"
              >
                Fecha límite
              </label>
              <input
                id="edit-task-due-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="edit-task-labels"
              className="block text-sm font-semibold text-slate-700"
            >
              Etiquetas
            </label>
            <input
              id="edit-task-labels"
              value={labels}
              onChange={(event) => setLabels(event.target.value)}
              placeholder="backend, documentación"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-unsch-garnet focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
            />
            <p className="mt-1 text-xs text-slate-500">
              Separa las etiquetas con comas (máximo 5).
            </p>
          </div>
          <section aria-label="Responsables actuales" className="space-y-2 text-sm text-slate-800">
            <h3 className="font-semibold">Responsables actuales</h3>
            {task.assigneeIds.length === 0 ? (
              <p>Sin responsables asignados.</p>
            ) : (
              <ul>
                {task.assigneeIds.map((id) => (
                  <li key={id} className="break-all">
                    {id}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <TaskAssigneePicker
            key={`${task.projectId}/${task.id}`}
            projectId={task.projectId}
            currentIds={task.assigneeIds}
            selectedIds={assigneeIds}
            onChange={setAssigneeIds}
            disabled={submitting}
            membersFetcher={membersFetcher}
          />
          <TaskActivityHistory
            projectId={task.projectId}
            taskId={task.id}
            fetcher={activityFetcher}
          />
          <div aria-live="polite" className="min-h-5 text-sm text-slate-600">
            {submitting && (
              <span role="status">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" aria-hidden="true" />
                Guardando cambios. No cierres ni repitas el envío.
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
              disabled={submitting || !hasChanges}
              className="inline-flex min-h-11 items-center rounded-lg bg-unsch-garnet px-4 py-2 text-sm font-semibold text-white focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
              Guardar cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
