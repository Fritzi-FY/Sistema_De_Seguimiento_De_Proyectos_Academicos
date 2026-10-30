export interface TeacherProjectScopePort {
  listAssignedProjectIds(teacherId: string): Promise<readonly string[]>;
  isAssigned(teacherId: string, projectId: string): Promise<boolean>;
}
