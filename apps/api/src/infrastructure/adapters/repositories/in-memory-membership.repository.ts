import type {
  ProjectMembership,
  MembershipRepositoryPort,
  RemoveMembershipCondition,
} from '@is488/shared';
import { DuplicateMembershipError, MembershipNotFoundError } from '@is488/shared';

/**
 * Adaptador de infraestructura en memoria para la persistencia de membresías en proyectos.
 * Implementa el puerto driven MembershipRepositoryPort.
 *
 * ADVERTENCIA DE PERSISTENCIA VOLÁTIL:
 * Este almacén es estrictamente volátil, diseñado exclusivamente para desarrollo local
 * y pruebas automatizadas. Los datos se pierden al reiniciar el proceso (ADR-001, ADR-003).
 *
 * COMPOSICIÓN COMPARTIDA (Patrón B.1):
 * El constructor acepta una instancia opcional de `Map<string, ProjectMembership>` como
 * `storage`. Si se proporciona, el repositorio opera sobre ese `Map` compartido; si no,
 * crea su propio `Map` interno (compatibilidad retroactiva con tests existentes).
 * La instancia compartida es inyectada desde `createApp` junto con
 * `InMemoryProjectCreationAdapter`, garantizando que las mutaciones del adaptador de
 * creación sean visibles inmediatamente a través de este repositorio.
 *
 * NOTA SOBRE REGISTROS HISTÓRICOS:
 * `removeMember` no elimina el registro; cambia su `status` a `'removed'`. Esto permite
 * que un usuario previamente retirado sea re-agregado (nueva membresía con nuevo `id`)
 * y que el historial de membresías permanezca intacto. Los métodos de consulta solo
 * devuelven registros con `status === 'active'`.
 */
export class InMemoryMembershipRepository implements MembershipRepositoryPort {
  private readonly storage: Map<string, ProjectMembership>;

  /**
   * @param storage - Instancia opcional de `Map<string, ProjectMembership>` para storage
   *                  compartido (Patrón B.1). Si se omite, crea un Map interno propio.
   */
  constructor(storage?: Map<string, ProjectMembership>) {
    this.storage = storage ?? new Map<string, ProjectMembership>();
  }

  /**
   * Agrega una nueva membresía al almacén.
   * Genera un UUID para el campo `id` si no se proporciona.
   * @throws {DuplicateMembershipError} Si ya existe una membresía activa para el par
   *   (projectId, userId).
   */
  async addMember(
    membershipData: Omit<ProjectMembership, 'id'> & { id?: string },
  ): Promise<ProjectMembership> {
    // Verificar unicidad del par activo (projectId, userId)
    const existingActive = Array.from(this.storage.values()).find(
      (m) =>
        m.projectId === membershipData.projectId &&
        m.userId === membershipData.userId &&
        m.status === 'active',
    );
    if (existingActive !== undefined) {
      throw new DuplicateMembershipError(membershipData.projectId, membershipData.userId);
    }

    const id = membershipData.id ?? crypto.randomUUID();
    if (this.storage.has(id)) throw new Error('Membership identifier already exists');
    const membership: ProjectMembership = {
      id,
      projectId: membershipData.projectId,
      userId: membershipData.userId,
      role: membershipData.role,
      status: membershipData.status,
      joinedAt: membershipData.joinedAt,
      removedAt: membershipData.removedAt,
      updatedAt: membershipData.updatedAt,
    };

    this.storage.set(id, { ...membership });
    return { ...membership };
  }

  /**
   * Cambia el `status` de la membresía a `'removed'`.
   * @throws {MembershipNotFoundError} Si la membresía no existe en el almacén.
   */
  async removeMember(condition: RemoveMembershipCondition): Promise<ProjectMembership> {
    const existing = this.storage.get(condition.membershipId);
    if (
      !existing ||
      existing.projectId !== condition.projectId ||
      existing.userId !== condition.userId ||
      existing.status !== 'active' ||
      existing.role !== 'collaborator'
    ) {
      throw new MembershipNotFoundError(condition.membershipId);
    }
    const updated: ProjectMembership = {
      ...existing,
      status: 'removed',
      updatedAt: condition.removedAt,
      removedAt: condition.removedAt,
    };
    this.storage.set(existing.id, updated);
    return { ...updated };
  }

  /**
   * Retorna la lista de membresías con `status === 'active'` del proyecto especificado.
   */
  async findByProject(projectId: string): Promise<ProjectMembership[]> {
    return Array.from(this.storage.values())
      .filter((m) => m.projectId === projectId && m.status === 'active')
      .map((m) => ({ ...m }));
  }

  /**
   * Retorna la lista de membresías con `status === 'active'` del usuario especificado.
   */
  async findByUser(userId: string): Promise<ProjectMembership[]> {
    return Array.from(this.storage.values())
      .filter((m) => m.userId === userId && m.status === 'active')
      .map((m) => ({ ...m }));
  }

  /**
   * Retorna la membresía activa para el par (projectId, userId), o null si no existe.
   */
  async findByProjectAndUser(projectId: string, userId: string): Promise<ProjectMembership | null> {
    const found = Array.from(this.storage.values()).find(
      (m) => m.projectId === projectId && m.userId === userId && m.status === 'active',
    );
    return found ? { ...found } : null;
  }

  /**
   * Limpia todos los registros en memoria. Utilidad para pruebas unitarias e integración.
   */
  clear(): void {
    this.storage.clear();
  }
}
