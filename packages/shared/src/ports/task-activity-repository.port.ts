/**
 * Entidades y puerto del dominio para el registro inmutable de actividades y auditoría de tareas (IS488).
 * Alineado con el modelo de datos canónico (docs/04-data-model.md §4.8 task_activities) y OpenSpec oards-tasks.
 */

export type TaskActivityAction =
  'CREATED' | 'UPDATED' | 'MOVED' | 'COLUMN_DELETED_REALLOCATION' | 'DELETED';

/**
 * Entidad de dominio representativa de un Evento de Actividad inmutable sobre una tarea.
 * Registra trazabilidad de movimientos, cambios de estado y modificaciones de autoría.
 */
export interface TaskActivityEvent {
  /** UUID v4 identificador único del evento. */
  id: string;
  /** UUID de la tarea sobre la cual ocurrió la acción. */
  taskId: string;
  /** UUID del proyecto al que pertenece la tarea (facilita indexación y consultas de auditoría). */
  projectId: string;
  /** UUID del usuario responsable que ejecutó la acción. */
  actorId: string;
  /** Acción ejecutada. */
  action: TaskActivityAction;
  /** Columna origen en transiciones o traslados. */
  fromColumnId?: string;
  /** Columna destino en transiciones o traslados. */
  toColumnId?: string;
  /** Metadatos estructurados adicionales del cambio (campos modificados, snapshot previo, etc.). */
  details?: Record<string, unknown>;
  /** Marca de tiempo ISO-8601 UTC en que se registró el evento inmutable. */
  createdAt: string;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la persistencia y consulta
 * de eventos de auditoría y actividad sobre tareas.
 */
export interface TaskActivityRepositoryPort {
  /**
   * Persiste un evento inmutable de actividad.
   */
  recordEvent(
    event: Omit<TaskActivityEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<TaskActivityEvent>;

  /**
   * Persiste en lote múltiples eventos de actividad (p. ej. en reasignación masiva por eliminación de columna).
   */
  recordEventsBatch(
    events: Array<
      Omit<TaskActivityEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
    >,
  ): Promise<TaskActivityEvent[]>;

  /**
   * Retorna el historial cronológico de eventos de una tarea (orden descendente por createdAt).
   */
  findByTaskId(taskId: string): Promise<TaskActivityEvent[]>;

  /**
   * Retorna el historial cronológico de actividades de todas las tareas de un proyecto.
   */
  findByProjectId(projectId: string): Promise<TaskActivityEvent[]>;
}
