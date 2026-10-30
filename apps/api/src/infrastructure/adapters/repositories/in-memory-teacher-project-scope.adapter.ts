import type { TeacherProjectScopePort } from '@is488/shared';
export class InMemoryTeacherProjectScopeAdapter implements TeacherProjectScopePort {
  constructor(private readonly assignments: ReadonlyMap<string, readonly string[]> = new Map()) {}
  async listAssignedProjectIds(teacherId: string) {
    return [...(this.assignments.get(teacherId) ?? [])];
  }
  async isAssigned(teacherId: string, projectId: string) {
    return (this.assignments.get(teacherId) ?? []).includes(projectId);
  }
}
