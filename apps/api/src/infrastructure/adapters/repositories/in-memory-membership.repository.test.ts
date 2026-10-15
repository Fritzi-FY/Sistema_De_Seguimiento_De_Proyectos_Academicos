import { describe, it, expect, beforeEach } from 'vitest';
import type { ProjectMembership } from '@is488/shared';
import { DuplicateMembershipError, MembershipNotFoundError } from '@is488/shared';
import { InMemoryMembershipRepository } from './in-memory-membership.repository.js';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const USER_A = 'user-a';
const USER_B = 'user-b';
const NOW = '2026-10-12T12:00:00.000Z';

function makeMembershipData(
  overrides: Partial<Omit<ProjectMembership, 'id'> & { id?: string }> = {},
): Omit<ProjectMembership, 'id'> & { id?: string } {
  return {
    projectId: PROJECT_ID,
    userId: USER_A,
    role: 'collaborator',
    status: 'active',
    joinedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('InMemoryMembershipRepository', () => {
  let repo: InMemoryMembershipRepository;

  beforeEach(() => {
    repo = new InMemoryMembershipRepository();
  });

  describe('addMember', () => {
    it('retorna membresía con id UUID y status active al agregar exitosamente', async () => {
      const result = await repo.addMember(makeMembershipData());
      expect(result.id).toBeDefined();
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(result.status).toBe('active');
      expect(result.projectId).toBe(PROJECT_ID);
      expect(result.userId).toBe(USER_A);
    });

    it('lanza DuplicateMembershipError si el par activo (projectId, userId) ya existe', async () => {
      await repo.addMember(makeMembershipData());
      await expect(repo.addMember(makeMembershipData())).rejects.toThrow(DuplicateMembershipError);
    });

    it('usa el id proporcionado si se especifica', async () => {
      const customId = '11111111-1111-4111-8111-111111111111';
      const result = await repo.addMember(makeMembershipData({ id: customId }));
      expect(result.id).toBe(customId);
    });
  });

  describe('removeMember', () => {
    it('cambia status a removed exitosamente', async () => {
      const added = await repo.addMember(makeMembershipData());
      await repo.removeMember(added.id);

      // Verificar mediante findByProject (solo activos): debe estar excluido
      const activos = await repo.findByProject(PROJECT_ID);
      expect(activos).toHaveLength(0);
    });

    it('lanza MembershipNotFoundError si la membresía no existe', async () => {
      await expect(repo.removeMember('99999999-9999-4999-8999-999999999999')).rejects.toThrow(
        MembershipNotFoundError,
      );
    });
  });

  describe('findByProject', () => {
    it('retorna solo miembros activos (excluye los removidos)', async () => {
      const memberA = await repo.addMember(makeMembershipData({ userId: USER_A }));
      await repo.addMember(makeMembershipData({ userId: USER_B }));
      await repo.removeMember(memberA.id);

      const activos = await repo.findByProject(PROJECT_ID);
      expect(activos).toHaveLength(1);
      expect(activos[0]?.userId).toBe(USER_B);
    });

    it('retorna lista vacía si no hay miembros activos', async () => {
      const result = await repo.findByProject(PROJECT_ID);
      expect(result).toHaveLength(0);
    });
  });

  describe('findByUser', () => {
    it('retorna solo membresías activas del usuario', async () => {
      const OTHER_PROJECT = '00000000-0000-4000-8000-000000000002';
      const m1 = await repo.addMember(
        makeMembershipData({ projectId: PROJECT_ID, userId: USER_A }),
      );
      await repo.addMember(makeMembershipData({ projectId: OTHER_PROJECT, userId: USER_A }));
      await repo.removeMember(m1.id);

      const memberships = await repo.findByUser(USER_A);
      expect(memberships).toHaveLength(1);
      expect(memberships[0]?.projectId).toBe(OTHER_PROJECT);
    });

    it('retorna lista vacía si el usuario no tiene membresías activas', async () => {
      const result = await repo.findByUser('user-inexistente');
      expect(result).toHaveLength(0);
    });
  });

  describe('findByProjectAndUser', () => {
    it('retorna null si no hay membresía activa para el par', async () => {
      const result = await repo.findByProjectAndUser(PROJECT_ID, USER_A);
      expect(result).toBeNull();
    });

    it('retorna null si la membresía existe pero está removed', async () => {
      const added = await repo.addMember(makeMembershipData());
      await repo.removeMember(added.id);

      const result = await repo.findByProjectAndUser(PROJECT_ID, USER_A);
      expect(result).toBeNull();
    });

    it('retorna la membresía activa cuando existe', async () => {
      await repo.addMember(makeMembershipData());
      const result = await repo.findByProjectAndUser(PROJECT_ID, USER_A);
      expect(result).not.toBeNull();
      expect(result?.userId).toBe(USER_A);
      expect(result?.status).toBe('active');
    });
  });

  describe('[H3] Ciclo de re-adición: addMember → removeMember → addMember', () => {
    it('permite re-agregar al mismo usuario y mantiene historial correcto', async () => {
      // Primera membresía (activa → retirada)
      const first = await repo.addMember(makeMembershipData({ userId: USER_A }));
      await repo.removeMember(first.id);

      // Segunda membresía (nueva, activa)
      const second = await repo.addMember(makeMembershipData({ userId: USER_A }));

      // El repositorio debe tener DOS registros para el mismo par (projectId, userId)
      // Uno con status removed, otro con status active
      expect(first.id).not.toBe(second.id);

      // findByProjectAndUser retorna únicamente el registro active
      const found = await repo.findByProjectAndUser(PROJECT_ID, USER_A);
      expect(found?.id).toBe(second.id);
      expect(found?.status).toBe('active');

      // findByProject excluye el registro removed e incluye solo el nuevo active
      const projectMembers = await repo.findByProject(PROJECT_ID);
      expect(projectMembers).toHaveLength(1);
      expect(projectMembers[0]?.id).toBe(second.id);
    });
  });
});
