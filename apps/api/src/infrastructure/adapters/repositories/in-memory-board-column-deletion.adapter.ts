import type {
  Board,
  BoardRepositoryPort,
  TaskRepositoryPort,
  TaskActivityRepositoryPort,
  TaskActivityEvent,
  BoardColumnDeletionPort,
  DeleteColumnTransactionParams,
  DeleteColumnTransactionResult,
  Task,
} from '@is488/shared';
import {
  BoardNotFoundError,
  BoardColumnNotFoundError,
  LastColumnDeletionError,
  ColumnNotEmptyError,
  InvalidDestinationColumnError,
} from '@is488/shared';
import type { ProjectLockManager, ProjectKanbanState } from './in-memory-kanban-project.storage.js';
import { InMemoryKanbanProjectStorage } from './in-memory-kanban-project.storage.js';
import { InMemoryBoardRepository } from './in-memory-board.repository.js';
import { InMemoryTaskRepository } from './in-memory-task.repository.js';
import { InMemoryTaskActivityRepository } from './in-memory-task-activity.repository.js';

/**
 * Adaptador de infraestructura en memoria para la eliminacion atomica y coordinada
 * de columnas Kanban, reasignacion de tareas y emision de eventos de auditoria.
 *
 * Implementa BoardColumnDeletionPort con garantias transaccionales todo-o-nada (ALL-OR-NOTHING):
 * - Almacenamiento compartido por proyecto (InMemoryKanbanProjectStorage) para tablero, tareas y eventos.
 * - Exclusion mutua (mutex) compartida por proyecto (ProjectLockManager) para serializar escrituras.
 * - Preparacion de estado aislado: validaciones, reasignacion y ordenamiento se calculan en un snapshot
 *   aislado sin mutar el almacenamiento compartido.
 * - Publicacion UNICA y ATOMICA: una sola sustitucion sincrona de referencia publica el nuevo tablero,
 *   las tareas reubicadas y los eventos de auditoria de manera indivisible.
 *   No se realizan escrituras posteriores ni publicaciones por partes.
 * - Sin compensacion manual: si ocurre un fallo antes de publicar, el estado compartido y la auditoria
 *   preexistente permanecen 100% intactos.
 */
export class InMemoryBoardColumnDeletionAdapter implements BoardColumnDeletionPort {
  public readonly storage: InMemoryKanbanProjectStorage;
  private faultInjectionPoint: 'before_publish' | null = null;
  private onPreparationHook: (() => Promise<void>) | null = null;

  constructor(
    storageOrBoardRepo?: InMemoryKanbanProjectStorage | BoardRepositoryPort,
    _taskRepository?: TaskRepositoryPort,
    _taskActivityRepository?: TaskActivityRepositoryPort,
    lockManager?: ProjectLockManager,
  ) {
    if (storageOrBoardRepo instanceof InMemoryKanbanProjectStorage) {
      this.storage = storageOrBoardRepo;
    } else if (storageOrBoardRepo instanceof InMemoryBoardRepository) {
      this.storage = storageOrBoardRepo.storage;
    } else if (_taskRepository instanceof InMemoryTaskRepository) {
      this.storage = _taskRepository.storage;
    } else if (_taskActivityRepository instanceof InMemoryTaskActivityRepository) {
      this.storage = _taskActivityRepository.storage;
    } else {
      this.storage = new InMemoryKanbanProjectStorage(lockManager);
    }
  }

  /**
   * Configura un punto de inyeccion de fallos controlado para pruebas adversariales.
   * Permite simular fallos antes de la publicacion sin haber tocado el almacenamiento compartido.
   */
  setFaultInjectionPoint(point: 'before_publish' | null): void {
    this.faultInjectionPoint = point;
  }

  /**
   * Configura un hook durante la fase de preparacion aislada para probar concurrencia
   * e intercalados controlados sin recurrir a sleeps.
   */
  setOnPreparationHook(hook: (() => Promise<void>) | null): void {
    this.onPreparationHook = hook;
  }

  async executeAtomicColumnDeletion(
    params: DeleteColumnTransactionParams,
  ): Promise<DeleteColumnTransactionResult> {
    return this.storage.lockManager.withLock(params.projectId, async () => {
      // 1. OBTENER SNAPSHOT AISLADO Y REVALIDAR PRECONDICIONES
      const snapshot = this.storage.getSnapshot(params.projectId);
      const board = snapshot.board;

      if (!board) {
        throw Object.assign(new BoardNotFoundError(params.projectId), { statusCode: 404 });
      }

      const columnExists = board.columns.some((c) => c.id === params.columnId);
      if (!columnExists) {
        throw Object.assign(new BoardColumnNotFoundError(params.columnId), { statusCode: 404 });
      }

      if (board.columns.length <= 1) {
        throw Object.assign(new LastColumnDeletionError(board.id), { statusCode: 400 });
      }

      const sourceTasks = snapshot.tasks.filter((t) => t.columnId === params.columnId);

      if (sourceTasks.length > 0) {
        if (!params.targetColumnId) {
          throw Object.assign(new ColumnNotEmptyError(params.columnId, sourceTasks.length), {
            statusCode: 409,
          });
        }

        if (params.targetColumnId === params.columnId) {
          throw Object.assign(new InvalidDestinationColumnError(params.targetColumnId), {
            statusCode: 400,
          });
        }

        const targetExists = board.columns.some((c) => c.id === params.targetColumnId);
        if (!targetExists) {
          throw Object.assign(new InvalidDestinationColumnError(params.targetColumnId), {
            statusCode: 400,
          });
        }
      }

      // 2. PREPARACION DE ESTADO AISLADO (SIN MUTACIONES EN EL ALMACEN COMPARTIDO)
      if (this.onPreparationHook) {
        await this.onPreparationHook();
      }

      const sortedSourceTasks = [...sourceTasks].sort((a, b) => a.orderIndex - b.orderIndex);

      let stagedTasks: Task[] = [];
      let stagedEvents: TaskActivityEvent[] = [];

      if (sortedSourceTasks.length > 0 && params.targetColumnId) {
        const targetColumnId = params.targetColumnId;
        const existingTargetTasks = snapshot.tasks
          .filter((t) => t.columnId === targetColumnId)
          .sort((a, b) => a.orderIndex - b.orderIndex);
        const startIndex = existingTargetTasks.length;

        stagedTasks = sortedSourceTasks.map((t, i) => ({
          ...t,
          columnId: targetColumnId,
          orderIndex: startIndex + i,
          updatedAt: params.timestamp, // Preservar exactamente la marca de tiempo de la operacion
        }));

        stagedEvents = sortedSourceTasks.map((t) => ({
          id: crypto.randomUUID(),
          taskId: t.id,
          projectId: params.projectId,
          actorId: params.actorId,
          action: 'COLUMN_DELETED_REALLOCATION',
          fromColumnId: params.columnId,
          toColumnId: targetColumnId,
          details: {
            reason: params.reason ?? 'Reasignacion automatica por eliminacion de columna',
          },
          createdAt: params.timestamp, // Preservar exactamente la marca de tiempo de la operacion
        }));
      }

      const remainingColumns = board.columns
        .filter((c) => c.id !== params.columnId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((c, index) => ({
          ...c,
          orderIndex: index,
        }));

      const stagedBoard: Board = {
        ...board,
        columns: remainingColumns,
        updatedAt: params.timestamp,
      };

      // Inyeccion de fallo adversarial ANTES de publicar (el almacen compartido aun no ha sido tocado)
      if (this.faultInjectionPoint === 'before_publish') {
        throw new Error('Simulated failure before publishing atomic state');
      }

      // 3. PUBLICACION UNICA Y ATOMICA MEDIANTE SUSTITUCION SINCRONA DE REFERENCIA
      // No hay llamadas independientes a saveBoard, update ni recordEventsBatch.
      const stagedTaskMap = new Map(stagedTasks.map((t) => [t.id, t]));
      const nextTasks = snapshot.tasks.map((t) => stagedTaskMap.get(t.id) ?? t);

      const nextState: ProjectKanbanState = {
        board: stagedBoard,
        tasks: nextTasks,
        events: [...snapshot.events, ...stagedEvents],
        boardRevision: snapshot.boardRevision,
      };

      // Sustitucion sincrona unica de referencia:
      this.storage.commitSnapshot(params.projectId, nextState);

      return {
        deletedColumnId: params.columnId,
        migratedTasksCount: sortedSourceTasks.length,
      };
    });
  }
}
