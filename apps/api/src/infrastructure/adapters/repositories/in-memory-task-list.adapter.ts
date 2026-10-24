import type { TaskListPort, TaskListParams, TaskListResult } from '@is488/shared';
import {
  type InMemoryKanbanProjectStorage,
  cloneTask,
} from './in-memory-kanban-project.storage.js';

/**
 * Adaptador en memoria para el listado paginado y filtrado de tareas de un proyecto.
 *
 * Garantias:
 * - Lee snapshot de solo lectura (sin lock): operacion inmutable, sin efectos secundarios.
 * - Aplica todos los filtros antes de paginar (AND logico entre filtros activos).
 * - Orden determinista: (columnId, orderIndex, createdAt) — estable y reproducible.
 * - totalItems refleja el conjunto filtrado, no el total de tareas del proyecto.
 * - Aislamiento horizontal: solo accede al snapshot del projectId indicado.
 * - Sin mutacion ni emision de eventos de auditoria.
 */
export class InMemoryTaskListAdapter implements TaskListPort {
  constructor(private readonly storage: InMemoryKanbanProjectStorage) {}

  async listProjectTasks(params: TaskListParams): Promise<TaskListResult> {
    const snapshot = this.storage.getSnapshot(params.projectId);

    // 1. Filtrado (todos los filtros activos en AND)
    let tasks = snapshot.tasks.filter((task) => {
      if (params.filter.columnId !== undefined && task.columnId !== params.filter.columnId) {
        return false;
      }
      if (params.filter.priority !== undefined && task.priority !== params.filter.priority) {
        return false;
      }
      if (
        params.filter.assigneeId !== undefined &&
        !task.assigneeIds.includes(params.filter.assigneeId)
      ) {
        return false;
      }
      if (params.filter.label !== undefined && !task.labels.includes(params.filter.label)) {
        return false;
      }
      if (params.filter.search !== undefined && params.filter.search.length > 0) {
        const q = params.filter.search.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(q);
        const matchesDesc = task.description?.toLowerCase().includes(q) ?? false;
        if (!matchesTitle && !matchesDesc) return false;
      }
      return true;
    });

    // 2. Orden determinista: (columnId lex, orderIndex asc, createdAt asc)
    tasks = tasks.slice().sort((a, b) => {
      const colCmp = a.columnId.localeCompare(b.columnId);
      if (colCmp !== 0) return colCmp;
      if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex;
      return a.createdAt.localeCompare(b.createdAt);
    });

    // 3. Totales (sobre el conjunto filtrado, antes de paginar)
    const totalItems = tasks.length;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / params.limit);

    // 4. Paginacion
    const offset = (params.page - 1) * params.limit;
    const pageItems = tasks.slice(offset, offset + params.limit);

    return {
      items: pageItems.map(cloneTask),
      totalItems,
      page: params.page,
      limit: params.limit,
      totalPages,
    };
  }
}
