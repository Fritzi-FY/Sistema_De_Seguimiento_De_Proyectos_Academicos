import type {
  TaskCreationPort,
  TaskUpdatePort,
  TaskMovePort,
  BoardColumnDeletionPort,
} from '@is488/shared';
import { KanbanSqlStore } from './kanban-store.js';
import { InMemoryTaskCreationAdapter } from '../adapters/repositories/in-memory-task-creation.adapter.js';
import { InMemoryTaskUpdateAdapter } from '../adapters/repositories/in-memory-task-update.adapter.js';
import { InMemoryTaskMoveAdapter } from '../adapters/repositories/in-memory-task-move.adapter.js';
import { InMemoryBoardColumnDeletionAdapter } from '../adapters/repositories/in-memory-board-column-deletion.adapter.js';

export class PostgresqlTaskCreationAdapter implements TaskCreationPort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  executeAtomicTaskCreation(params: Parameters<TaskCreationPort['executeAtomicTaskCreation']>[0]) {
    return this.store.mutate(params.projectId, params.creatorId, params.assigneeIds, (storage) =>
      new InMemoryTaskCreationAdapter(storage).executeAtomicTaskCreation(params),
    );
  }
}
export class PostgresqlTaskUpdateAdapter implements TaskUpdatePort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  executeAtomicTaskUpdate(params: Parameters<TaskUpdatePort['executeAtomicTaskUpdate']>[0]) {
    return this.store.mutate(
      params.projectId,
      params.actorId,
      params.patch.assigneeIds ?? [],
      (storage) => new InMemoryTaskUpdateAdapter(storage).executeAtomicTaskUpdate(params),
    );
  }
}
export class PostgresqlTaskMoveAdapter implements TaskMovePort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  executeAtomicTaskMove(params: Parameters<TaskMovePort['executeAtomicTaskMove']>[0]) {
    return this.store.mutate(params.projectId, params.actorId, [], (storage) =>
      new InMemoryTaskMoveAdapter(storage).executeAtomicTaskMove(params),
    );
  }
}
export class PostgresqlBoardColumnDeletionAdapter implements BoardColumnDeletionPort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  executeAtomicColumnDeletion(
    params: Parameters<BoardColumnDeletionPort['executeAtomicColumnDeletion']>[0],
  ) {
    return this.store.mutate(params.projectId, params.actorId, [], (storage) =>
      new InMemoryBoardColumnDeletionAdapter(storage).executeAtomicColumnDeletion(params),
    );
  }
}
