/**
 * Entidad y puerto del dominio para la gestión de membresías en proyectos académicos (IS488).
 * Alineado con el modelo de datos canónico (docs/04-data-model.md §4.5 project_memberships).
 */

export type MembershipRole = 'owner' | 'collaborator';
export type MembershipStatus = 'active' | 'removed';

/**
 * Entidad de dominio que representa la membresía de un usuario en un proyecto académico.
 * Mantiene el rol y el ciclo de vida (activo / retirado) de la asociación.
 */
export interface ProjectMembership {
  /** UUID v4 identificador único de la membresía. */
  id: string;
  /** UUID del proyecto al que pertenece esta membresía. */
  projectId: string;
  /** Identificador del usuario miembro. */
  userId: string;
  /** Rol dentro del proyecto: 'owner' (creador) o 'collaborator' (colaborador invitado). */
  role: MembershipRole;
  /** Estado de la membresía: 'active' (vigente) o 'removed' (retirado). */
  status: MembershipStatus;
  /** Marca de tiempo ISO-8601 UTC de incorporación al proyecto. */
  joinedAt: string;
  /** Marca de tiempo ISO-8601 UTC de la última actualización de estado. */
  updatedAt: string;
  removedAt: string | null;
}

/**
 * Error lanzado cuando se intenta agregar un miembro que ya tiene una membresía activa
 * en el mismo proyecto (restricción de unicidad par projectId + userId activo).
 */
export class DuplicateMembershipError extends Error {
  constructor(projectId: string, userId: string) {
    super(
      `Ya existe una membresía activa para el usuario '${userId}' en el proyecto '${projectId}'`,
    );
    this.name = 'DuplicateMembershipError';
  }
}

/**
 * Error lanzado cuando se intenta operar sobre una membresía que no existe
 * (p. ej., al intentar retirar un usuario sin membresía activa).
 */
export class MembershipNotFoundError extends Error {
  constructor(membershipId: string) {
    super(`Membresía '${membershipId}' no encontrada`);
    this.name = 'MembershipNotFoundError';
  }
}

/**
 * Puerto driven (secundario) en arquitectura hexagonal para la gestión del ciclo de vida
 * de membresías en proyectos académicos. Desacopla el núcleo de la aplicación del
 * mecanismo de persistencia concreto (en memoria, PostgreSQL, etc.).
 */
export interface MembershipRepositoryPort {
  /**
   * Agrega una nueva membresía al almacén.
   * @throws {DuplicateMembershipError} Si ya existe una membresía activa para el par
   *   (projectId, userId).
   */
  addMember(
    membership: Omit<ProjectMembership, 'id'> & { id?: string },
  ): Promise<ProjectMembership>;

  /**
   * Cambia el estado de una membresía a 'removed'.
   * @throws {MembershipNotFoundError} Si la membresía no existe en el almacén.
   */
  removeMember(condition: RemoveMembershipCondition): Promise<ProjectMembership>;

  /**
   * Retorna la lista de membresías activas (status === 'active') del proyecto especificado.
   */
  findByProject(projectId: string): Promise<ProjectMembership[]>;

  /**
   * Retorna la lista de membresías activas (status === 'active') del usuario especificado.
   * Semántica: los proyectos del usuario se amplían mediante coordinación en el caso de uso
   * ListProjectsUseCase, que combina este resultado con los proyectos donde el usuario es creador.
   */
  findByUser(userId: string): Promise<ProjectMembership[]>;

  /**
   * Retorna la membresía activa para el par (projectId, userId), o null si no existe.
   */
  findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMembership | null>;
}

export interface RemoveMembershipCondition {
  membershipId: string;
  projectId: string;
  userId: string;
  removedAt: string;
}
