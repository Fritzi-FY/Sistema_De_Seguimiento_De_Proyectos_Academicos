/**
 * Entidades, parámetros y puerto del dominio para la creación atómica y transaccional
 * de tareas y su evento de auditoría inicial CREATED (IS488).
 * Alineado con el modelo canónico y especificación OpenSpec boards-tasks.
 */

import type { Task, TaskPriority } from './task-repository.port.js';
import type { TaskActivityEvent } from './task-activity-repository.port.js';

/**
 * Parámetros para la creación atómica y coordinada de una tarea y su evento inmutable CREATED.
 */
export interface CreateTaskTransactionParams {
  /** UUID opcional pregenerado de la tarea. */
  id?: string;
  /** UUID del proyecto al que pertenece la tarea. */
  projectId: string;
  /** UUID de la columna del tablero donde reside la tarea. */
  columnId: string;
  /** Título de la tarea (validado 3 a 140 caracteres). */
  title: string;
  /** Descripción opcional de la tarea. */
  description?: string;
  /** Prioridad de la tarea. */
  priority: TaskPriority;
  /** Fecha límite opcional en formato ISO-8601. */
  dueDate?: string;
  /** Etiquetas asociadas a la tarea. */
  labels: string[];
  /** UUID del usuario creador (actor que ejecuta la acción). */
  creatorId: string;
  /** UUIDs de miembros asignados (deben ser miembros activos del proyecto). */
  assigneeIds: string[];
  /** Marca temporal ISO-8601 UTC provista por SystemClockPort. */
  timestamp: string;
}

/**
 * Resultado devuelto tras la persistencia atómica de la tarea y su evento de actividad.
 */
export interface CreateTaskTransactionResult {
  task: Task;
  activity: TaskActivityEvent;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la creación atómica
 * y coordinada de tareas y su evento inmutable de actividad (`CREATED`).
 *
 * Garantías:
 * - Publicación atómica única (todo-o-nada): sin dos publicaciones ni fases intermedias.
 * - Cálculo del `orderIndex` contiguo dentro de la exclusión mutua para evitar colisiones concurrentes.
 * - Sin compensación manual ni efectos parciales ante fallos.
 */
export interface TaskCreationPort {
  executeAtomicTaskCreation(
    params: CreateTaskTransactionParams,
  ): Promise<CreateTaskTransactionResult>;
}
