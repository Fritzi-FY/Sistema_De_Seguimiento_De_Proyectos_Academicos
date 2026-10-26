import React, { useState, useEffect } from 'react';
import type {
  BoardResponse,
  CreateTaskRequest,
  MoveTaskRequest,
  MembershipResponse,
  TaskResponse,
  UpdateTaskRequest,
} from '@is488/shared';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { DragEndEvent } from '@dnd-kit/core';
import type { CollisionDetection } from '@dnd-kit/core';
import {
  getBoard,
  createBoardColumn,
  updateBoardColumn,
  deleteBoardColumn,
} from '../services/board.service.js';
import { BoardColumnManager, type ColumnAction } from './BoardColumnManager.js';
import { createTask, getAllProjectTasks, moveTask, updateTask } from '../services/task.service.js';
import { KanbanColumn } from './KanbanColumn.js';
import { CreateTaskModal } from './CreateTaskModal.js';
import { EditTaskModal } from './EditTaskModal.js';
import { AlertCircle, RefreshCw, Loader2, FolderKanban } from 'lucide-react';

export const kanbanCollisionDetection: CollisionDetection = (args) => {
  if (!args.pointerCoordinates) return closestCorners(args);
  const hits = pointerWithin(args);
  const cards = hits.filter((hit) => !String(hit.id).startsWith('column:'));
  return cards.length > 0 ? cards : hits;
};

export interface KanbanBoardProps {
  refreshKey?: number;
  membersFetcher?: (projectId: string) => Promise<MembershipResponse[]>;
  onPendingChange?: (pending: boolean) => void;
  projectId: string;
  boardFetcher?: (projectId: string, options?: { signal?: AbortSignal }) => Promise<BoardResponse>;
  tasksFetcher?: (projectId: string, options?: { signal?: AbortSignal }) => Promise<TaskResponse[]>;
  taskCreator?: (
    projectId: string,
    data: CreateTaskRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<TaskResponse>;
  taskUpdater?: (
    projectId: string,
    taskId: string,
    data: UpdateTaskRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<TaskResponse>;
  taskMover?: (
    projectId: string,
    taskId: string,
    data: MoveTaskRequest,
    options?: { signal?: AbortSignal },
  ) => Promise<TaskResponse>;
}

const defaultBoardFetcher = (id: string, options?: { signal?: AbortSignal }) =>
  getBoard(id, undefined, options);
const defaultTasksFetcher = (id: string, options?: { signal?: AbortSignal }) =>
  getAllProjectTasks(id, undefined, options);
const defaultTaskCreator = (
  id: string,
  data: CreateTaskRequest,
  options?: { signal?: AbortSignal },
) => createTask(id, data, undefined, options);
const defaultTaskUpdater = (
  projectId: string,
  taskId: string,
  data: UpdateTaskRequest,
  options?: { signal?: AbortSignal },
) => updateTask(projectId, taskId, data, undefined, options);
const defaultTaskMover = (
  projectId: string,
  taskId: string,
  data: MoveTaskRequest,
  options?: { signal?: AbortSignal },
) => moveTask(projectId, taskId, data, undefined, options);

export function moveTasks(
  tasks: TaskResponse[],
  taskId: string,
  destinationColumnId: string,
  destinationIndex: number,
): TaskResponse[] {
  const sourceTask = tasks.find((task) => task.id === taskId);
  if (!sourceTask) return tasks;

  const sourceTasks = tasks
    .filter((task) => task.columnId === sourceTask.columnId && task.id !== taskId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const destinationTasks = tasks
    .filter((task) => task.columnId === destinationColumnId && task.id !== taskId)
    .sort((a, b) => a.orderIndex - b.orderIndex);
  const clampedIndex = Math.max(0, Math.min(destinationIndex, destinationTasks.length));
  const reorderedDestination = [...destinationTasks];
  reorderedDestination.splice(clampedIndex, 0, {
    ...sourceTask,
    columnId: destinationColumnId,
    orderIndex: clampedIndex,
  });
  const affectedColumns = new Set([sourceTask.columnId, destinationColumnId]);
  const affectedTasks = new Map<string, TaskResponse[]>();
  affectedColumns.forEach((columnId) => {
    const columnTasks = columnId === destinationColumnId ? reorderedDestination : sourceTasks;
    affectedTasks.set(
      columnId,
      columnTasks.map((task, index) => ({ ...task, orderIndex: index })),
    );
  });

  return tasks
    .filter((task) => task.id !== taskId && !affectedColumns.has(task.columnId))
    .concat(...affectedTasks.values());
}

export const KanbanBoard: React.FC<KanbanBoardProps> = ({
  refreshKey = 0,
  projectId,
  boardFetcher = defaultBoardFetcher,
  tasksFetcher = defaultTasksFetcher,
  taskCreator = defaultTaskCreator,
  taskUpdater = defaultTaskUpdater,
  taskMover = defaultTaskMover,
  onPendingChange,
  membersFetcher,
}) => {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [tasks, setTasks] = useState<TaskResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [pendingWrite, setPendingWrite] = useState(false);
  const [columnManagerOpen, setColumnManagerOpen] = useState(false);
  const [pendingColumn, setPendingColumn] = useState(false);
  const [columnsNeedRefresh, setColumnsNeedRefresh] = useState(false);
  const [columnRefreshError, setColumnRefreshError] = useState<string | null>(null);
  const columnBusyRef = React.useRef(false);
  const columnOperationRef = React.useRef(0);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createColumnId, setCreateColumnId] = useState<string>();
  const [editingTask, setEditingTask] = useState<TaskResponse | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [activeDragTask, setActiveDragTask] = useState<TaskResponse | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    operationId: number;
    projectId: string;
    taskId: string;
  } | null>(null);
  const [moveAnnouncement, setMoveAnnouncement] = useState(
    'Arrastra una tarea con el puntero o enfócala y usa Espacio para moverla con el teclado.',
  );
  const createButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const editButtonRef = React.useRef<HTMLButtonElement | null>(null);
  const activeEditingTaskIdRef = React.useRef<string | null>(null);
  const activeProjectIdRef = React.useRef(projectId);
  const mountedRef = React.useRef(true);
  const requestGenerationRef = React.useRef(0);
  const moveOperationRef = React.useRef(0);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  activeProjectIdRef.current = projectId;
  activeEditingTaskIdRef.current = editingTask?.id ?? null;

  useEffect(() => {
    onPendingChange?.(pendingWrite || pendingMove !== null || pendingColumn);
  }, [pendingWrite, pendingMove, pendingColumn, onPendingChange]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let isCurrent = true;
    const controller = new AbortController();

    async function loadKanbanData() {
      setLoading(true);
      setError(null);

      try {
        const [boardData, tasksData] = await Promise.all([
          boardFetcher(projectId, { signal: controller.signal }),
          tasksFetcher(projectId, { signal: controller.signal }),
        ]);

        if (!isCurrent) return;

        setBoard(boardData);
        setTasks(tasksData);
      } catch (err) {
        if (!isCurrent) return;
        if (err instanceof Error && err.name === 'AbortError') return;

        setError(
          err instanceof Error
            ? err.message
            : 'Ocurrió un error inesperado al cargar el tablero Kanban',
        );
      } finally {
        if (isCurrent) {
          setLoading(false);
        }
      }
    }

    void loadKanbanData();

    return () => {
      isCurrent = false;
      controller.abort();
    };
  }, [projectId, boardFetcher, tasksFetcher, retryKey, refreshKey]);

  useEffect(() => {
    setIsCreateModalOpen(false);
    setColumnManagerOpen(false);
    setPendingColumn(false);
    setColumnsNeedRefresh(false);
    setColumnRefreshError(null);
    columnBusyRef.current = false;
    columnOperationRef.current += 1;
    setPendingWrite(false);
    setCreateColumnId(undefined);
    setEditingTask(null);
    requestGenerationRef.current += 1;
    moveOperationRef.current += 1;
    setPendingMove(null);
    setActiveDragTask(null);
    setMoveError(null);
    setMoveAnnouncement(
      'Arrastra una tarea con el puntero o enfócala y usa Espacio para moverla con el teclado.',
    );
  }, [projectId]);

  const handleAddTask = (columnId: string, opener: HTMLButtonElement) => {
    if (pendingMove || columnManagerOpen || columnBusyRef.current || columnsNeedRefresh) return;
    createButtonRef.current = opener;
    setCreateColumnId(columnId);
    setIsCreateModalOpen(true);
  };

  const handleEditTask = (task: TaskResponse, opener: HTMLButtonElement) => {
    if (pendingMove || columnManagerOpen || columnBusyRef.current || columnsNeedRefresh) return;
    editButtonRef.current = opener;
    setEditingTask(task);
  };

  const handleCreateTask = async (data: CreateTaskRequest): Promise<TaskResponse> => {
    if (columnBusyRef.current || columnsNeedRefresh)
      throw new Error('Actualiza el tablero antes de modificar tareas');
    if (pendingMove) throw new Error('Espera a que termine el movimiento de la tarea');
    const generation = requestGenerationRef.current;
    const requestProjectId = projectId;
    setPendingWrite(true);
    let createdTask: TaskResponse;
    try {
      createdTask = await taskCreator(requestProjectId, data);
    } finally {
      if (
        mountedRef.current &&
        activeProjectIdRef.current === requestProjectId &&
        requestGenerationRef.current === generation
      )
        setPendingWrite(false);
    }
    const isCurrent =
      mountedRef.current &&
      activeProjectIdRef.current === requestProjectId &&
      requestGenerationRef.current === generation;

    if (isCurrent) {
      setTasks((currentTasks) =>
        currentTasks.some((task) => task.id === createdTask.id)
          ? currentTasks
          : [...currentTasks, createdTask],
      );
    } else {
      const staleError = new Error('La respuesta pertenece a un proyecto anterior');
      staleError.name = 'StaleTaskCreationError';
      throw staleError;
    }

    return createdTask;
  };

  const handleUpdateTask = async (data: UpdateTaskRequest): Promise<TaskResponse> => {
    if (columnBusyRef.current || columnsNeedRefresh)
      throw new Error('Actualiza el tablero antes de modificar tareas');
    if (pendingMove) throw new Error('Espera a que termine el movimiento de la tarea');
    const task = editingTask;
    if (!task) throw new Error('No hay una tarea seleccionada para editar');
    const generation = requestGenerationRef.current;
    const requestProjectId = projectId;
    const requestTaskId = task.id;
    setPendingWrite(true);
    let updatedTask: TaskResponse;
    try {
      updatedTask = await taskUpdater(requestProjectId, requestTaskId, data);
    } finally {
      if (
        mountedRef.current &&
        activeProjectIdRef.current === requestProjectId &&
        requestGenerationRef.current === generation
      )
        setPendingWrite(false);
    }
    const isCurrent =
      mountedRef.current &&
      activeProjectIdRef.current === requestProjectId &&
      requestGenerationRef.current === generation &&
      activeEditingTaskIdRef.current === requestTaskId;

    if (!isCurrent) {
      const staleError = new Error('La respuesta pertenece a una tarea anterior');
      staleError.name = 'StaleTaskUpdateError';
      throw staleError;
    }
    if (updatedTask.id !== requestTaskId || updatedTask.projectId !== requestProjectId) {
      throw new Error('La respuesta de actualización no corresponde a la tarea solicitada');
    }

    setTasks((currentTasks) =>
      currentTasks.map((currentTask) =>
        currentTask.id === updatedTask.id ? updatedTask : currentTask,
      ),
    );
    setEditingTask(null);
    return updatedTask;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragTask(null);
    if (
      pendingMove ||
      pendingWrite ||
      columnManagerOpen ||
      columnBusyRef.current ||
      columnsNeedRefresh ||
      isCreateModalOpen ||
      editingTask
    ) {
      setMoveAnnouncement('Espera a que termine el movimiento pendiente.');
      return;
    }
    const activeTaskId = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setMoveAnnouncement('Movimiento cancelado.');
      return;
    }

    const sourceTask = tasks.find((task) => task.id === activeTaskId);
    if (!sourceTask) {
      setMoveAnnouncement('Movimiento cancelado.');
      return;
    }

    const overTask = tasks.find((task) => task.id === overId);
    const destinationColumnId = overTask?.columnId ?? overId.replace(/^column:/, '');
    const sourceColumnTasks = tasks
      .filter((task) => task.columnId === sourceTask.columnId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const destinationTasks = tasks
      .filter((task) => task.columnId === destinationColumnId && task.id !== activeTaskId)
      .sort((a, b) => a.orderIndex - b.orderIndex);
    const sourceIndex = sourceColumnTasks.findIndex((task) => task.id === activeTaskId);
    const destinationIndex = overTask
      ? destinationTasks.findIndex((task) => task.id === overTask.id)
      : destinationTasks.length;

    if (
      sourceIndex < 0 ||
      destinationIndex < 0 ||
      (sourceTask.columnId === destinationColumnId && sourceIndex === destinationIndex)
    ) {
      setMoveAnnouncement('Movimiento sin cambios.');
      return;
    }

    const snapshot = tasks;
    const operationId = moveOperationRef.current + 1;
    moveOperationRef.current = operationId;
    const requestProjectId = projectId;
    setPendingMove({ operationId, projectId: requestProjectId, taskId: activeTaskId });
    setMoveError(null);
    setMoveAnnouncement(`Moviendo ${sourceTask.title}.`);
    setTasks((currentTasks) =>
      moveTasks(currentTasks, activeTaskId, destinationColumnId, destinationIndex),
    );

    const payload: MoveTaskRequest = { destinationColumnId, destinationIndex };
    const sourceName =
      board?.columns.find((column) => column.id === sourceTask.columnId)?.name ??
      sourceTask.columnId;
    const destinationName =
      board?.columns.find((column) => column.id === destinationColumnId)?.name ??
      destinationColumnId;
    const movementDescription = `${sourceName} a ${destinationName}, posición ${destinationIndex + 1}`;
    setMoveAnnouncement(
      `Moviendo ${sourceTask.title}: ${movementDescription}. Esperando confirmación.`,
    );
    void taskMover(requestProjectId, activeTaskId, payload)
      .then((confirmedTask) => {
        const isCurrent =
          mountedRef.current &&
          activeProjectIdRef.current === requestProjectId &&
          moveOperationRef.current === operationId;
        if (!isCurrent) return;
        if (confirmedTask.id !== activeTaskId || confirmedTask.projectId !== requestProjectId) {
          throw new Error('La respuesta de movimiento no corresponde a la tarea solicitada');
        }
        setTasks((currentTasks) =>
          currentTasks.map((task) => (task.id === confirmedTask.id ? confirmedTask : task)),
        );
        setPendingMove(null);
        setMoveAnnouncement(
          `${confirmedTask.title} se movió correctamente: ${movementDescription}.`,
        );
      })
      .catch((err: unknown) => {
        const isCurrent =
          mountedRef.current &&
          activeProjectIdRef.current === requestProjectId &&
          moveOperationRef.current === operationId;
        if (!isCurrent) return;
        setPendingMove(null);
        setTasks(snapshot);
        setMoveError(
          `El movimiento no pudo confirmarse (${err instanceof Error ? err.message : 'error desconocido'}). Comprueba el tablero antes de repetir.`,
        );
        setMoveAnnouncement('El movimiento no pudo confirmarse.');
      });
  };

  const runColumnAction = async (action?: ColumnAction) => {
    if (
      !board ||
      columnBusyRef.current ||
      pendingWrite ||
      pendingMove ||
      isCreateModalOpen ||
      editingTask ||
      activeDragTask
    )
      throw new Error('Espera a que termine la operación actual antes de gestionar columnas');
    if (action && columnsNeedRefresh)
      throw new Error('Actualiza el tablero antes de repetir una operación');
    columnBusyRef.current = true;
    const operation = ++columnOperationRef.current;
    const requestProjectId = projectId;
    const requestBoardId = board.id;
    const current = () =>
      mountedRef.current &&
      activeProjectIdRef.current === requestProjectId &&
      columnOperationRef.current === operation;
    setPendingColumn(true);
    setColumnRefreshError(null);
    try {
      if (action?.kind === 'create')
        await createBoardColumn(requestProjectId, requestBoardId, {
          name: action.name,
          category: action.category,
        });
      if (action?.kind === 'update')
        await updateBoardColumn(requestProjectId, requestBoardId, action.columnId, {
          name: action.name,
          orderIndex: action.orderIndex,
        });
      if (action?.kind === 'delete')
        await deleteBoardColumn(requestProjectId, action.columnId, {
          targetColumnId: action.targetColumnId,
        });
      if (!current()) throw new Error('Respuesta de un proyecto anterior');
      const [nextBoard, nextTasks] = await Promise.all([
        boardFetcher(requestProjectId),
        tasksFetcher(requestProjectId),
      ]);
      if (!current()) throw new Error('Respuesta de un proyecto anterior');
      if (
        nextBoard.id !== requestBoardId ||
        nextBoard.projectId !== requestProjectId ||
        nextTasks.some(
          (task) =>
            task.projectId !== requestProjectId ||
            !nextBoard.columns.some((column) => column.id === task.columnId),
        )
      ) {
        throw new Error('La actualización recibida no corresponde al tablero solicitado');
      }
      setBoard(nextBoard);
      setTasks(nextTasks);
      setColumnsNeedRefresh(false);
    } catch (err) {
      if (current()) {
        const message = `${err instanceof Error ? err.message : 'Error desconocido'}. Actualiza el tablero para comprobar su estado antes de repetir.`;
        setColumnsNeedRefresh(true);
        setColumnRefreshError(message);
        throw new Error(message);
      }
      throw err;
    } finally {
      if (current()) {
        columnBusyRef.current = false;
        setPendingColumn(false);
      }
    }
  };

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        data-testid="kanban-board-loading"
        className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-50/60 p-8 text-slate-500"
      >
        <Loader2 className="h-8 w-8 animate-spin text-unsch-garnet" aria-hidden="true" />
        <span className="mt-3 text-sm font-medium text-slate-700">Cargando tablero Kanban...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        data-testid="kanban-board-error"
        className="rounded-2xl border border-rose-200 bg-rose-50/70 p-6 text-rose-900 shadow-sm"
      >
        <div className="flex items-start space-x-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
          <div className="flex-1 space-y-2">
            <h4 className="text-sm font-bold text-rose-900">Error al cargar el tablero</h4>
            <p className="text-xs leading-relaxed text-rose-700">{error}</p>
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setRetryKey((k) => k + 1)}
                data-testid="kanban-retry-btn"
                className="inline-flex items-center rounded-lg bg-rose-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-offset-2"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Reintentar
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const sortedColumns = [...(board?.columns ?? [])].sort((a, b) => a.orderIndex - b.orderIndex);

  if (sortedColumns.length === 0) {
    return (
      <div
        data-testid="kanban-board-empty"
        className="flex min-h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-xs"
      >
        <FolderKanban className="h-10 w-10 text-slate-400" aria-hidden="true" />
        <h4 className="mt-3 text-sm font-bold text-slate-800">Tablero sin columnas configuradas</h4>
        <p className="mt-1 max-w-sm text-xs text-slate-500">
          Este proyecto aún no cuenta con columnas registradas para organizar su flujo de tareas.
        </p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={kanbanCollisionDetection}
      onDragStart={({ active }) => {
        const task = tasks.find((item) => item.id === String(active.id)) ?? null;
        setActiveDragTask(task);
        if (task) setMoveAnnouncement(`Moviendo ${task.title}.`);
      }}
      onDragCancel={() => {
        setActiveDragTask(null);
        setMoveAnnouncement('Movimiento cancelado.');
      }}
      onDragOver={({ active, over }) => {
        const task = tasks.find((item) => item.id === String(active.id));
        if (!task || !over) return;
        const overTask = tasks.find((item) => item.id === String(over.id));
        const columnId = overTask?.columnId ?? String(over.id).replace(/^column:/, '');
        const column = board?.columns.find((item) => item.id === columnId);
        const source = board?.columns.find((item) => item.id === task.columnId);
        if (!column) return;
        const position =
          overTask?.orderIndex ??
          tasks.filter((item) => item.columnId === columnId && item.id !== task.id).length;
        setMoveAnnouncement(
          `${task.title}: de ${source?.name ?? task.columnId} a ${column.name}, posición ${position + 1}.`,
        );
      }}
      onDragEnd={handleDragEnd}
    >
      <div data-testid="kanban-board" aria-label="Tablero Kanban de tareas" className="relative">
        {board && (
          <BoardColumnManager
            key={projectId}
            board={board}
            tasks={tasks}
            open={columnManagerOpen}
            disabled={
              pendingWrite ||
              pendingMove !== null ||
              isCreateModalOpen ||
              editingTask !== null ||
              activeDragTask !== null ||
              columnsNeedRefresh
            }
            pending={pendingColumn}
            onOpenChange={setColumnManagerOpen}
            onAction={runColumnAction}
          />
        )}
        {columnsNeedRefresh && (
          <div className="mb-4 space-y-2">
            <p role="alert" className="text-sm text-rose-800">
              {columnRefreshError}
            </p>
            <button
              type="button"
              disabled={pendingColumn}
              onClick={() => {
                void runColumnAction().catch(() => {});
              }}
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm text-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-unsch-garnet disabled:opacity-50"
            >
              Actualizar tablero
            </button>
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {moveAnnouncement}
        </p>
        {moveError && (
          <div
            role="alert"
            data-testid="kanban-move-error"
            className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {moveError}
          </div>
        )}
        <div className="flex gap-5 overflow-x-auto pb-4 pt-1">
          {sortedColumns.map((column) => {
            const columnTasks = tasks.filter((t) => t.columnId === column.id);
            return (
              <KanbanColumn
                key={column.id}
                column={column}
                tasks={columnTasks}
                onAddTask={handleAddTask}
                onEditTask={handleEditTask}
                isInteractionLocked={
                  pendingMove !== null || columnManagerOpen || pendingColumn || columnsNeedRefresh
                }
              />
            );
          })}
        </div>
        <CreateTaskModal
          projectId={projectId}
          membersFetcher={membersFetcher}
          isOpen={isCreateModalOpen}
          columns={sortedColumns}
          initialColumnId={createColumnId}
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={handleCreateTask}
          returnFocusRef={createButtonRef}
        />
        <EditTaskModal
          membersFetcher={membersFetcher}
          isOpen={editingTask !== null}
          task={editingTask}
          onClose={() => setEditingTask(null)}
          onSubmit={handleUpdateTask}
          returnFocusRef={editButtonRef}
        />
        <DragOverlay>
          {activeDragTask ? <TaskCardPreview task={activeDragTask} /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
};

const TaskCardPreview: React.FC<{ task: TaskResponse }> = ({ task }) => (
  <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-xl">
    <span className="text-sm font-semibold text-slate-900">{task.title}</span>
  </div>
);
