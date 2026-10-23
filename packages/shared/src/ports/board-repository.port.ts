/**
 * Entidades, errores y puerto del dominio para la gestión de tableros Kanban y columnas (IS488).
 * Alineado con el modelo de datos canónico y especificación OpenSpec `boards-tasks`.
 */

export type ColumnCategory = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE';

/**
 * Entidad de dominio representativa de una columna dentro de un tablero Kanban.
 * Mantiene orden secuencial contiguo y categoría semántica.
 */
export interface BoardColumn {
  /** UUID v4 identificador único de la columna. */
  id: string;
  /** UUID del tablero al que pertenece la columna. */
  boardId: string;
  /** Nombre visible de la columna (1 a 50 caracteres). */
  name: string;
  /** Posición secuencial dentro del tablero (0-indexed). */
  orderIndex: number;
  /** Categoría semántica de la columna. */
  category: ColumnCategory;
  /** Código de color hexadecimal opcional (ej. #3b82f6). */
  color?: string;
  /** Marca de tiempo ISO-8601 UTC de creación. */
  createdAt: string;
  /** Marca de tiempo ISO-8601 UTC de última actualización. */
  updatedAt: string;
}

/**
 * Entidad de dominio representativa del tablero Kanban de un proyecto académico.
 * Un proyecto posee exactamente un tablero Kanban asociado.
 */
export interface Board {
  /** UUID v4 identificador único del tablero. */
  id: string;
  /** UUID del proyecto al que pertenece el tablero. */
  projectId: string;
  /** Lista de columnas pertenecientes al tablero, ordenadas por orderIndex. */
  columns: BoardColumn[];
  /** Marca de tiempo ISO-8601 UTC de creación. */
  createdAt: string;
  /** Marca de tiempo ISO-8601 UTC de última actualización. */
  updatedAt: string;
}

/**
 * Error lanzado cuando no se encuentra un tablero solicitado.
 */
export class BoardNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Tablero '${identifier}' no encontrado`);
    this.name = 'BoardNotFoundError';
  }
}

/**
 * Error lanzado cuando no se encuentra una columna solicitada dentro de un tablero.
 */
export class BoardColumnNotFoundError extends Error {
  constructor(columnId: string) {
    super(`Columna '${columnId}' no encontrada en el tablero`);
    this.name = 'BoardColumnNotFoundError';
  }
}

/**
 * Error lanzado cuando se intenta superar el límite máximo de 10 columnas por tablero.
 */
export class MaxColumnsReachedError extends Error {
  constructor(boardId: string, maxColumns = 10) {
    super(`El tablero '${boardId}' ya alcanzó el límite máximo de ${maxColumns} columnas`);
    this.name = 'MaxColumnsReachedError';
  }
}

/**
 * Error lanzado cuando se intenta eliminar la última columna restante de un tablero.
 */
export class LastColumnDeletionError extends Error {
  constructor(boardId: string) {
    super(
      `No se puede eliminar la última columna del tablero '${boardId}'. Un tablero debe mantener al menos una columna`,
    );
    this.name = 'LastColumnDeletionError';
  }
}

/**
 * Error lanzado cuando se intenta eliminar una columna que contiene tareas sin especificar una columna destino válida.
 */
export class ColumnNotEmptyError extends Error {
  constructor(columnId: string, taskCount: number) {
    super(
      `La columna '${columnId}' contiene ${taskCount} tarea(s) activa(s) y no puede eliminarse sin reasignarlas a una columna destino`,
    );
    this.name = 'ColumnNotEmptyError';
  }
}

/**
 * Error lanzado cuando la columna destino especificada para migrar tareas no existe o pertenece a otro tablero.
 */
export class InvalidDestinationColumnError extends Error {
  constructor(columnId: string) {
    super(`La columna destino '${columnId}' es inválida, no existe o pertenece a otro proyecto`);
    this.name = 'InvalidDestinationColumnError';
  }
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la persistencia y ciclo de vida de tableros y columnas Kanban.
 */
export interface BoardRepositoryPort {
  /**
   * Busca el tablero asociado a un proyecto por su projectId.
   * Retorna null si el proyecto aún no cuenta con tablero inicializado.
   */
  findByProjectId(projectId: string): Promise<Board | null>;

  /**
   * Busca un tablero por su id único.
   * Retorna null si no existe.
   */
  findById(id: string): Promise<Board | null>;

  /**
   * Persiste o actualiza un tablero completo con sus columnas.
   */
  /**
   * Persiste o actualiza un tablero completo con sus columnas.
   * Opcionalmente valida la revisión esperada para control de concurrencia optimista.
   */
  saveBoard(board: Board, expectedRevision?: number): Promise<void>;

  /**
   * Inicialización perezosa e idempotente ante concurrencia:
   * Si el tablero ya existe para el proyecto, lo retorna.
   * Si no existe, crea atómicamente el tablero con las 3 columnas canónicas
   * ('Por hacer' [TODO], 'En progreso' [IN_PROGRESS], 'Completado' [DONE])
   * garantizando que llamadas paralelas no generen duplicados ni condiciones de carrera.
   */
  findOrCreateDefaultBoard(projectId: string): Promise<Board>;

  /**
   * Agrega una nueva columna a un tablero existente.
   * @throws {BoardNotFoundError} Si el tablero no existe.
   * @throws {MaxColumnsReachedError} Si el tablero ya tiene 10 columnas.
   */
  addColumn(
    boardId: string,
    column: Omit<BoardColumn, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  ): Promise<BoardColumn>;

  /**
   * Actualiza propiedades de una columna existente.
   * @throws {BoardColumnNotFoundError} Si la columna no existe.
   */
  updateColumn(
    columnId: string,
    updates: Partial<Pick<BoardColumn, 'name' | 'color' | 'category' | 'orderIndex'>>,
  ): Promise<BoardColumn>;

  /**
   * Elimina una columna por su id.
   * @throws {BoardColumnNotFoundError} Si la columna no existe.
   * @throws {LastColumnDeletionError} Si es la única columna del tablero.
   */
  deleteColumn(columnId: string): Promise<void>;

  /**
   * Reordena las columnas de un tablero actualizando sus orderIndex atómicamente.
   */
  reorderColumns(
    boardId: string,
    columnOrders: Array<{ columnId: string; orderIndex: number }>,
  ): Promise<void>;
}
