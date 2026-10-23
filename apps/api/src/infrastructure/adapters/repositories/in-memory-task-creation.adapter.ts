import type {
  TaskCreationPort,
  CreateTaskTransactionParams,
  CreateTaskTransactionResult,
  Task,
  TaskActivityEvent,
} from '@is488/shared';
import { BoardColumnNotFoundError } from '@is488/shared';
import {
  type InMemoryKanbanProjectStorage,
  cloneTask,
  cloneEvent,
} from './in-memory-kanban-project.storage.js';

/**
 * Adaptador en memoria para la creación atómica y coordinada de tareas
 * y su correspondiente evento inmutable de actividad CREATED.
 *
 * Garantiza:
 * - Mutex por proyecto (ProjectLockManager) para evitar condiciones de carrera.
 * - Preparación de estado aislado sobre snapshot Copy-On-Write.
 * - Publicación atómica única (todo-o-nada) mediante commitSnapshot sin dos publicaciones.
 * - Sin compensación manual ni fases intermedias observables.
 * - Cálculo secuencial de orderIndex dentro de la sección crítica.
 */
export class InMemoryTaskCreationAdapter implements TaskCreationPort {
  private faultInjectionPoint: 'before_publish' | null = null;

  constructor(private readonly storage: InMemoryKanbanProjectStorage) {}

  /**
   * Configura un punto de inyección de fallos controlado para pruebas adversariales.
   * Permite simular fallos después de preparar tarea y evento, antes de la publicación atómica.
   */
  setFaultInjectionPoint(point: 'before_publish' | null): void {
    this.faultInjectionPoint = point;
  }

  async executeAtomicTaskCreation(
    params: CreateTaskTransactionParams,
  ): Promise<CreateTaskTransactionResult> {
    return this.storage.lockManager.withLock(params.projectId, async () => {
      const snapshot = this.storage.getSnapshot(params.projectId);

      // 1. Validar que el tablero existe y que la columna pertenece al tablero del proyecto
      if (!snapshot.board || !snapshot.board.columns.some((c) => c.id === params.columnId)) {
        throw Object.assign(new BoardColumnNotFoundError(params.columnId), {
          statusCode: 404,
        });
      }

      // 2. Calcular orderIndex contiguo dentro de la exclusión mutua
      const tasksInColumn = snapshot.tasks.filter((t) => t.columnId === params.columnId);
      const nextOrderIndex =
        tasksInColumn.length === 0 ? 0 : Math.max(...tasksInColumn.map((t) => t.orderIndex)) + 1;

      const taskId = params.id ?? crypto.randomUUID();
      const newTask: Task = {
        id: taskId,
        projectId: params.projectId,
        columnId: params.columnId,
        title: params.title,
        description: params.description,
        priority: params.priority,
        orderIndex: nextOrderIndex,
        dueDate: params.dueDate,
        labels: [...params.labels],
        creatorId: params.creatorId,
        assigneeIds: [...params.assigneeIds],
        createdAt: params.timestamp,
        updatedAt: params.timestamp,
      };

      const activityEvent: TaskActivityEvent = {
        id: crypto.randomUUID(),
        taskId,
        projectId: params.projectId,
        actorId: params.creatorId,
        action: 'CREATED',
        toColumnId: params.columnId,
        details: {
          title: params.title,
          priority: params.priority,
          assigneeIds: [...params.assigneeIds],
        },
        createdAt: params.timestamp,
      };

      // 3. Preparación de estado aislado Copy-On-Write
      snapshot.tasks.push(newTask);
      snapshot.events.push(activityEvent);

      // Inyección de fallo adversarial DESPUÉS de preparar tarea/evento y ANTES de publicar
      if (this.faultInjectionPoint === 'before_publish') {
        throw new Error(
          'Simulated failure after preparing task and event before publishing atomic state',
        );
      }

      // 4. Publicación atómica única (todo-o-nada)
      this.storage.commitSnapshot(params.projectId, snapshot);

      return {
        task: cloneTask(newTask),
        activity: cloneEvent(activityEvent),
      };
    });
  }
}
