import type { Project, ProjectMembership, ProjectCreationPort } from '@is488/shared';
import { ProjectAlreadyExistsError, DuplicateMembershipError } from '@is488/shared';

/**
 * Adaptador de infraestructura en memoria para la creación coordinada de proyectos y
 * membresías owner. Implementa `ProjectCreationPort`.
 *
 * GARANTÍA DE CONSISTENCIA (todo-o-nada en memoria):
 * Este adaptador NO proporciona transacciones ACID. Su garantía se basa en:
 *
 * 1. **Validación antes de mutación:** todas las precondiciones se verifican antes de
 *    cualquier llamada a `Map.set()`. Si alguna falla, ningún `Map` se modifica.
 *
 * 2. **Sin interleaving:** no se introduce `await`, `setTimeout` ni operación asíncrona
 *    entre las dos mutaciones de `Map`. En el entorno single-threaded de JavaScript,
 *    esto elimina la posibilidad de que otra tarea del event loop observe un estado
 *    parcial entre ambas mutaciones exitosas.
 *
 * 3. **Compensación ante fallo en la segunda mutación:** si `membershipMap.set()` lanzara
 *    una excepción, el bloque `catch` ejecuta `projectMap.delete(project.id)` como
 *    operación de compensación y propaga el error original sin ocultarlo.
 *
 * LIMITACIÓN DOCUMENTADA:
 * Si la propia compensación (`projectMap.delete`) falla (escenario patológico con Map
 * instrumentado que lanza en `delete`), el adaptador propaga la excepción de compensación
 * y el estado del almacén queda inconsistente. Esto es una limitación aceptada del adaptador
 * en memoria; el `PostgresProjectCreationAdapter` la elimina mediante transacciones SQL.
 *
 * COMPOSICIÓN REQUERIDA (Patrón B.1):
 * Las instancias de `projectMap` y `membershipMap` deben ser las mismas referencias que
 * se inyectan en `InMemoryProjectRepository` e `InMemoryMembershipRepository`. La unicidad
 * de las referencias es la condición que hace observable la garantía todo-o-nada.
 * Esta invariante no puede expresarse en el tipo; debe verificarse mediante pruebas de
 * integración (ver tarea 2.5 y 4.2 del tasks.md).
 */
export class InMemoryProjectCreationAdapter implements ProjectCreationPort {
  constructor(
    private readonly projectMap: Map<string, Project>,
    private readonly membershipMap: Map<string, ProjectMembership>,
  ) {}

  /**
   * Persiste de forma coordinada un proyecto y su membresía owner.
   *
   * @throws {ProjectAlreadyExistsError}  Si ya existe un proyecto con el mismo `id`.
   * @throws {DuplicateMembershipError}   Si ya existe membresía activa para el par
   *                                       (project.id, ownerMembership.userId).
   */
  async createProjectWithOwner(
    project: Project,
    ownerMembership: ProjectMembership,
  ): Promise<void> {
    // ── FASE 1: Validar precondiciones (ninguna mutación ocurre si alguna falla) ──────────
    if (this.projectMap.has(project.id)) {
      throw new ProjectAlreadyExistsError(project.id);
    }

    // Verificar membresía activa duplicada para el par (project.id, ownerMembership.userId)
    const hasDuplicateMembership = Array.from(this.membershipMap.values()).some(
      (m) =>
        m.projectId === ownerMembership.projectId &&
        m.userId === ownerMembership.userId &&
        m.status === 'active',
    );
    if (hasDuplicateMembership) {
      throw new DuplicateMembershipError(ownerMembership.projectId, ownerMembership.userId);
    }

    // ── FASE 2: Mutar estado (síncronamente, sin await intercalado) ──────────────────────
    // Primera mutación: persistir el proyecto
    this.projectMap.set(project.id, { ...project });

    try {
      // Segunda mutación: persistir la membresía owner
      this.membershipMap.set(ownerMembership.id, { ...ownerMembership });
    } catch (mutationError) {
      // Compensación: revertir la primera mutación (best-effort, no es transacción ACID).
      // Si projectMap.delete también lanza (escenario patológico), la excepción se propaga
      // hacia el llamador y el estado del almacén queda inconsistente — limitación documentada.
      this.projectMap.delete(project.id);
      throw mutationError; // Propagar siempre — nunca ocultar el fallo original
    }
  }
}
