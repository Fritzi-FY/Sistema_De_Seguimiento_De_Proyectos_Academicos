import { IneligibleAssigneeError } from '@is488/shared';
import type { Board, BoardColumn, Task, TaskActivityEvent } from '@is488/shared';
import { currentSqlSession, PersistenceTransactionError, type SqlSession } from './session.js';
import {
  InMemoryKanbanProjectStorage,
  type ProjectKanbanState,
} from '../adapters/repositories/in-memory-kanban-project.storage.js';

type Row = Record<string, unknown>;
const iso = (value: unknown) => new Date(value as string | Date).toISOString();
export function columnFromRow(row: Row): BoardColumn {
  return {
    id: String(row.id),
    boardId: String(row.board_id),
    name: String(row.name),
    category: row.category as BoardColumn['category'],
    color: row.color == null ? undefined : String(row.color),
    orderIndex: Number(row.order_index),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
export function taskFromRow(row: Row): Task {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    columnId: String(row.column_id),
    title: String(row.title),
    description: row.description == null ? undefined : String(row.description),
    priority: row.priority as Task['priority'],
    orderIndex: Number(row.order_index),
    dueDate: row.due_date == null ? undefined : iso(row.due_date),
    labels: row.labels as string[],
    creatorId: String(row.creator_id),
    assigneeIds: (row.assignee_ids ?? []) as string[],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}
export function eventFromRow(row: Row): TaskActivityEvent {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    taskId: String(row.task_id),
    actorId: String(row.actor_id),
    action: row.action as TaskActivityEvent['action'],
    fromColumnId: row.from_column_id == null ? undefined : String(row.from_column_id),
    toColumnId: row.to_column_id == null ? undefined : String(row.to_column_id),
    details: row.details == null ? undefined : (row.details as TaskActivityEvent['details']),
    createdAt: iso(row.created_at),
  };
}
export const taskSelection = `t.*,COALESCE((SELECT array_agg(a.user_id ORDER BY a.position) FROM public.task_assignees a WHERE a.task_id=t.id),'{}'::text[]) AS assignee_ids`;
const notFound = () => Object.assign(new Error('Recurso no encontrado'), { statusCode: 404 });
const invalidAssignee = (userId: string, projectId: string) =>
  Object.assign(new IneligibleAssigneeError(userId, projectId), { statusCode: 400 });
export type KanbanFaultStage = 'after_state' | 'after_events';
export class KanbanSqlStore {
  constructor(private readonly fault?: (stage: KanbanFaultStage) => Promise<void>) {}

  async board(
    projectId: string,
    session = currentSqlSession(),
  ): Promise<{ board: Board | null; revision: number }> {
    const rows = await session.query(
      `SELECT b.*,COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.order_index) FROM public.board_columns c WHERE c.board_id=b.id),'[]'::jsonb) AS columns FROM public.boards b WHERE b.project_id=$1`,
      [projectId],
    );
    const row = rows.rows[0];
    if (!row) return { board: null, revision: 0 };
    return {
      board: {
        id: row.id,
        projectId: row.project_id,
        columns: (row.columns as Row[]).map(columnFromRow),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
      },
      revision: Number(row.revision),
    };
  }
  async projectFor(kind: 'board' | 'column' | 'task', id: string): Promise<string> {
    const table = { board: 'boards', column: 'board_columns', task: 'tasks' }[kind];
    const row = (
      await currentSqlSession().query(
        `SELECT project_id FROM public.${table} WHERE id=$1${kind === 'task' ? ' AND NOT deleted' : ''}`,
        [id],
      )
    ).rows[0];
    if (!row) throw notFound();
    return row.project_id;
  }
  async mutate<T>(
    projectId: string,
    actorId: string | undefined,
    assignees: readonly string[],
    work: (storage: InMemoryKanbanProjectStorage, revision: number) => Promise<T>,
  ): Promise<T> {
    const session = currentSqlSession();
    let domainError: unknown;
    try {
      return await session.transaction(async () => {
        try {
          const actor = session.actorId ?? actorId;
          if (!actor || (session.actorId && actorId && session.actorId !== actorId))
            throw notFound();
          const project = (
            await session.query(
              'SELECT id,creator_id FROM public.projects WHERE id=$1 FOR NO KEY UPDATE',
              [projectId],
            )
          ).rows[0];
          if (!project) throw notFound();
          const users = [...new Set([actor, ...assignees])].sort();
          const members = (
            await session.query(
              "SELECT user_id FROM public.project_memberships WHERE project_id=$1 AND user_id=ANY($2::text[]) AND status='active' ORDER BY user_id FOR SHARE",
              [projectId, users],
            )
          ).rows.map((row) => row.user_id);
          if (project.creator_id !== actor && !members.includes(actor)) throw notFound();
          const invalid = assignees.find((id) => !members.includes(id));
          if (invalid !== undefined) throw invalidAssignee(invalid, projectId);
          const { board, revision } = await this.board(projectId, session);
          const tasks = (
            await session.query(
              `SELECT ${taskSelection} FROM public.tasks t WHERE project_id=$1 AND NOT deleted ORDER BY column_id,order_index`,
              [projectId],
            )
          ).rows.map(taskFromRow);
          const before: ProjectKanbanState = { board, tasks, events: [], boardRevision: revision };
          // This evaluator is private to this transaction; SQL remains the only retained state.
          const storage = new InMemoryKanbanProjectStorage();
          storage.commitSnapshot(projectId, before);
          const result = await work(storage, revision);
          await this.persist(session, projectId, before, storage.getSnapshot(projectId));
          return result;
        } catch (error) {
          domainError = error;
          throw error;
        }
      });
    } catch (error) {
      if (
        error instanceof PersistenceTransactionError &&
        error.outcome === 'rolled_back' &&
        domainError instanceof Error &&
        'statusCode' in domainError
      )
        throw domainError;
      throw error;
    }
  }
  private async persist(
    session: SqlSession,
    projectId: string,
    before: ProjectKanbanState,
    after: ProjectKanbanState,
  ) {
    const board = after.board;
    if (board && JSON.stringify(board) !== JSON.stringify(before.board))
      await session.query(
        `INSERT INTO public.boards(id,project_id,created_at,updated_at) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET updated_at=EXCLUDED.updated_at,revision=public.boards.revision+1`,
        [board.id, projectId, board.createdAt, board.updatedAt],
      );
    const columns = (board?.columns ?? []).filter(
      (column) =>
        JSON.stringify(column) !==
        JSON.stringify(before.board?.columns.find((old) => old.id === column.id)),
    );
    if (columns.length)
      await session.query(
        `INSERT INTO public.board_columns(id,project_id,board_id,name,category,color,order_index,created_at,updated_at) SELECT id,$1,board_id,name,category,color,order_index,created_at,updated_at FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,board_id uuid,name text,category text,color text,order_index integer,created_at timestamptz,updated_at timestamptz) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,category=EXCLUDED.category,color=EXCLUDED.color,order_index=EXCLUDED.order_index,updated_at=EXCLUDED.updated_at`,
        [
          projectId,
          JSON.stringify(
            columns.map((c) => ({
              id: c.id,
              board_id: c.boardId,
              name: c.name,
              category: c.category,
              color: c.color ?? null,
              order_index: c.orderIndex,
              created_at: c.createdAt,
              updated_at: c.updatedAt,
            })),
          ),
        ],
      );
    const changed = after.tasks.filter(
      (task) =>
        JSON.stringify(task) !== JSON.stringify(before.tasks.find((old) => old.id === task.id)),
    );
    if (changed.length)
      await session.query(
        `INSERT INTO public.tasks(id,project_id,column_id,title,description,priority,order_index,due_date,labels,creator_id,created_at,updated_at) SELECT id,$1,column_id,title,description,priority,order_index,due_date,labels,creator_id,created_at,updated_at FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,column_id uuid,title text,description text,priority text,order_index integer,due_date timestamptz,labels text[],creator_id text,created_at timestamptz,updated_at timestamptz) ON CONFLICT(id) DO UPDATE SET column_id=EXCLUDED.column_id,title=EXCLUDED.title,description=EXCLUDED.description,priority=EXCLUDED.priority,order_index=EXCLUDED.order_index,due_date=EXCLUDED.due_date,labels=EXCLUDED.labels,updated_at=EXCLUDED.updated_at`,
        [
          projectId,
          JSON.stringify(
            changed.map((t) => ({
              id: t.id,
              column_id: t.columnId,
              title: t.title,
              description: t.description ?? null,
              priority: t.priority,
              order_index: t.orderIndex,
              due_date: t.dueDate ?? null,
              labels: t.labels,
              creator_id: t.creatorId,
              created_at: t.createdAt,
              updated_at: t.updatedAt,
            })),
          ),
        ],
      );
    const assignmentChanges = changed.filter(
      (task) =>
        JSON.stringify(task.assigneeIds) !==
        JSON.stringify(before.tasks.find((old) => old.id === task.id)?.assigneeIds),
    );
    if (assignmentChanges.length) {
      await session.query(
        'DELETE FROM public.task_assignees WHERE project_id=$1 AND task_id=ANY($2::uuid[])',
        [projectId, assignmentChanges.map((task) => task.id)],
      );
      const assignments = assignmentChanges.flatMap((task) =>
        task.assigneeIds.map((userId, position) => ({
          task_id: task.id,
          user_id: userId,
          position,
        })),
      );
      if (assignments.length)
        await session.query(
          `INSERT INTO public.task_assignees(task_id,project_id,user_id,position) SELECT task_id,$1,user_id,position FROM jsonb_to_recordset($2::jsonb) AS x(task_id uuid,user_id text,position integer)`,
          [projectId, JSON.stringify(assignments)],
        );
    }
    const removedTasks = before.tasks
      .filter((old) => !after.tasks.some((task) => task.id === old.id))
      .map((task) => task.id);
    if (removedTasks.length)
      await session.query(
        'UPDATE public.tasks SET deleted=true,column_id=NULL,order_index=NULL WHERE project_id=$1 AND id=ANY($2::uuid[])',
        [projectId, removedTasks],
      );
    const removedColumns = (before.board?.columns ?? [])
      .filter((old) => !board?.columns.some((column) => column.id === old.id))
      .map((column) => column.id);
    if (removedColumns.length)
      await session.query(
        'DELETE FROM public.board_columns WHERE project_id=$1 AND id=ANY($2::uuid[])',
        [projectId, removedColumns],
      );
    if (this.fault) await this.fault('after_state');
    if (after.events.length) await this.appendEvents(session, after.events);
    if (this.fault) await this.fault('after_events');
  }
  async appendEvents(session: SqlSession, events: TaskActivityEvent[]) {
    if (!events.length) return;
    await session.query(
      `INSERT INTO public.task_activity(id,project_id,task_id,actor_id,action,from_column_id,to_column_id,details,created_at) SELECT id,project_id,task_id,actor_id,action,from_column_id,to_column_id,details,created_at FROM jsonb_to_recordset($1::jsonb) AS x(id uuid,project_id uuid,task_id uuid,actor_id text,action text,from_column_id uuid,to_column_id uuid,details jsonb,created_at timestamptz)`,
      [
        JSON.stringify(
          events.map((e) => ({
            id: e.id,
            project_id: e.projectId,
            task_id: e.taskId,
            actor_id: e.actorId,
            action: e.action,
            from_column_id: e.fromColumnId ?? null,
            to_column_id: e.toColumnId ?? null,
            details: e.details ?? null,
            created_at: e.createdAt,
          })),
        ),
      ],
    );
  }
}
