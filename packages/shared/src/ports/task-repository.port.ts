/**
 * Entidades, errores y puerto del dominio para el ciclo de vida y gestión de tareas (IS488).
 * Alineado con el modelo de datos canónico y especificación OpenSpec `boards-tasks`.
 */

export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';

/**
 * Entidad de dominio representativa de una Tarea dentro de un proyecto académico.
 * Pertenece unívocamente a un proyecto y a una columna válida de su tablero Kanban.
 */
export interface Task {
  /** UUID v4 identificador único de la tarea. */
  id: string;
  /** UUID del proyecto al que pertenece la tarea. */
  projectId: string;
  /** UUID de la columna del tablero donde reside la tarea. */
  columnId: string;
  /** Título de la tarea (3 a 140 caracteres). */
  title: string;
  /** Descripción detallada opcional (hasta 2000 caracteres). */
  description?: string;
  /** Nivel de prioridad de la tarea. */
  priority: TaskPriority;
  /** Posición secuencial contigua dentro de su columna (0-indexed). */
  orderIndex: number;
  /** Fecha límite opcional en formato ISO-8601 UTC. */
  dueDate?: string;
  /** Lista de etiquetas asociadas (máximo 5 etiquetas, hasta 30 caracteres cada una). */
  labels: string[];
  /** Identificador del usuario que creó la tarea. */
  creatorId: string;
  /** Lista de identificadores de usuarios asignados (deben ser miembros activos del proyecto). */
  assigneeIds: string[];
  /** Marca de tiempo ISO-8601 UTC de creación. */
  createdAt: string;
  /** Marca de tiempo ISO-8601 UTC de última actualización. */
  updatedAt: string;
}

/**
 * Filtros y parámetros de paginación para la consulta tabular de tareas.
 */
export interface ListTasksFilter {
  /** UUID del proyecto (obligatorio por aislamiento horizontal). */
  projectId: string;
  /** Filtrar por columna específica. */
  columnId?: string;
  /** Filtrar por nivel de prioridad. */
  priority?: TaskPriority;
  /** Filtrar por responsable asignado. */
  assigneeId?: string;
  /** Filtrar por etiqueta. */
  label?: string;
  /** Búsqueda por texto en título o descripción. */
  search?: string;
  /** Número de página (1-indexed, por defecto 1). */
  page?: number;
  /** Cantidad de elementos por página (por defecto 20, máximo 100). */
  limit?: number;
}

/**
 * Resultado paginado de la consulta de tareas.
 */
export interface PaginatedTasksResult {
  items: Task[];
  totalItems: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Error lanzado cuando no se encuentra una tarea solicitada.
 */
export class TaskNotFoundError extends Error {
  constructor(taskId: string) {
    super(`Tarea '${taskId}' no encontrada`);
    this.name = 'TaskNotFoundError';
  }
}

/**
 * Error lanzado cuando se intenta asignar una tarea a un usuario que no tiene membresía activa en el proyecto.
 */
export class IneligibleAssigneeError extends Error {
  constructor(userId: string, projectId: string) {
    super(`El usuario '${userId}' no posee una membresía activa en el proyecto '${projectId}'`);
    this.name = 'IneligibleAssigneeError';
  }
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la persistencia, consulta
 * y transiciones de ciclo de vida de tareas en proyectos académicos.
 */
export interface TaskRepositoryPort {
  /**
   * Persiste una nueva tarea construida con identificadores asignados.
   */
  create(task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<Task>;

  /**
   * Busca una tarea por su id único.
   * Retorna null si no existe.
   */
  findById(id: string): Promise<Task | null>;

  /**
   * Retorna todas las tareas pertenecientes a un proyecto.
   */
  findByProjectId(projectId: string): Promise<Task[]>;

  /**
   * Retorna las tareas pertenecientes a una columna, ordenadas ascendentemente por orderIndex.
   */
  findByColumnId(columnId: string): Promise<Task[]>;

  /**
   * Actualiza campos editables de una tarea.
   * @throws {TaskNotFoundError} Si la tarea no existe.
   */
  update(
    id: string,
    updates: Partial<
      Pick<
        Task,
        | 'title'
        | 'description'
        | 'priority'
        | 'dueDate'
        | 'labels'
        | 'assigneeIds'
        | 'columnId'
        | 'orderIndex'
      >
    >,
  ): Promise<Task>;

  /**
   * Elimina una tarea por su id.
   * @throws {TaskNotFoundError} Si la tarea no existe.
   */
  delete(id: string): Promise<void>;

  /**
   * Traslada una tarea atómicamente a una posición (targetIndex) dentro de targetColumnId.
   * Compacta los índices de la columna origen y desplaza los de la columna destino.
   * @throws {TaskNotFoundError} Si la tarea no existe.
   */
  moveTask(taskId: string, targetColumnId: string, targetIndex: number): Promise<Task>;

  /**
   * Reasigna en lote todas las tareas de una columna origen hacia una columna destino,
   * agregándolas al final de la secuencia de la columna destino.
   * Retorna la cantidad de tareas migradas.
   */
  migrateTasksBetweenColumns(sourceColumnId: string, destinationColumnId: string): Promise<number>;

  /**
   * Consulta paginada y filtrada en servidor de tareas del proyecto.
   */
  listTasks(filter: ListTasksFilter): Promise<PaginatedTasksResult>;
}
