import type {
  Task,
  TaskRepositoryPort,
  ListTasksFilter,
  PaginatedTasksResult,
} from '@is488/shared';
import { TaskNotFoundError, BoardColumnNotFoundError } from '@is488/shared';
import type { ProjectLockManager } from './in-memory-kanban-project.storage.js';
import { InMemoryKanbanProjectStorage, cloneTask } from './in-memory-kanban-project.storage.js';

export class InMemoryTaskRepository implements TaskRepositoryPort {
  public readonly storage: InMemoryKanbanProjectStorage;

  get tasks(): Task[] {
    return this.storage.getAllTasks();
  }

  constructor(storage?: InMemoryKanbanProjectStorage, lockManager?: ProjectLockManager) {
    this.storage = storage ?? new InMemoryKanbanProjectStorage(lockManager);
  }

  async create(
    taskData: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<Task> {
    return this.storage.lockManager.withLock(taskData.projectId, async () => {
      const snapshot = this.storage.getSnapshot(taskData.projectId);
      if (!snapshot.board || !snapshot.board.columns.some((c) => c.id === taskData.columnId)) {
        throw Object.assign(new BoardColumnNotFoundError(taskData.columnId), { statusCode: 404 });
      }
      const tasksInColumn = snapshot.tasks.filter((t) => t.columnId === taskData.columnId);
      const nextOrderIndex =
        taskData.orderIndex !== undefined
          ? taskData.orderIndex
          : tasksInColumn.length === 0
            ? 0
            : Math.max(...tasksInColumn.map((t) => t.orderIndex)) + 1;

      const now = new Date().toISOString();
      const newTask: Task = {
        ...taskData,
        id: taskData.id ?? crypto.randomUUID(),
        orderIndex: nextOrderIndex,
        labels: taskData.labels ? [...taskData.labels] : [],
        assigneeIds: taskData.assigneeIds ? [...taskData.assigneeIds] : [],
        createdAt: now,
        updatedAt: now,
      };
      snapshot.tasks.push(newTask);
      this.storage.commitSnapshot(taskData.projectId, snapshot);
      return cloneTask(newTask);
    });
  }

  async findById(id: string): Promise<Task | null> {
    const lookup = this.storage.findProjectStateByTaskId(id);
    if (!lookup) return null;
    const task = lookup.state.tasks.find((t) => t.id === id);
    return task ? cloneTask(task) : null;
  }

  async findByProjectId(projectId: string): Promise<Task[]> {
    const snapshot = this.storage.getSnapshot(projectId);
    return snapshot.tasks.map(cloneTask);
  }

  async findByColumnId(columnId: string): Promise<Task[]> {
    const lookup = this.storage.findProjectStateByColumnId(columnId);
    if (!lookup) return [];
    return lookup.state.tasks
      .filter((t) => t.columnId === columnId)
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .map(cloneTask);
  }

  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const lookup = this.storage.findProjectStateByTaskId(id);
    if (!lookup) {
      throw Object.assign(new TaskNotFoundError(id), { statusCode: 404 });
    }
    const rawUpdates = updates as Record<string, unknown>;
    if ('id' in rawUpdates) {
      if (typeof rawUpdates.id !== 'string' || rawUpdates.id.trim() === '') {
        throw Object.assign(new Error('El identificador de la tarea no puede estar vacio'), {
          statusCode: 400,
        });
      }
      if (rawUpdates.id !== id) {
        throw Object.assign(
          new Error('No se permite modificar el identificador inmutable de la tarea'),
          {
            statusCode: 400,
          },
        );
      }
    }
    if ('projectId' in rawUpdates) {
      if (typeof rawUpdates.projectId !== 'string' || rawUpdates.projectId.trim() === '') {
        throw Object.assign(new Error('El identificador de proyecto no puede estar vacio'), {
          statusCode: 400,
        });
      }
      if (rawUpdates.projectId !== lookup.projectId) {
        throw Object.assign(new Error('No se permite transferir la tarea a otro proyecto'), {
          statusCode: 400,
        });
      }
    }
    if ('columnId' in rawUpdates) {
      if (typeof rawUpdates.columnId !== 'string' || rawUpdates.columnId.trim() === '') {
        throw Object.assign(new Error('El identificador de columna no puede estar vacio'), {
          statusCode: 400,
        });
      }
    }
    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      const idx = snapshot.tasks.findIndex((t) => t.id === id);
      if (idx === -1) {
        throw Object.assign(new TaskNotFoundError(id), { statusCode: 404 });
      }
      if ('columnId' in rawUpdates && rawUpdates.columnId !== snapshot.tasks[idx]!.columnId) {
        const targetColId = rawUpdates.columnId as string;
        if (!snapshot.board || !snapshot.board.columns.some((c) => c.id === targetColId)) {
          throw Object.assign(new BoardColumnNotFoundError(targetColId), { statusCode: 404 });
        }
      }
      const existing = snapshot.tasks[idx]!;
      const now = new Date().toISOString();
      const updated: Task = {
        ...existing,
        ...updates,
        id: existing.id,
        projectId: existing.projectId,
        columnId: 'columnId' in rawUpdates ? (rawUpdates.columnId as string) : existing.columnId,
        labels: updates.labels !== undefined ? [...updates.labels] : existing.labels,
        assigneeIds:
          updates.assigneeIds !== undefined ? [...updates.assigneeIds] : existing.assigneeIds,
        updatedAt: updates.updatedAt ?? now,
      };
      snapshot.tasks[idx] = updated;
      this.storage.commitSnapshot(lookup.projectId, snapshot);
      return cloneTask(updated);
    });
  }

  async delete(id: string): Promise<void> {
    const lookup = this.storage.findProjectStateByTaskId(id);
    if (!lookup) return;
    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      snapshot.tasks = snapshot.tasks.filter((t) => t.id !== id);
      this.storage.commitSnapshot(lookup.projectId, snapshot);
    });
  }

  async moveTask(taskId: string, targetColumnId: string, targetIndex: number): Promise<Task> {
    const lookup = this.storage.findProjectStateByTaskId(taskId);
    if (!lookup) {
      throw Object.assign(new TaskNotFoundError(taskId), { statusCode: 404 });
    }
    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      const taskIndex = snapshot.tasks.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) {
        throw Object.assign(new TaskNotFoundError(taskId), { statusCode: 404 });
      }
      if (!snapshot.board || !snapshot.board.columns.some((c) => c.id === targetColumnId)) {
        throw Object.assign(new BoardColumnNotFoundError(targetColumnId), { statusCode: 404 });
      }
      const task = snapshot.tasks[taskIndex]!;
      const sourceColId = task.columnId;
      const now = new Date().toISOString();

      if (sourceColId === targetColumnId) {
        const colTasks = snapshot.tasks
          .filter((t) => t.columnId === sourceColId && t.id !== taskId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        colTasks.splice(targetIndex, 0, task);
        colTasks.forEach((t, i) => {
          t.orderIndex = i;
          if (t.id === taskId) t.updatedAt = now;
        });
      } else {
        const sourceColTasks = snapshot.tasks
          .filter((t) => t.columnId === sourceColId && t.id !== taskId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        sourceColTasks.forEach((t, i) => {
          t.orderIndex = i;
        });

        const targetColTasks = snapshot.tasks
          .filter((t) => t.columnId === targetColumnId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        task.columnId = targetColumnId;
        task.updatedAt = now;
        targetColTasks.splice(targetIndex, 0, task);
        targetColTasks.forEach((t, i) => {
          t.orderIndex = i;
        });
      }

      this.storage.commitSnapshot(lookup.projectId, snapshot);
      return cloneTask(task);
    });
  }

  async migrateTasksBetweenColumns(
    sourceColumnId: string,
    destinationColumnId: string,
  ): Promise<number> {
    const lookup = this.storage.findProjectStateByColumnId(sourceColumnId);
    if (!lookup) return 0;
    return this.storage.lockManager.withLock(lookup.projectId, async () => {
      const snapshot = this.storage.getSnapshot(lookup.projectId);
      if (!snapshot.board || !snapshot.board.columns.some((c) => c.id === destinationColumnId)) {
        throw Object.assign(new BoardColumnNotFoundError(destinationColumnId), { statusCode: 404 });
      }
      const toMigrate = snapshot.tasks
        .filter((t) => t.columnId === sourceColumnId)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      if (toMigrate.length === 0) return 0;

      const targetTasks = snapshot.tasks
        .filter((t) => t.columnId === destinationColumnId)
        .sort((a, b) => a.orderIndex - b.orderIndex);
      const startIndex = targetTasks.length;
      const now = new Date().toISOString();

      toMigrate.forEach((t, i) => {
        t.columnId = destinationColumnId;
        t.orderIndex = startIndex + i;
        t.updatedAt = now;
      });

      this.storage.commitSnapshot(lookup.projectId, snapshot);
      return toMigrate.length;
    });
  }

  async listTasks(filter: ListTasksFilter): Promise<PaginatedTasksResult> {
    const snapshot = this.storage.getSnapshot(filter.projectId);
    let items = snapshot.tasks.map(cloneTask);

    if (filter.columnId) {
      items = items.filter((t) => t.columnId === filter.columnId);
    }
    if (filter.priority) {
      items = items.filter((t) => t.priority === filter.priority);
    }
    if (filter.assigneeId) {
      items = items.filter((t) => t.assigneeIds.includes(filter.assigneeId!));
    }
    if (filter.label) {
      items = items.filter((t) => t.labels.includes(filter.label!));
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      items = items.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
      );
    }

    items.sort((a, b) => a.orderIndex - b.orderIndex);
    const totalItems = items.length;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? Math.min(filter.limit, 100) : 20;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const offset = (page - 1) * limit;
    const paginated = items.slice(offset, offset + limit);

    return {
      items: paginated,
      totalItems,
      page,
      limit,
      totalPages,
    };
  }
}
