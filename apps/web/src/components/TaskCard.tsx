import React from 'react';
import type { TaskResponse, TaskPriorityDto } from '@is488/shared';
import { Calendar, Tag, Users } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface TaskCardProps {
  task: TaskResponse;
  onEdit?: (task: TaskResponse, opener: HTMLButtonElement) => void;
  isDragging?: boolean;
  isDraggable?: boolean;
  isInteractionLocked?: boolean;
}

interface PriorityConfig {
  label: string;
  badgeClasses: string;
}

const PRIORITY_MAP: Record<TaskPriorityDto, PriorityConfig> = {
  LOW: {
    label: 'Baja',
    badgeClasses: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  MEDIUM: {
    label: 'Media',
    badgeClasses: 'bg-sky-50 text-sky-800 border-sky-200',
  },
  HIGH: {
    label: 'Alta',
    badgeClasses: 'bg-amber-50 text-amber-800 border-amber-200',
  },
  URGENT: {
    label: 'Urgente',
    badgeClasses: 'bg-rose-50 text-rose-800 border-rose-200 font-semibold',
  },
};

function formatDueDate(isoString: string): string {
  try {
    return new Date(isoString).toLocaleDateString('es-PE', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return isoString.split('T')[0] ?? isoString;
  }
}

export const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onEdit,
  isDragging = false,
  isDraggable = false,
  isInteractionLocked = false,
}) => {
  const priorityInfo = PRIORITY_MAP[task.priority] ?? PRIORITY_MAP.MEDIUM;
  const headingId = `task-title-${task.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging: sortableDragging,
  } = useSortable({ id: task.id, disabled: isInteractionLocked });

  return (
    <article
      ref={isDraggable ? setNodeRef : undefined}
      style={
        isDraggable
          ? {
              transform: CSS.Transform.toString(transform),
              transition,
            }
          : undefined
      }
      data-testid={`task-card-${task.id}`}
      aria-labelledby={headingId}
      className={`group relative rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md ${
        isDragging || sortableDragging ? 'z-10 opacity-60 shadow-lg' : ''
      }`}
    >
      {/* Encabezado de la tarjeta: Título y Prioridad */}
      <div className="flex items-start justify-between gap-2">
        <h4
          id={headingId}
          className="text-sm font-semibold leading-snug tracking-tight text-slate-900 line-clamp-2"
        >
          {task.title}
        </h4>
        <span
          className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${priorityInfo.badgeClasses}`}
          aria-label={`Prioridad: ${priorityInfo.label}`}
        >
          {priorityInfo.label}
        </span>
      </div>

      {onEdit && (
        <button
          type="button"
          onClick={(event) => onEdit(task, event.currentTarget)}
          disabled={isInteractionLocked}
          className="mt-3 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
        >
          Editar tarea
        </button>
      )}

      {isDraggable && (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={isInteractionLocked}
          aria-label={`Arrastrar tarea ${task.title}`}
          className="mt-3 min-h-11 w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-unsch-garnet disabled:cursor-not-allowed disabled:opacity-60"
        >
          Mover tarea
        </button>
      )}

      {/* Descripción opcional */}
      {task.description && (
        <p className="mt-2 text-xs leading-relaxed text-slate-600 line-clamp-3">
          {task.description}
        </p>
      )}

      {/* Etiquetas opcionales */}
      {task.labels && task.labels.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Etiquetas">
          {task.labels.map((label, idx) => (
            <span
              key={`${label}-${idx}`}
              className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
            >
              <Tag className="mr-1 h-2.5 w-2.5 text-slate-400" aria-hidden="true" />
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Metadatos inferiores: Fecha límite y Asignados */}
      <div className="mt-3.5 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs text-slate-500">
        {task.dueDate ? (
          <div
            className="flex items-center space-x-1.5 text-[11px] text-slate-600"
            title={`Fecha límite: ${formatDueDate(task.dueDate)}`}
          >
            <Calendar className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span>{formatDueDate(task.dueDate)}</span>
          </div>
        ) : (
          <span />
        )}

        {task.assigneeIds && task.assigneeIds.length > 0 && (
          <div
            className="flex items-center space-x-1 text-[11px] text-slate-600"
            aria-label={`${task.assigneeIds.length} responsable(s) asignado(s)`}
          >
            <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            <span className="font-medium">{task.assigneeIds.length}</span>
          </div>
        )}
      </div>
    </article>
  );
};
