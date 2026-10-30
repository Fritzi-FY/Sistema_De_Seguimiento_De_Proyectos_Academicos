import type {
  Board,
  BoardRepositoryPort,
  TaskRepositoryPort,
  TaskActivityRepositoryPort,
  TaskActivityEvent,
} from '@is488/shared';
import { currentSqlSession } from './session.js';
import { KanbanSqlStore, taskFromRow, eventFromRow, taskSelection } from './kanban-store.js';
import { PostgresqlTaskListAdapter } from './kanban-list.adapter.js';
import { InMemoryBoardRepository } from '../adapters/repositories/in-memory-board.repository.js';
import { InMemoryTaskRepository } from '../adapters/repositories/in-memory-task.repository.js';

export class PostgresqlBoardRepository implements BoardRepositoryPort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  async findByProjectId(projectId: string) {
    return (await this.store.board(projectId)).board;
  }
  async findById(id: string) {
    const row = (
      await currentSqlSession().query('SELECT project_id FROM public.boards WHERE id=$1', [id])
    ).rows[0];
    return row ? this.findByProjectId(row.project_id) : null;
  }
  async saveBoard(board: Board, expectedRevision?: number) {
    await this.store.mutate(board.projectId, undefined, [], async (storage, revision) => {
      if (revision && expectedRevision !== revision)
        throw Object.assign(new Error('Conflicto de concurrencia del tablero'), {
          statusCode: 409,
        });
      return new InMemoryBoardRepository(storage).saveBoard(
        board,
        revision ? storage.getBoardRevision(board.projectId) : undefined,
      );
    });
  }
  async findOrCreateDefaultBoard(projectId: string) {
    return this.store.mutate(projectId, undefined, [], (storage) =>
      new InMemoryBoardRepository(storage).findOrCreateDefaultBoard(projectId),
    );
  }
  async addColumn(...args: Parameters<BoardRepositoryPort['addColumn']>) {
    const project = await this.store.projectFor('board', args[0]);
    return this.store.mutate(project, undefined, [], (storage) =>
      new InMemoryBoardRepository(storage).addColumn(...args),
    );
  }
  async updateColumn(...args: Parameters<BoardRepositoryPort['updateColumn']>) {
    const project = await this.store.projectFor('column', args[0]);
    return this.store.mutate(project, undefined, [], (storage) =>
      new InMemoryBoardRepository(storage).updateColumn(...args),
    );
  }
  async deleteColumn(...args: Parameters<BoardRepositoryPort['deleteColumn']>) {
    const project = await this.store.projectFor('column', args[0]);
    return this.store.mutate(project, undefined, [], (storage) =>
      new InMemoryBoardRepository(storage).deleteColumn(...args),
    );
  }
  async reorderColumns(...args: Parameters<BoardRepositoryPort['reorderColumns']>) {
    const project = await this.store.projectFor('board', args[0]);
    return this.store.mutate(project, undefined, [], (storage) =>
      new InMemoryBoardRepository(storage).reorderColumns(...args),
    );
  }
}

export class PostgresqlTaskRepository implements TaskRepositoryPort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  async create(...args: Parameters<TaskRepositoryPort['create']>) {
    return this.store.mutate(args[0].projectId, args[0].creatorId, args[0].assigneeIds, (storage) =>
      new InMemoryTaskRepository(storage).create(...args),
    );
  }
  async findById(id: string) {
    const row = (
      await currentSqlSession().query(
        `SELECT ${taskSelection} FROM public.tasks t WHERE id=$1 AND NOT deleted`,
        [id],
      )
    ).rows[0];
    return row ? taskFromRow(row) : null;
  }
  async findByProjectId(projectId: string) {
    return (
      await currentSqlSession().query(
        `SELECT ${taskSelection} FROM public.tasks t WHERE project_id=$1 AND NOT deleted ORDER BY column_id,order_index,created_at`,
        [projectId],
      )
    ).rows.map(taskFromRow);
  }
  async findByColumnId(columnId: string) {
    return (
      await currentSqlSession().query(
        `SELECT ${taskSelection} FROM public.tasks t WHERE column_id=$1 AND NOT deleted ORDER BY order_index`,
        [columnId],
      )
    ).rows.map(taskFromRow);
  }
  async update(...args: Parameters<TaskRepositoryPort['update']>) {
    const project = await this.store.projectFor('task', args[0]);
    return this.store.mutate(project, undefined, args[1].assigneeIds ?? [], (storage) =>
      new InMemoryTaskRepository(storage).update(...args),
    );
  }
  async delete(...args: Parameters<TaskRepositoryPort['delete']>) {
    const project = await this.store.projectFor('task', args[0]);
    return this.store.mutate(project, undefined, [], (storage) =>
      new InMemoryTaskRepository(storage).delete(...args),
    );
  }
  async moveTask(...args: Parameters<TaskRepositoryPort['moveTask']>) {
    const project = await this.store.projectFor('task', args[0]);
    return this.store.mutate(project, undefined, [], (storage) =>
      new InMemoryTaskRepository(storage).moveTask(...args),
    );
  }
  async migrateTasksBetweenColumns(
    ...args: Parameters<TaskRepositoryPort['migrateTasksBetweenColumns']>
  ) {
    const row = (
      await currentSqlSession().query('SELECT project_id FROM public.board_columns WHERE id=$1', [
        args[0],
      ])
    ).rows[0];
    if (!row) return 0;
    return this.store.mutate(row.project_id, undefined, [], (storage) =>
      new InMemoryTaskRepository(storage).migrateTasksBetweenColumns(...args),
    );
  }
  async listTasks(filter: Parameters<TaskRepositoryPort['listTasks']>[0]) {
    return new PostgresqlTaskListAdapter().listProjectTasks({
      projectId: filter.projectId,
      page: filter.page ?? 1,
      limit: filter.limit ?? 20,
      filter,
    });
  }
}

export class PostgresqlTaskActivityRepository implements TaskActivityRepositoryPort {
  constructor(private readonly store = new KanbanSqlStore()) {}
  async recordEvent(input: Parameters<TaskActivityRepositoryPort['recordEvent']>[0]) {
    const event = (await this.recordEventsBatch([input]))[0];
    if (!event) throw new Error('Activity insertion missing');
    return event;
  }
  async recordEventsBatch(inputs: Parameters<TaskActivityRepositoryPort['recordEventsBatch']>[0]) {
    const events: TaskActivityEvent[] = inputs.map((event) => ({
      ...event,
      id: event.id ?? crypto.randomUUID(),
      createdAt: event.createdAt ?? new Date().toISOString(),
    }));
    return currentSqlSession().transaction(async () => {
      for (const projectId of [...new Set(events.map((event) => event.projectId))].sort()) {
        const batch = events.filter((event) => event.projectId === projectId);
        const first = batch[0];
        if (!first) continue;
        await this.store.mutate(projectId, first.actorId, [], async (storage) => {
          const state = storage.getSnapshot(projectId);
          if (
            batch.some(
              (event) =>
                event.actorId !== first.actorId ||
                !state.tasks.some((task) => task.id === event.taskId),
            )
          )
            throw Object.assign(new Error('Recurso no encontrado'), { statusCode: 404 });
          state.events.push(...batch);
          storage.commitSnapshot(projectId, state);
        });
      }
      return events;
    });
  }
  async findByTaskId(taskId: string) {
    return (
      await currentSqlSession().query(
        'SELECT * FROM public.task_activity WHERE task_id=$1 ORDER BY created_at DESC,id',
        [taskId],
      )
    ).rows.map(eventFromRow);
  }
  async findByProjectId(projectId: string) {
    return (
      await currentSqlSession().query(
        'SELECT * FROM public.task_activity WHERE project_id=$1 ORDER BY created_at DESC,id',
        [projectId],
      )
    ).rows.map(eventFromRow);
  }
}
