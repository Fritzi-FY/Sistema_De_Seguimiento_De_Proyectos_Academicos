import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getMembers, addMember, removeMember, MembershipService } from './membership.service.js';

describe('membership.service', () => {
  const sampleProjectId = '11111111-1111-4111-8111-111111111111';
  const sampleUserId = '22222222-2222-4222-8222-222222222222';

  const sampleMembership = {
    id: '33333333-3333-4333-8333-333333333333',
    projectId: sampleProjectId,
    userId: sampleUserId,
    role: 'collaborator' as const,
    status: 'active' as const,
    joinedAt: '2026-10-15T12:00:00.000Z',
    updatedAt: '2026-10-15T12:00:00.000Z',
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getMembers', () => {
    it('debe retornar lista de miembros cuando el backend responde 200 conforme al contrato', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [sampleMembership],
      } as Response);

      const result = await getMembers(sampleProjectId, {
        userId: 'dev-student-01',
        role: 'student',
      });

      expect(result).toEqual([sampleMembership]);
      expect(fetch).toHaveBeenCalledWith(`/api/projects/${sampleProjectId}/members`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'X-Dev-User-Id': 'dev-student-01',
          'X-Dev-User-Role': 'student',
        },
      });
    });

    it('debe manejar error 404 cuando el proyecto no existe o el solicitante no es miembro', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Proyecto no encontrado' }),
      } as Response);

      await expect(getMembers(sampleProjectId)).rejects.toThrow(/Proyecto no encontrado/i);
    });

    it('debe lanzar error cuando el esquema de respuesta es inválido', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ invalid: 'member' }],
      } as Response);

      await expect(getMembers(sampleProjectId)).rejects.toThrow(/Respuesta inválida del servidor/i);
    });
  });

  describe('addMember', () => {
    const validAddRequest = {
      userId: sampleUserId,
      role: 'collaborator' as const,
    };

    it('debe agregar un miembro exitosamente cuando la respuesta es 201', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => sampleMembership,
      } as Response);

      const result = await addMember(sampleProjectId, validAddRequest, {
        userId: 'dev-student-01',
        role: 'student',
      });

      expect(result).toEqual(sampleMembership);
      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/members`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(validAddRequest),
        }),
      );
    });

    it('debe validar en cliente y rechazar si el rol es diferente de collaborator', async () => {
      const invalidRoleRequest = {
        userId: sampleUserId,
        role: 'owner' as unknown as 'collaborator',
      };

      await expect(addMember(sampleProjectId, invalidRoleRequest)).rejects.toThrow(/collaborator/i);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('debe validar en cliente y rechazar si el userId no es un UUID válido', async () => {
      const invalidUuidRequest = {
        userId: 'not-a-uuid',
        role: 'collaborator' as const,
      };

      await expect(addMember(sampleProjectId, invalidUuidRequest)).rejects.toThrow(
        /identificador de usuario debe ser un UUID válido/i,
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('debe manejar error 403 cuando el solicitante no es el creador del proyecto', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: async () => ({ message: 'Solo el creador puede agregar integrantes' }),
      } as Response);

      await expect(addMember(sampleProjectId, validAddRequest)).rejects.toThrow(
        /Solo el creador puede agregar integrantes/i,
      );
    });

    it('debe manejar error 409 cuando ya existe membresía activa', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 409,
        statusText: 'Conflict',
        json: async () => ({ message: 'El usuario ya es integrante activo del proyecto' }),
      } as Response);

      await expect(addMember(sampleProjectId, validAddRequest)).rejects.toThrow(
        /El usuario ya es integrante activo del proyecto/i,
      );
    });
  });

  describe('removeMember', () => {
    const removedMembership = {
      ...sampleMembership,
      status: 'removed' as const,
    };

    it('debe retirar un miembro exitosamente cuando la respuesta es 200', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => removedMembership,
      } as Response);

      const result = await removeMember(sampleProjectId, sampleUserId, {
        userId: 'dev-student-01',
        role: 'student',
      });

      expect(result).toEqual(removedMembership);
      expect(fetch).toHaveBeenCalledWith(
        `/api/projects/${sampleProjectId}/members/${sampleUserId}`,
        {
          method: 'DELETE',
          headers: expect.objectContaining({
            'X-Dev-User-Id': 'dev-student-01',
          }),
        },
      );
    });

    it('debe manejar error 422 cuando se intenta retirar al propietario', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({ message: 'No es posible retirar al propietario del proyecto' }),
      } as Response);

      await expect(removeMember(sampleProjectId, sampleUserId)).rejects.toThrow(
        /No es posible retirar al propietario del proyecto/i,
      );
    });

    it('debe manejar error 404 cuando la membresía a retirar no existe', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({ message: 'Membresía no encontrada' }),
      } as Response);

      await expect(removeMember(sampleProjectId, sampleUserId)).rejects.toThrow(
        /Membresía no encontrada/i,
      );
    });

    it('debe manejar error con objeto details', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          message: 'Error en solicitud',
          details: [{ message: 'Detalle de fallo' }],
        }),
      } as Response);

      await expect(removeMember(sampleProjectId, sampleUserId)).rejects.toThrow(
        /Detalle de fallo/i,
      );
    });
  });

  describe('MembershipService object export', () => {
    it('debe contener los métodos getMembers, addMember y removeMember', () => {
      expect(MembershipService.getMembers).toBe(getMembers);
      expect(MembershipService.addMember).toBe(addMember);
      expect(MembershipService.removeMember).toBe(removeMember);
    });
  });
});
