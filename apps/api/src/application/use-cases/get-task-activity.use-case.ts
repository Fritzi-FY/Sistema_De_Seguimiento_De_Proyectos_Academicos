import type {
  MembershipRepositoryPort,
  ProjectRepositoryPort,
  TaskRepositoryPort,
  TaskActivityRepositoryPort,
  TaskActivityEvent,
} from '@is488/shared';

export class GetTaskActivityUseCase {
  constructor(
    private readonly projects: ProjectRepositoryPort,
    private readonly memberships: MembershipRepositoryPort,
    private readonly tasks: TaskRepositoryPort,
    private readonly activity: TaskActivityRepositoryPort,
  ) {}

  async execute(input: {
    projectId: string;
    taskId: string;
    requesterId: string;
  }): Promise<TaskActivityEvent[]> {
    const notFound = () => Object.assign(new Error('Recurso no encontrado'), { statusCode: 404 });
    const project = await this.projects.findById(input.projectId);
    if (!project) throw notFound();
    if (project.creatorId !== input.requesterId) {
      const membership = await this.memberships.findByProjectAndUser(
        input.projectId,
        input.requesterId,
      );
      if (!membership || membership.status !== 'active') throw notFound();
    }
    const task = await this.tasks.findById(input.taskId);
    if (!task || task.projectId !== input.projectId) throw notFound();
    const events = await this.activity.findByTaskId(input.taskId);
    return events
      .filter((event) => event.projectId === input.projectId && event.taskId === input.taskId)
      .sort(
        (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),
      );
  }
}
