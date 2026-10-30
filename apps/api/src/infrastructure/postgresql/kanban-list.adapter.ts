import type { TaskListPort, TaskListParams, TaskListResult } from '@is488/shared';
import { currentSqlSession } from './session.js';
import { taskFromRow, taskSelection } from './kanban-store.js';

export class PostgresqlTaskListAdapter implements TaskListPort {
  async listProjectTasks(params: TaskListParams): Promise<TaskListResult> {
    const page = Math.max(1, params.page),
      limit = Math.min(100, Math.max(1, params.limit));
    const values: unknown[] = [params.projectId];
    const where = ['t.project_id=$1', 'NOT t.deleted'];
    const add = (value: unknown, clause: (placeholder: string) => string) => {
      if (value !== undefined) {
        values.push(value);
        where.push(clause('$' + values.length));
      }
    };
    add(params.filter.columnId, (p) => `t.column_id=${p}::uuid`);
    add(params.filter.priority, (p) => `t.priority=${p}`);
    add(
      params.filter.assigneeId,
      (p) =>
        `EXISTS(SELECT 1 FROM public.task_assignees a WHERE a.task_id=t.id AND a.user_id=${p})`,
    );
    add(params.filter.label, (p) => `${p}=ANY(t.labels)`);
    add(
      params.filter.search,
      (p) =>
        `(strpos(lower(t.title),lower(${p}))>0 OR strpos(lower(COALESCE(t.description,'')),lower(${p}))>0)`,
    );
    values.push(limit, (page - 1) * limit);
    const result = await currentSqlSession().query(
      `WITH filtered AS MATERIALIZED (SELECT ${taskSelection} FROM public.tasks t WHERE ${where.join(' AND ')}) SELECT (SELECT count(*)::int FROM filtered) AS total,COALESCE((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.column_id,p.order_index,p.created_at) FROM (SELECT * FROM filtered ORDER BY column_id,order_index,created_at LIMIT $${values.length - 1} OFFSET $${values.length}) p),'[]'::jsonb) AS items`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw new Error('SQL list snapshot missing');
    const totalItems = Number(row.total);
    return {
      items: (row.items as Record<string, unknown>[]).map(taskFromRow),
      totalItems,
      page,
      limit,
      totalPages: Math.ceil(totalItems / limit),
    };
  }
}
