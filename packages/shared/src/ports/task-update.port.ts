/**
 * Parámetros y puerto del dominio para la actualización atómica y transaccional
 * de campos editables de tareas y su evento de auditoría UPDATED (IS488).
 * Alineado con el modelo canónico y especificación OpenSpec boards-tasks.
 */

import type { Task, TaskPriority } from './task-repository.port.js';
import type { TaskActivityEvent } from './task-activity-repository.port.js';

/**
 * Parche con los campos editables de la tarea.
 * Los campos omitidos (undefined) conservan su valor actual en la entidad.
 */
export interface UpdateTaskPatch {
  /** Nuevo título (3 a 140 caracteres). */
  title?: string;
  /** Nueva descripción; cadena vacía o espacios la vacía (undefined). */
  description?: string;
  /** Nuevo nivel de prioridad. */
  priority?: TaskPriority;
  /** Nueva fecha límite ISO-8601 UTC; null la vacía (undefined). */
  dueDate?: string | null;
  /** Lista actualizada de etiquetas (máximo 5). */
  labels?: string[];
  /** Lista actualizada de UUIDs de miembros asignados (deben ser miembros activos). */
  assigneeIds?: string[];
}

/**
 * Parámetros para la ejecución atómica de la actualización de una tarea y su evento UPDATED.
 */
export interface UpdateTaskTransactionParams {
  /** UUID de la tarea a actualizar. */
  taskId: string;
  /** UUID del proyecto autorizado al que pertenece la tarea. */
  projectId: string;
  /** UUID del usuario que ejecuta la acción (actor para la auditoría). */
  actorId: string;
  /** Parche con los campos modificados. */
  patch: UpdateTaskPatch;
  /** Marca temporal ISO-8601 UTC provista por SystemClockPort. */
  timestamp: string;
}

/**
 * Resultado devuelto tras la persistencia atómica de la actualización.
 */
export interface UpdateTaskTransactionResult {
  task: Task;
  activity: TaskActivityEvent | null;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la actualización
 * atómica de campos de una tarea y su correspondiente evento inmutable (UPDATED).
 *
 * Garantías:
 * - Re-lectura de la tarea dentro de la exclusión mutua para evitar sobrescribir movimientos o cambios concurrentes.
 * - Actualización parcial: campos omitidos conservan su valor íntegro.
 * - Semántica de vaciado: description vacía o dueDate null limpian los campos a undefined.
 * - Idempotencia (no-op): si los valores resultantes son idénticos a los actuales, no se altera updatedAt ni se emite UPDATED.
 * - Todo cambio real actualiza updatedAt con la marca de tiempo provista y emite un único evento UPDATED.
 * - Publicación atómica única (todo-o-nada) bajo el mutex compartido.
 */
export interface TaskUpdatePort {
  executeAtomicTaskUpdate(
    params: UpdateTaskTransactionParams,
  ): Promise<UpdateTaskTransactionResult>;
}
