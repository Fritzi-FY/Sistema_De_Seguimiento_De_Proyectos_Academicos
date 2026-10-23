import type { TaskActivityEvent, TaskActivityRepositoryPort } from '@is488/shared';
import type { ProjectLockManager } from './in-memory-kanban-project.storage.js';
import { InMemoryKanbanProjectStorage, cloneEvent } from './in-memory-kanban-project.storage.js';

export class InMemoryTaskActivityRepository implements TaskActivityRepositoryPort {
  public readonly storage: InMemoryKanbanProjectStorage;

  get events(): TaskActivityEvent[] {
    return this.storage.getAllEvents();
  }

  constructor(storage?: InMemoryKanbanProjectStorage, lockManager?: ProjectLockManager) {
    this.storage = storage ?? new InMemoryKanbanProjectStorage(lockManager);
  }

  async recordEvent(
    event: Omit<TaskActivityEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string },
  ): Promise<TaskActivityEvent> {
    return this.storage.lockManager.withLock(event.projectId, async () => {
      const snapshot = this.storage.getSnapshot(event.projectId);
      const newEvent: TaskActivityEvent = {
        id: event.id ?? crypto.randomUUID(),
        taskId: event.taskId,
        projectId: event.projectId,
        actorId: event.actorId,
        action: event.action,
        fromColumnId: event.fromColumnId,
        toColumnId: event.toColumnId,
        details: event.details ? JSON.parse(JSON.stringify(event.details)) : undefined,
        createdAt: event.createdAt ?? new Date().toISOString(),
      };
      snapshot.events.push(newEvent);
      this.storage.commitSnapshot(event.projectId, snapshot);
      return cloneEvent(newEvent);
    });
  }

  async recordEventsBatch(
    events: Array<
      Omit<TaskActivityEvent, 'id' | 'createdAt'> & { id?: string; createdAt?: string }
    >,
  ): Promise<TaskActivityEvent[]> {
    if (events.length === 0) return [];
    const projectId = events[0]!.projectId;
    const hasMixedProjects = events.some((e) => e.projectId !== projectId);
    if (hasMixedProjects) {
      throw new Error(
        'No se pueden registrar eventos de actividad de múltiples proyectos en un mismo lote atómico',
      );
    }
    return this.storage.lockManager.withLock(projectId, async () => {
      const snapshot = this.storage.getSnapshot(projectId);
      const recorded: TaskActivityEvent[] = [];
      const now = new Date().toISOString();
      for (const ev of events) {
        const newEvent: TaskActivityEvent = {
          id: ev.id ?? crypto.randomUUID(),
          taskId: ev.taskId,
          projectId: ev.projectId,
          actorId: ev.actorId,
          action: ev.action,
          fromColumnId: ev.fromColumnId,
          toColumnId: ev.toColumnId,
          details: ev.details ? JSON.parse(JSON.stringify(ev.details)) : undefined,
          createdAt: ev.createdAt ?? now,
        };
        snapshot.events.push(newEvent);
        recorded.push(cloneEvent(newEvent));
      }
      this.storage.commitSnapshot(projectId, snapshot);
      return recorded;
    });
  }

  async findByTaskId(taskId: string): Promise<TaskActivityEvent[]> {
    return this.storage
      .getAllEvents()
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  async findByProjectId(projectId: string): Promise<TaskActivityEvent[]> {
    const snapshot = this.storage.getSnapshot(projectId);
    return snapshot.events
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map(cloneEvent);
  }
}
