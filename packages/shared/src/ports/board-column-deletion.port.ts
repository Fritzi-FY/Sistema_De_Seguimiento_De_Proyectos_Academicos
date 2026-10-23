/**
 * Entidades, parámetros y puerto del dominio para la eliminación atómica y transaccional
 * de columnas Kanban (IS488).
 * Alineado con el modelo de datos canónico y especificación OpenSpec oards-tasks.
 */

/**
 * Parámetros para la ejecución atómica de la eliminación de una columna de tablero.
 */
export interface DeleteColumnTransactionParams {
  /** UUID del proyecto al que pertenece el tablero. */
  projectId: string;
  /** UUID de la columna a eliminar. */
  columnId: string;
  /** UUID de la columna destino hacia donde migrar tareas (obligatorio si la columna origen contiene tareas). */
  targetColumnId?: string;
  /** UUID del usuario que ejecuta la acción de eliminación. */
  actorId: string;
  /** Motivo opcional registrado en la auditoría. */
  reason?: string;
  /** Marca de tiempo ISO-8601 UTC en que se ejecuta la operación. */
  timestamp: string;
}

/**
 * Resultado devuelto tras completar la transacción atómica de eliminación de columna.
 */
export interface DeleteColumnTransactionResult {
  deletedColumnId: string;
  migratedTasksCount: number;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la eliminación atómica y
 * transaccional de columnas Kanban.
 *
 * Coordina en una **unidad de trabajo única e indivisible**:
 * 1. La reasignación de tareas de la columna origen a la columna destino (con orderIndex contiguos).
 * 2. La emisión y persistencia de eventos inmutables de auditoría (TaskActivityEvent) por cada tarea reubicada.
 * 3. La eliminación de la columna origen del tablero y la recompactación secuencial contigua de orderIndex
 *    de las columnas restantes.
 *
 * Garantía todo-o-nada (ALL-OR-NOTHING):
 * - Si cualquier fase falla (incluyendo fallos tras registrar eventos de auditoría o durante la persistencia),
 *   la operación completa se revierte (rollback íntegro):
 *   - Ninguna tarea cambia de columna ni de orden.
 *   - Ningún evento de auditoría queda persistido ni huérfano.
 *   - La columna y el tablero conservan su estado original inalterado.
 *
 * Implementaciones:
 * - En memoria: InMemoryBoardColumnDeletionAdapter con gestión de snapshots, compensación determinista
 *   y exclusión mutua para concurrencia.
 * - En PostgreSQL: PostgresBoardColumnDeletionAdapter dentro de una transacción SQL (BEGIN ... COMMIT / ROLLBACK).
 */
export interface BoardColumnDeletionPort {
  executeAtomicColumnDeletion(
    params: DeleteColumnTransactionParams,
  ): Promise<DeleteColumnTransactionResult>;
}
