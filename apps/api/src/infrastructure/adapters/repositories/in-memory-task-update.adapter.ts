import type {
  TaskUpdatePort,
  UpdateTaskTransactionParams,
  UpdateTaskTransactionResult,
  Task,
  TaskActivityEvent,
} from '@is488/shared';
import { TaskNotFoundError } from '@is488/shared';
import {
  type InMemoryKanbanProjectStorage,
  cloneTask,
  cloneEvent,
} from './in-memory-kanban-project.storage.js';

/**
 * Adaptador en memoria para la actualización atómica y coordinada de campos editables
 * de una tarea y su correspondiente evento inmutable de actividad UPDATED.
 *
 * Garantiza:
 * - Mutex por proyecto (ProjectLockManager) para serializar operaciones concurrentes.
 * - Re-lectura de la tarea dentro de la exclusión mutua para evitar sobreescritura de movimientos concurrentes.
 * - Preparación de estado aislado sobre snapshot Copy-On-Write.
 * - Publicación atómica única (todo-o-nada) mediante commitSnapshot.
 * - Actualización parcial: campos omitidos conservan su valor íntegro.
 * - Semántica de vaciado: description vacía o dueDate null limpian los campos a undefined.
 * - Detección de no-op (idempotente): si los valores no cambian realmente, no altera updatedAt ni emite UPDATED.
 * - Todo cambio real actualiza updatedAt con la marca de tiempo provista y emite exactamente un evento UPDATED.
 * - Sin compensación manual ni efectos parciales ante fallos.
 */
export class InMemoryTaskUpdateAdapter implements TaskUpdatePort {
  private faultInjectionPoint: 'before_publish' | null = null;

  constructor(private readonly storage: InMemoryKanbanProjectStorage) {}

  /**
   * Configura un punto de inyección de fallos controlado para pruebas adversariales.
   * Permite simular fallos después de preparar tarea y evento, antes de la publicación atómica.
   */
  setFaultInjectionPoint(point: 'before_publish' | null): void {
    this.faultInjectionPoint = point;
  }

  async executeAtomicTaskUpdate(
    params: UpdateTaskTransactionParams,
  ): Promise<UpdateTaskTransactionResult> {
    // 1. Verificación previa de pertenencia de la tarea al proyecto (aislamiento horizontal)
    const lookup = this.storage.findProjectStateByTaskId(params.taskId);
    if (!lookup) {
      throw Object.assign(new TaskNotFoundError(params.taskId), { statusCode: 404 });
    }

    if (lookup.projectId !== params.projectId) {
      throw Object.assign(
        new Error(`La tarea '${params.taskId}' no pertenece al proyecto '${params.projectId}'`),
        { statusCode: 404 },
      );
    }

    return this.storage.lockManager.withLock(params.projectId, async () => {
      // 2. Re-leer dentro del lock para obtener el estado más reciente (evita TOCTOU con movimientos concurrentes)
      const snapshot = this.storage.getSnapshot(params.projectId);

      const taskIdx = snapshot.tasks.findIndex((t) => t.id === params.taskId);
      if (taskIdx === -1) {
        throw Object.assign(new TaskNotFoundError(params.taskId), { statusCode: 404 });
      }

      const currentTask = snapshot.tasks[taskIdx]!;

      // 3. Aplicar semántica de actualización parcial y vaciado
      const nextTitle = params.patch.title !== undefined ? params.patch.title : currentTask.title;

      let nextDescription: string | undefined = currentTask.description;
      if (params.patch.description !== undefined) {
        nextDescription =
          params.patch.description.trim() === '' ? undefined : params.patch.description;
      }

      const nextPriority =
        params.patch.priority !== undefined ? params.patch.priority : currentTask.priority;

      let nextDueDate: string | undefined = currentTask.dueDate;
      if (params.patch.dueDate !== undefined) {
        nextDueDate = params.patch.dueDate === null ? undefined : params.patch.dueDate;
      }

      const nextLabels =
        params.patch.labels !== undefined ? [...params.patch.labels] : [...currentTask.labels];

      const nextAssigneeIds =
        params.patch.assigneeIds !== undefined
          ? [...params.patch.assigneeIds]
          : [...currentTask.assigneeIds];

      // 4. Detección de cambios reales (idempotencia / no-op)
      const hasTitleChange = nextTitle !== currentTask.title;
      const hasDescChange = nextDescription !== currentTask.description;
      const hasPriorityChange = nextPriority !== currentTask.priority;
      const hasDueDateChange = nextDueDate !== currentTask.dueDate;
      const hasLabelsChange =
        nextLabels.length !== currentTask.labels.length ||
        nextLabels.some((l, i) => l !== currentTask.labels[i]);
      const hasAssigneesChange =
        nextAssigneeIds.length !== currentTask.assigneeIds.length ||
        nextAssigneeIds.some((a, i) => a !== currentTask.assigneeIds[i]);

      const hasRealChanges =
        hasTitleChange ||
        hasDescChange ||
        hasPriorityChange ||
        hasDueDateChange ||
        hasLabelsChange ||
        hasAssigneesChange;

      // Si no hay cambios reales: no-op idempotente
      if (!hasRealChanges) {
        return { task: cloneTask(currentTask), activity: null };
      }

      // 5. Construcción de la tarea actualizada
      // Preserva rigurosamente id, projectId, creatorId, columnId, orderIndex y createdAt
      const updatedTask: Task = {
        ...currentTask,
        title: nextTitle,
        description: nextDescription,
        priority: nextPriority,
        dueDate: nextDueDate,
        labels: nextLabels,
        assigneeIds: nextAssigneeIds,
        updatedAt: params.timestamp,
      };

      const details: Record<string, unknown> = {};
      if (hasTitleChange) details.title = { from: currentTask.title, to: nextTitle };
      if (hasDescChange)
        details.description = { from: currentTask.description, to: nextDescription };
      if (hasPriorityChange) details.priority = { from: currentTask.priority, to: nextPriority };
      if (hasDueDateChange) details.dueDate = { from: currentTask.dueDate, to: nextDueDate };
      if (hasLabelsChange) details.labels = { from: currentTask.labels, to: nextLabels };
      if (hasAssigneesChange)
        details.assigneeIds = { from: currentTask.assigneeIds, to: nextAssigneeIds };

      const activityEvent: TaskActivityEvent = {
        id: crypto.randomUUID(),
        taskId: params.taskId,
        projectId: params.projectId,
        actorId: params.actorId,
        action: 'UPDATED',
        toColumnId: currentTask.columnId,
        details,
        createdAt: params.timestamp,
      };

      snapshot.tasks[taskIdx] = updatedTask;
      snapshot.events.push(activityEvent);

      // Inyección de fallos controlada para pruebas adversariales
      if (this.faultInjectionPoint === 'before_publish') {
        throw new Error(
          'Simulated failure after preparing updated task and audit before publishing atomic state',
        );
      }

      // 6. Publicación atómica única (todo-o-nada)
      this.storage.commitSnapshot(params.projectId, snapshot);

      return {
        task: cloneTask(updatedTask),
        activity: cloneEvent(activityEvent),
      };
    });
  }
}
