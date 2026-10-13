import { describe, it, expect, beforeEach } from 'vitest';
import type { SystemClockPort, Project, ProjectMembership } from '@is488/shared';
import { createApp } from '../app.js';
import { InMemoryProjectRepository } from '../../adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../adapters/repositories/in-memory-membership.repository.js';
import { InMemoryProjectCreationAdapter } from '../../adapters/repositories/in-memory-project-creation.adapter.js';

class FakeClock implements SystemClockPort {
  constructor(private readonly iso: string = '2026-10-12T12:00:00.000Z') {}
  now(): Date { return new Date(this.iso); }
  isoString(): string { return this.iso; }
}

function createTestApp(nodeEnv = 'development') {
  const projectMap = new Map<string, Project>();
  const membershipMap = new Map<string, ProjectMembership>();
  const projectRepository = new InMemoryProjectRepository(projectMap);
  const membershipRepository = new InMemoryMembershipRepository(membershipMap);
  const projectCreationPort = new InMemoryProjectCreationAdapter(projectMap, membershipMap);

  const app = createApp({
    clock: new FakeClock(),
    projectRepository,
    membershipRepository,
    projectCreationPort,
    nodeEnv,
  });

  return { app, projectRepository, membershipRepository };
}

const VALID_PAYLOAD = {
  title: 'Proyecto de Membresías',
  courseCode: 'IS-488',
  startDate: '2026-10-15T00:00:00.000Z',
  targetDate: '2026-12-20T00:00:00.000Z',
};

const CREATOR_ID = 'dev-student-01';
const COLLABORATOR_ID = '550e8400-e29b-41d4-a716-446655440000'; // UUID válido para el campo userId
const OTHER_USER = 'other-user-01';

describe('Pruebas de integración HTTP — Membresías (/api/projects/:id/members)', () => {
  let testApp: ReturnType<typeof createApp>;
  let projectId: string;

  beforeEach(async () => {
    const { app } = createTestApp();
    testApp = app;

    // Crear un proyecto base para las pruebas de membresía
    const res = await testApp.request('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-User-Id': CREATOR_ID,
      },
      body: JSON.stringify(VALID_PAYLOAD),
    });
    expect(res.status).toBe(201);
    const data = (await res.json()) as { id: string };
    projectId = data.id;
  });

  describe('POST /api/projects/:id/members', () => {
    it('éxito 201: agrega un colaborador al proyecto', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dev-User-Id': CREATOR_ID,
        },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      expect(res.status).toBe(201);
      const json = (await res.json()) as { role: string; status: string; userId: string };
      expect(json.role).toBe('collaborator');
      expect(json.status).toBe('active');
      expect(json.userId).toBe(COLLABORATOR_ID);
    });

    it('409: membresía duplicada activa al agregar el mismo usuario dos veces', async () => {
      await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      expect(res.status).toBe(409);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Conflict');
    });

    it('403: solicitante no es el creador del proyecto', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': OTHER_USER },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      expect(res.status).toBe(403);
    });

    it('404: proyecto inexistente', async () => {
      const res = await testApp.request('/api/projects/99999999-9999-4999-8999-999999999999/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      expect(res.status).toBe(404);
    });

    it('401: sin cabecera de autenticación', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      expect(res.status).toBe(401);
    });

    it('[H7] 400: role "owner" en el body provoca error de validación (sin crear membresía)', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'owner' }),
      });

      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string; details?: Array<{ path: unknown[] }> };
      expect(json.error).toBe('Bad Request');
      // Verificar que el error apunta al campo role
      const rolePaths = json.details?.flatMap(d => d.path) ?? [];
      expect(rolePaths).toContain('role');
    });
  });

  describe('DELETE /api/projects/:id/members/:userId', () => {
    beforeEach(async () => {
      // Agregar colaborador para las pruebas de DELETE
      await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });
    });

    it('éxito 200: retira al colaborador y responde con la membresía actualizada (status removed)', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members/${COLLABORATOR_ID}`, {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as { status: string; userId: string };
      expect(json.status).toBe('removed');
      expect(json.userId).toBe(COLLABORATOR_ID);
    });

    it('422: intento de retirar al propietario del proyecto', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members/${CREATOR_ID}`, {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(res.status).toBe(422);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe('Unprocessable Entity');
    });

    it('403: solicitante no es el creador del proyecto', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members/${COLLABORATOR_ID}`, {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': OTHER_USER },
      });

      expect(res.status).toBe(403);
    });

    it('404: proyecto inexistente', async () => {
      const res = await testApp.request('/api/projects/99999999-9999-4999-8999-999999999999/members/some-user', {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(res.status).toBe(404);
    });

    it('404: usuario sin membresía activa en el proyecto', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members/user-sin-membresia`, {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(res.status).toBe(404);
    });

    it('401: sin cabecera de autenticación', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members/${COLLABORATOR_ID}`, {
        method: 'DELETE',
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/projects/:id/members', () => {
    it('éxito 200: lista de miembros activos retornada al owner', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Array<{ userId: string; role: string }>;
      // El owner siempre está en la lista (membresía creada por CreateProjectUseCase)
      expect(json.some(m => m.userId === CREATOR_ID && m.role === 'owner')).toBe(true);
    });

    it('404: usuario sin membresía activa no puede listar miembros', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': OTHER_USER },
      });

      expect(res.status).toBe(404);
    });

    it('401: sin cabecera de autenticación', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'GET',
      });

      expect(res.status).toBe(401);
    });

    it('200: collaborator puede listar miembros del proyecto', async () => {
      // Agregar collaborator
      await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });

      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': COLLABORATOR_ID },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('405 — Métodos no soportados en endpoints de membresía', () => {
    it('PUT en /:id/members retorna 405 con Allow: GET, POST', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'PUT',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, POST');
    });

    it('POST en /:id/members/:userId retorna 405 con Allow: DELETE', async () => {
      const res = await testApp.request(`/api/projects/${projectId}/members/${COLLABORATOR_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: '{}',
      });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('DELETE');
    });
  });

  describe('[H8] Ciclo completo POST→DELETE→POST para el mismo colaborador', () => {
    it('re-agrega al colaborador retirado con 201, no 409', async () => {
      // 1. POST: agregar collaborador → 201
      const addRes = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });
      expect(addRes.status).toBe(201);

      // 2. DELETE: retirar collaborador → 200
      const deleteRes = await testApp.request(`/api/projects/${projectId}/members/${COLLABORATOR_ID}`, {
        method: 'DELETE',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(deleteRes.status).toBe(200);
      const deleteJson = (await deleteRes.json()) as { status: string };
      expect(deleteJson.status).toBe('removed');

      // 3. POST: re-agregar collaborador → 201 (no 409)
      const readdRes = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Dev-User-Id': CREATOR_ID },
        body: JSON.stringify({ userId: COLLABORATOR_ID, role: 'collaborator' }),
      });
      expect(readdRes.status).toBe(201);

      // 4. GET: verificar que el colaborador aparece como activo
      const listRes = await testApp.request(`/api/projects/${projectId}/members`, {
        method: 'GET',
        headers: { 'X-Dev-User-Id': CREATOR_ID },
      });
      expect(listRes.status).toBe(200);
      const members = (await listRes.json()) as Array<{ userId: string; status: string }>;
      const activeMember = members.find(m => m.userId === COLLABORATOR_ID);
      expect(activeMember).toBeDefined();
      expect(activeMember?.status).toBe('active');
    });
  });
});
