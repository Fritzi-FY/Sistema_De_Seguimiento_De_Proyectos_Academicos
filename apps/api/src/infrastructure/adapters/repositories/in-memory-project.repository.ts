import type { Project, ProjectRepositoryPort } from '@is488/shared';

/**
 * Adaptador de infraestructura en memoria para la persistencia de proyectos académicos.
 * Implementa el puerto driven ProjectRepositoryPort.
 *
 * ADVERTENCIA DE PERSISTENCIA VOLÁTIL:
 * Este almacén es estrictamente volátil y transitorio, diseñado exclusivamente para desarrollo
 * local, pruebas automatizadas y desacoplamiento inicial (ADR-001).
 * Todos los datos almacenados residen en memoria RAM y SE PIERDEN al detener o reiniciar el
 * proceso del servidor. No sustituye la persistencia definitiva en PostgreSQL (ADR-003).
 */
export class InMemoryProjectRepository implements ProjectRepositoryPort {
  private readonly storage: Map<string, Project>;

  constructor(initialProjects: Project[] = []) {
    this.storage = new Map<string, Project>();
    for (const project of initialProjects) {
      this.storage.set(project.id, { ...project });
    }
  }

  /**
   * Guarda o actualiza un proyecto en memoria.
   */
  async save(project: Project): Promise<void> {
    this.storage.set(project.id, { ...project });
  }

  /**
   * Busca un proyecto por su identificador UUID.
   */
  async findById(id: string): Promise<Project | null> {
    const project = this.storage.get(id);
    if (!project) {
      return null;
    }
    return { ...project };
  }

  /**
   * Retorna todos los proyectos existentes en memoria.
   */
  async findAll(): Promise<Project[]> {
    return Array.from(this.storage.values()).map((p) => ({ ...p }));
  }

  /**
   * Retorna los proyectos donde el usuario especificado es el creador
   * o miembro autorizado, aislando las consultas a su ámbito correspondiente.
   */
  async findByUser(userId: string): Promise<Project[]> {
    return Array.from(this.storage.values())
      .filter((p) => p.creatorId === userId)
      .map((p) => ({ ...p }));
  }

  /**
   * Limpia todos los registros en memoria. Utilidad para pruebas unitarias e integración.
   */
  clear(): void {
    this.storage.clear();
  }
}
