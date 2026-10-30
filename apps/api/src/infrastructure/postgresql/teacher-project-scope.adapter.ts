import type { TeacherProjectScopePort } from '@is488/shared';
import { currentSqlSession, type SqlSession } from './session.js';
export class PostgresqlTeacherProjectScopeAdapter implements TeacherProjectScopePort {
  constructor(private readonly session: () => SqlSession = currentSqlSession) {}
  async listAssignedProjectIds(teacherId: string): Promise<readonly string[]> {
    return (
      await this.session().query<{ project_id: string }>(
        'SELECT project_id FROM public.teacher_project_assignments WHERE teacher_user_id=$1 ORDER BY project_id',
        [teacherId],
      )
    ).rows.map((r) => r.project_id);
  }
  async isAssigned(teacherId: string, projectId: string) {
    return (await this.listAssignedProjectIds(teacherId)).includes(projectId);
  }
}
