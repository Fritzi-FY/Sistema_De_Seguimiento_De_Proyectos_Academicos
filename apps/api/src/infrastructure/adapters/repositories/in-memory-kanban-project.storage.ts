import type { Board, Task, TaskActivityEvent } from '@is488/shared';

export interface ProjectKanbanState {
  board: Board | null;
  tasks: Task[];
  events: TaskActivityEvent[];
  boardRevision?: number;
}

export function cloneBoard(board: Board): Board {
  return {
    ...board,
    columns: board.columns.map((c) => ({ ...c })),
  };
}

export function cloneTask(task: Task): Task {
  return {
    ...task,
    labels: [...task.labels],
    assigneeIds: [...task.assigneeIds],
  };
}

export function cloneEvent(event: TaskActivityEvent): TaskActivityEvent {
  return {
    ...event,
    details: event.details ? JSON.parse(JSON.stringify(event.details)) : undefined,
  };
}

export function cloneProjectState(state: ProjectKanbanState): ProjectKanbanState {
  return {
    board: state.board ? cloneBoard(state.board) : null,
    tasks: state.tasks.map(cloneTask),
    events: state.events.map(cloneEvent),
    boardRevision: state.boardRevision ?? 0,
  };
}

/**
 * Gestor de exclusión mutua por clave (projectId) para serializar operaciones
 * concurrentes de escritura en memoria sin condiciones de carrera.
 */
export class ProjectLockManager {
  private readonly locks = new Map<string, Promise<unknown>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) {
        this.locks.delete(key);
      }
    }
  }

  clear(): void {
    this.locks.clear();
  }
}

/**
 * Almacenamiento compartido por proyecto para tablero, tareas y eventos.
 * Implementa el patrón Copy-On-Write con publicación atómica mediante
 * una única sustitución síncrona de referencia:
 * - Aislamiento durante preparación (lecturas concurrentes observan estado previo intacto).
 * - Publicación atómica todo-o-nada sin fases intermedias ni escrituras posteriores.
 * - Sin fugas de referencias mutables externas mediante clonación profunda.
 */
export class InMemoryKanbanProjectStorage {
  private readonly states = new Map<string, ProjectKanbanState>();
  public readonly lockManager: ProjectLockManager;

  constructor(lockManager?: ProjectLockManager) {
    this.lockManager = lockManager ?? new ProjectLockManager();
  }

  getSnapshot(projectId: string): ProjectKanbanState {
    const existing = this.states.get(projectId);
    if (!existing) {
      return {
        board: null,
        tasks: [],
        events: [],
        boardRevision: 0,
      };
    }
    return cloneProjectState(existing);
  }

  findProjectStateByBoardId(
    boardId: string,
  ): { projectId: string; state: ProjectKanbanState } | null {
    for (const [projectId, state] of this.states.entries()) {
      if (state.board?.id === boardId) {
        return { projectId, state: cloneProjectState(state) };
      }
    }
    return null;
  }

  findProjectStateByColumnId(
    columnId: string,
  ): { projectId: string; state: ProjectKanbanState } | null {
    for (const [projectId, state] of this.states.entries()) {
      if (
        state.board?.columns.some((c) => c.id === columnId) ||
        state.tasks.some((t) => t.columnId === columnId)
      ) {
        return { projectId, state: cloneProjectState(state) };
      }
    }
    return null;
  }

  findProjectStateByTaskId(
    taskId: string,
  ): { projectId: string; state: ProjectKanbanState } | null {
    for (const [projectId, state] of this.states.entries()) {
      if (state.tasks.some((t) => t.id === taskId)) {
        return { projectId, state: cloneProjectState(state) };
      }
    }
    return null;
  }

  getAllTasks(): Task[] {
    const all: Task[] = [];
    for (const state of this.states.values()) {
      all.push(...state.tasks.map(cloneTask));
    }
    return all;
  }

  getAllEvents(): TaskActivityEvent[] {
    const all: TaskActivityEvent[] = [];
    for (const state of this.states.values()) {
      all.push(...state.events.map(cloneEvent));
    }
    return all;
  }

  getBoardRevision(projectId: string): number {
    return this.states.get(projectId)?.boardRevision ?? 0;
  }

  commitSnapshot(projectId: string, nextState: ProjectKanbanState): void {
    const current = this.states.get(projectId);
    let nextRevision = current?.boardRevision ?? 0;
    if (
      nextState.board &&
      (!current?.board || JSON.stringify(nextState.board) !== JSON.stringify(current.board))
    ) {
      nextRevision += 1;
    }
    this.states.set(projectId, {
      ...cloneProjectState(nextState),
      boardRevision: nextRevision,
    });
  }

  clear(): void {
    this.states.clear();
    this.lockManager.clear();
  }
}
