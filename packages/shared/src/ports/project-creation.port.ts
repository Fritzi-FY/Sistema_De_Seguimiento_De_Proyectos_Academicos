import type { Project } from './project-repository.port.js';
import type { ProjectMembership } from './membership-repository.port.js';

/**
 * Puerto driven (secundario) para la creación coordinada de un proyecto académico
 * y su membresía owner inicial.
 *
 * Success confirms both records. Only a confirmed rollback proves neither was persisted.
 * An unconfirmed COMMIT is unknown and must not trigger retries or SQL compensation.
 *
 * La responsabilidad de implementar el mecanismo de consistencia apropiado recae en
 * el adaptador concreto:
 * - **En memoria (desarrollo/tests):** sin interleaving de `await` entre mutaciones +
 *   compensación best-effort (`delete`) si la segunda mutación falla.
 * - **En PostgreSQL (producción):** transacción SQL con BEGIN / COMMIT / ROLLBACK.
 *
 * El caso de uso `CreateProjectUseCase` genera los identificadores (UUID) de proyecto
 * y membresía antes de invocar este puerto. El adaptador persiste los valores recibidos
 * y no debe depender de que el almacén genere los identificadores.
 */
export interface ProjectCreationPort {
  /**
   * Persiste de forma coordinada un proyecto y su membresía owner.
   *
   * @param project         - Entidad `Project` ya construida con su `id` definitivo.
   * @param ownerMembership - Entidad `ProjectMembership` con `role: 'owner'` y `status: 'active'`,
   *                          ya construida con su `id` definitivo.
   * @returns Promise que se resuelve sin valor si la operación fue exitosa.
   * @throws {ProjectAlreadyExistsError}  Si ya existe un proyecto con el mismo `id`.
   * @throws {DuplicateMembershipError}   Si ya existe una membresía activa para el par
   *                                       (project.id, ownerMembership.userId).
   * @throws {Error} Un COMMIT sin confirmación tiene resultado incierto.
   */
  createProjectWithOwner(project: Project, ownerMembership: ProjectMembership): Promise<void>;
}

/**
 * Error lanzado por `InMemoryProjectCreationAdapter` (y futuros adaptadores) cuando
 * se intenta crear un proyecto cuyo `id` ya existe en el almacén.
 */
export class ProjectAlreadyExistsError extends Error {
  constructor(projectId: string) {
    super(`Ya existe un proyecto con el identificador '${projectId}'`);
    this.name = 'ProjectAlreadyExistsError';
  }
}
