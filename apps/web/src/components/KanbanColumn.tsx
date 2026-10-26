import React from 'react';
import type { BoardColumnResponse, TaskResponse } from '@is488/shared';
import { TaskCard } from './TaskCard.js';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

export interface KanbanColumnProps {
  column: BoardColumnResponse;
  tasks: TaskResponse[];
  onAddTask?: (columnId: string, opener: HTMLButtonElement) => void;
  onEditTask?: (task: TaskResponse, opener: HTMLButtonElement) => void;
  isDropTarget?: boolean;
  isInteractionLocked?: boolean;
}

const CATEGORY_DEFAULT_COLORS: Record<string, string> = {
  TODO: '#64748b', // Slate
  IN_PROGRESS: '#0284c7', // Sky
  IN_REVIEW: '#d97706', // Amber
  DONE: '#10b981', // Emerald
};

export const KanbanColumn: React.FC<KanbanColumnProps> = ({
  column,
  tasks,
  onAddTask,
  onEditTask,
  isDropTarget = false,
  isInteractionLocked = false,
}) => {
  const headingId = `column-title-${column.id}`;
  const sortedTasks = [...tasks].sort((a, b) => a.orderIndex - b.orderIndex);
  const color = column.color ?? CATEGORY_DEFAULT_COLORS[column.category] ?? '#64748b';
  const { setNodeRef } = useDroppable({
    id: `column:${column.id}`,
    disabled: isInteractionLocked,
  });

  return (
    <section
      ref={setNodeRef}
      data-testid={`kanban-column-${column.id}`}
      aria-labelledby={headingId}
      className="flex w-80 shrink-0 flex-col rounded-2xl border border-slate-200 bg-slate-100/70 p-4 shadow-sm"
    >
      {/* Encabezado de la columna */}
      <div className="flex items-center justify-between border-b border-slate-200/80 pb-3">
        <div className="flex items-center space-x-2.5 min-w-0">
          <span
            className="h-3 w-3 shrink-0 rounded-full shadow-xs"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <h3
            id={headingId}
            className="truncate text-sm font-bold tracking-tight text-slate-900"
            title={column.name}
          >
            {column.name}
          </h3>
        </div>

        <span
          data-testid={`column-task-count-${column.id}`}
          className="inline-flex items-center rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-slate-700 shadow-xs border border-slate-200/80"
          aria-label={`${sortedTasks.length} tarea${sortedTasks.length === 1 ? '' : 's'}`}
        >
          {sortedTasks.length}
        </span>
      </div>
      {onAddTask && (
        <button
          type="button"
          onClick={(event) => onAddTask(column.id, event.currentTarget)}
          disabled={isInteractionLocked}
          className="mt-3 min-h-11 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-unsch-garnet"
        >
          Agregar tarea
        </button>
      )}

      {/* Lista de tareas de la columna */}
      <ul
        role="list"
        aria-label={`Tareas en columna ${column.name}`}
        className={`mt-3 flex-1 space-y-3 overflow-y-auto pr-0.5 min-h-[140px] ${
          isDropTarget ? 'rounded-xl bg-sky-50/70 ring-2 ring-sky-300' : ''
        }`}
      >
        <SortableContext
          items={sortedTasks.map((task) => task.id)}
          strategy={verticalListSortingStrategy}
        >
          {sortedTasks.length === 0 ? (
            <li
              data-testid={`empty-column-${column.id}`}
              className="flex h-32 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4 text-center text-xs text-slate-400"
            >
              Sin tareas en esta columna
            </li>
          ) : (
            sortedTasks.map((task) => (
              <li key={task.id}>
                <TaskCard
                  task={task}
                  onEdit={onEditTask}
                  isDraggable
                  isInteractionLocked={isInteractionLocked}
                />
              </li>
            ))
          )}
        </SortableContext>
      </ul>
    </section>
  );
};
