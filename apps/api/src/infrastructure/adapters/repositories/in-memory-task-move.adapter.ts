import type {
  TaskMovePort,
  MoveTaskTransactionParams,
  MoveTaskTransactionResult,
  TaskActivityEvent,
} from '@is488/shared';
import { TaskNotFoundError, BoardColumnNotFoundError } from '@is488/shared';
import {
  type InMemoryKanbanProjectStorage,
  cloneTask,
  cloneEvent,
} from './in-memory-kanban-project.storage.js';

/**
 * Adaptador en memoria para el movimiento atómico y coordinado de una tarea
 * y su correspondiente evento inmutable de actividad MOVED.
 *
 * Garantiza:
 * - Mutex por proyecto (ProjectLockManager) para serializar operaciones concurrentes.
 * - Preparación de estado aislado sobre snapshot Copy-On-Write.
 * - Publicación atómica única (todo-o-nada) mediante commitSnapshot.
 * - Reordenamiento contiguo y sin índices duplicados en columna origen y destino.
 * - Captura de sourceColumnId y sourceIndex antes de cualquier mutación.
 * - Comportamiento no-op idempotente: si la posición efectiva no cambia, no se emite MOVED,
 *   no se modifica updatedAt ni se publica snapshot.
 * - Todo cambio real de posición (intra o inter-columna) genera exactamente un evento MOVED
 *   y actualiza updatedAt con la marca de tiempo provista.
 * - Clamp de destinationIndex superior al máximo al final de la columna destino
 *   (calculado sobre la lista destino excluyendo la tarea movida).
 * - Sin compensación manual ni efectos parciales ante fallos.
 */
export class InMemoryTaskMoveAdapter implements TaskMovePort {
  private faultInjectionPoint: 'before_publish' | null = null;

  constructor(private readonly storage: InMemoryKanbanProjectStorage) {}

  /**
   * Configura un punto de inyección de fallos controlado para pruebas adversariales.
   * Permite simular fallos después de preparar el nuevo estado y antes de la publicación atómica.
   */
  setFaultInjectionPoint(point: 'before_publish' | null): void {
    this.faultInjectionPoint = point;
  }

  async executeAtomicTaskMove(
    params: MoveTaskTransactionParams,
  ): Promise<MoveTaskTransactionResult> {
    // Localizar el proyecto que contiene la tarea ANTES de adquirir el lock
    // (findProjectStateByTaskId hace lectura sin lock).
    const lookup = this.storage.findProjectStateByTaskId(params.taskId);
    if (!lookup) {
      throw Object.assign(new TaskNotFoundError(params.taskId), { statusCode: 404 });
    }

    // Verificar que la tarea pertenece al proyecto autorizado (aislamiento horizontal).
    if (lookup.projectId !== params.projectId) {
      throw Object.assign(
        new Error(`La tarea '${params.taskId}' no pertenece al proyecto '${params.projectId}'`),
        { statusCode: 404 },
      );
    }

    return this.storage.lockManager.withLock(params.projectId, async () => {
      // Re-leer dentro del lock para evitar TOCTOU
      const snapshot = this.storage.getSnapshot(params.projectId);

      // 1. Revalidar existencia de la tarea dentro del lock
      const taskIdx = snapshot.tasks.findIndex((t) => t.id === params.taskId);
      if (taskIdx === -1) {
        throw Object.assign(new TaskNotFoundError(params.taskId), { statusCode: 404 });
      }

      // 2. Revalidar que la columna destino pertenece al tablero de este proyecto
      if (
        !snapshot.board ||
        !snapshot.board.columns.some((c) => c.id === params.destinationColumnId)
      ) {
        throw Object.assign(new BoardColumnNotFoundError(params.destinationColumnId), {
          statusCode: 400,
        });
      }

      const task = snapshot.tasks[taskIdx]!;

      // 1. Capturar sourceColumnId y sourceIndex antes de modificar la tarea
      const sourceColumnId = task.columnId;
      const sourceIndex = task.orderIndex;

      if (sourceColumnId === params.destinationColumnId) {
        // --- Reordenamiento dentro de la misma columna ---
        const siblings = snapshot.tasks
          .filter((t) => t.columnId === sourceColumnId && t.id !== params.taskId)
          .sort((a, b) => a.orderIndex - b.orderIndex);

        // Posición sobre la lista destino excluyendo la tarea movida
        const effectiveIndex = Math.min(params.destinationIndex, siblings.length);

        // Posición actual de la tarea en la columna (cuántos hermanos preceden a sourceIndex)
        const currentEffectiveIndex = siblings.filter((t) => t.orderIndex < sourceIndex).length;

        // Misma columna y misma posición efectiva: no-op, sin evento, sin cambio de updatedAt ni publicación
        if (currentEffectiveIndex === effectiveIndex) {
          return { task: cloneTask(task), activity: null };
        }

        // 2. En reordenamientos internos reales, prepara también MOVED y updatedAt
        task.orderIndex = effectiveIndex;
        task.updatedAt = params.timestamp;

        siblings.splice(effectiveIndex, 0, task);
        siblings.forEach((t, i) => {
          t.orderIndex = i;
        });

        // 3. Usa el índice original en details.fromIndex y el efectivo en toIndex
        const activityEvent: TaskActivityEvent = {
          id: crypto.randomUUID(),
          taskId: params.taskId,
          projectId: params.projectId,
          actorId: params.actorId,
          action: 'MOVED',
          fromColumnId: sourceColumnId,
          toColumnId: sourceColumnId,
          details: {
            fromIndex: sourceIndex,
            toIndex: effectiveIndex,
          },
          createdAt: params.timestamp,
        };
        snapshot.events.push(activityEvent);

        // Mantén el fallo before_publish después de preparar ambos
        if (this.faultInjectionPoint === 'before_publish') {
          throw new Error(
            'Simulated failure after preparing move state and before publishing atomic state',
          );
        }

        // 4. Publica tareas y evento juntos, una sola vez, bajo el mutex compartido
        this.storage.commitSnapshot(params.projectId, snapshot);

        return { task: cloneTask(task), activity: cloneEvent(activityEvent) };
      } else {
        // --- Movimiento entre columnas diferentes ---

        // Reordenar columna origen excluyendo la tarea trasladada
        const sourceColTasks = snapshot.tasks
          .filter((t) => t.columnId === sourceColumnId && t.id !== params.taskId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        sourceColTasks.forEach((t, i) => {
          t.orderIndex = i;
        });

        // Reordenar columna destino excluyendo la tarea trasladada (por seguridad)
        const destColTasks = snapshot.tasks
          .filter((t) => t.columnId === params.destinationColumnId && t.id !== params.taskId)
          .sort((a, b) => a.orderIndex - b.orderIndex);

        // Clamp de destinationIndex superior al máximo sobre la lista destino excluyendo la tarea movida
        const effectiveIndex = Math.min(params.destinationIndex, destColTasks.length);

        task.columnId = params.destinationColumnId;
        task.orderIndex = effectiveIndex;
        task.updatedAt = params.timestamp;

        destColTasks.splice(effectiveIndex, 0, task);
        destColTasks.forEach((t, i) => {
          t.orderIndex = i;
        });

        // 3. Usa el índice original en details.fromIndex y el efectivo en toIndex
        const activityEvent: TaskActivityEvent = {
          id: crypto.randomUUID(),
          taskId: params.taskId,
          projectId: params.projectId,
          actorId: params.actorId,
          action: 'MOVED',
          fromColumnId: sourceColumnId,
          toColumnId: params.destinationColumnId,
          details: {
            fromIndex: sourceIndex,
            toIndex: effectiveIndex,
          },
          createdAt: params.timestamp,
        };
        snapshot.events.push(activityEvent);

        // Mantén el fallo before_publish después de preparar ambos
        if (this.faultInjectionPoint === 'before_publish') {
          throw new Error(
            'Simulated failure after preparing move state and before publishing atomic state',
          );
        }

        // 4. Publica tareas y evento juntos, una sola vez, bajo el mutex compartido
        this.storage.commitSnapshot(params.projectId, snapshot);

        return { task: cloneTask(task), activity: cloneEvent(activityEvent) };
      }
    });
  }
}
