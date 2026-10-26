/**
 * Puerto driven (secundario) para el listado paginado y filtrado de tareas
 * de un proyecto en la arquitectura hexagonal IS488.
 *
 * Contrato de ordenacion determinista:
 *   Primario:   columnId (orden lexicografico de UUID)
 *   Secundario: orderIndex (ascendente, posicion dentro de la columna)
 *   Terciario:  createdAt (ascendente, desempate estable)
 *
 * Semantica de busqueda (search):
 *   Coincidencia insensible a mayusculas de subcadena sobre titulo y descripcion.
 *
 * Nota v1: El filtro por rango de fechas no esta incluido en esta version;
 *   ListTasksQuerySchema no define startDate/endDate.
 */

import type { Task, TaskPriority } from './task-repository.port.js';

/**
 * Filtros opcionales aplicados antes de paginar.
 * Todos los filtros definidos se combinan con logica AND.
 */
export interface TaskListFilter {
  /** Devuelve solo las tareas que pertenezcan a esta columna. */
  columnId?: string;
  /** Devuelve solo las tareas con este nivel de prioridad. */
  priority?: TaskPriority;
  /** Devuelve solo las tareas que incluyan este UUID en su lista de asignados. */
  assigneeId?: string;
  /** Devuelve solo las tareas que contengan esta etiqueta (coincidencia exacta de cadena). */
  label?: string;
  /**
   * Devuelve tareas cuyo titulo o descripcion contengan la cadena como subcadena
   * insensible a mayusculas.
   */
  search?: string;
}

/**
 * Parametros de la consulta de listado de tareas.
 */
export interface TaskListParams {
  /** UUID del proyecto cuyas tareas se van a listar. */
  projectId: string;
  /** Numero de pagina (1-indexed). */
  page: number;
  /** Tamano de pagina (maximo 100). */
  limit: number;
  /** Filtros opcionales aplicados sobre el conjunto total antes de paginar. */
  filter: TaskListFilter;
}

/**
 * Resultado del listado paginado de tareas.
 */
export interface TaskListResult {
  /** Tareas de la pagina solicitada, ya ordenadas. */
  items: Task[];
  /** Total de tareas que satisfacen los filtros (no el total del proyecto). */
  totalItems: number;
  /** Numero de pagina devuelto. */
  page: number;
  /** Tamano de pagina utilizado. */
  limit: number;
  /** Total de paginas: ceil(totalItems / limit); 0 si totalItems es 0. */
  totalPages: number;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para el listado
 * paginado y filtrado de tareas de un proyecto.
 *
 * Garantias:
 * - Filtra antes de paginar: totalItems refleja el conjunto filtrado.
 * - Orden determinista y estable: (columnId, orderIndex, createdAt).
 * - Sin mutacion ni registro de eventos de auditoria.
 * - Aislamiento horizontal: solo devuelve tareas del projectId indicado.
 */
export interface TaskListPort {
  listProjectTasks(params: TaskListParams): Promise<TaskListResult>;
}
