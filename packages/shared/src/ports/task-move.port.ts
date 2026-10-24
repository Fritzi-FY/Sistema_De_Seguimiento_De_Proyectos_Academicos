/**
 * Parámetros y puerto del dominio para el movimiento atómico y transaccional
 * de tareas entre columnas (o dentro de la misma columna) y su evento de auditoría
 * inmutable MOVED (IS488).
 * Alineado con el modelo canónico y especificación OpenSpec boards-tasks.
 */

import type { Task } from './task-repository.port.js';
import type { TaskActivityEvent } from './task-activity-repository.port.js';

/**
 * Parámetros para la ejecución atómica y coordinada de un movimiento de tarea
 * y su evento inmutable MOVED.
 */
export interface MoveTaskTransactionParams {
  /** UUID de la tarea a mover. */
  taskId: string;
  /** UUID del proyecto al que pertenece la tarea (autorización contextual verificada por el caso de uso). */
  projectId: string;
  /** UUID de la columna destino (puede coincidir con la columna origen para reordenamiento). */
  destinationColumnId: string;
  /**
   * Posición secuencial 0-indexed deseada dentro de la columna destino.
   * Si excede la longitud de la columna destino (excluyendo la tarea movida), se clampea al final.
   */
  destinationIndex: number;
  /** UUID del usuario que solicita el movimiento (actor para el evento de auditoría). */
  actorId: string;
  /** Marca temporal ISO-8601 UTC provista por SystemClockPort. */
  timestamp: string;
}

/**
 * Resultado devuelto tras la persistencia atómica del movimiento y su evento de auditoría.
 */
export interface MoveTaskTransactionResult {
  task: Task;
  activity: TaskActivityEvent | null;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para el movimiento atómico
 * y coordinado de una tarea y su evento inmutable de actividad (MOVED).
 *
 * Garantías:
 * - Publicación atómica única (todo-o-nada): sin dos publicaciones ni fases intermedias.
 * - Reordenamiento contiguo en columna origen y destino dentro de la exclusión mutua.
 * - Sin compensación manual ni efectos parciales ante fallos.
 * - Si origen y destino coinciden en columnId e índice efectivo → operación idempotente (no-op),
 *   sin modificar datos ni updatedAt, sin publicar y sin emitir evento MOVED.
 * - Todo cambio real de posición (inter o intra-columna) genera exactamente un evento MOVED y actualiza updatedAt.
 * - Si destinationIndex excede la longitud de la columna destino (excluyendo la tarea movida), se clampea al final.
 */
export interface TaskMovePort {
  executeAtomicTaskMove(params: MoveTaskTransactionParams): Promise<MoveTaskTransactionResult>;
}
