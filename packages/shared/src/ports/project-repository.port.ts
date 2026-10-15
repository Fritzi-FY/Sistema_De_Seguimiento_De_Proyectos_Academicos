/**
 * Entidad y puerto del dominio para la gestión de proyectos académicos (IS488).
 */

export type ProjectStatus = 'active' | 'archived';

/**
 * Entidad de dominio representativa de un Proyecto Académico.
 * Alineada con el modelo de datos canónico (docs/04-data-model.md).
 */
export interface Project {
  id: string;
  title: string;
  description?: string;
  courseCode: string;
  status: ProjectStatus;
  startDate: string;
  targetDate: string;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la persistencia y consulta
 * de proyectos académicos. Permite que el núcleo de la aplicación permanezca completamente
 * desacoplado del mecanismo de almacenamiento (en memoria, PostgreSQL, etc.).
 */
export interface ProjectRepositoryPort {
  /**
   * Persiste o actualiza un proyecto en el almacén de datos.
   */
  save(project: Project): Promise<void>;

  /**
   * Busca un proyecto por su identificador único (UUID).
   * Retorna null si el proyecto no existe.
   */
  findById(id: string): Promise<Project | null>;

  /**
   * Retorna todos los proyectos registrados.
   */
  findAll(): Promise<Project[]>;

  /**
   * Retorna los proyectos asociados a un usuario específico (como creador o miembro).
   * Aplica la regla de aislamiento de visibilidad para estudiantes.
   */
  findByUser(userId: string): Promise<Project[]>;
}
