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
 *
 * COMPOSICIÓN COMPARTIDA (Patrón B.1):
 * El constructor acepta una instancia opcional de `Map<string, Project>` como parámetro
 * `storage`. Si se proporciona, el repositorio opera sobre ese `Map` compartido; si no,
 * crea su propio `Map` interno (compatibilidad retroactiva con tests existentes).
 * La instancia compartida es inyectada desde `createApp` junto con
 * `InMemoryProjectCreationAdapter`, garantizando que las mutaciones del adaptador de
 * creación sean visibles inmediatamente a través de este repositorio.
 */
export class InMemoryProjectRepository implements ProjectRepositoryPort {
  private readonly storage: Map<string, Project>;

  /**
   * @param storageOrInitial - Puede ser:
   *   - Una instancia de `Map<string, Project>` (storage compartido, Patrón B.1).
   *   - Un array de `Project[]` (initialProjects, compatibilidad retroactiva).
   *   - Omitido (crea un Map interno propio).
   */
  constructor(storageOrInitial?: Map<string, Project> | Project[]) {
    if (storageOrInitial instanceof Map) {
      // Modo de storage compartido: usa la referencia del Map tal cual
      this.storage = storageOrInitial;
    } else {
      // Modo de compatibilidad retroactiva: crea Map propio e inicializa con proyectos
      this.storage = new Map<string, Project>();
      if (Array.isArray(storageOrInitial)) {
        for (const project of storageOrInitial) {
          this.storage.set(project.id, { ...project });
        }
      }
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
   * Retorna los proyectos donde el usuario especificado es el creador (`creatorId`).
   * La semántica ampliada (proyectos donde el usuario es colaborador) se gestiona
   * en la capa de aplicación mediante `ListProjectsUseCase`.
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
