import { describe, it, expect, beforeEach } from 'vitest';
import type { Project, ProjectMembership } from '@is488/shared';
import { ProjectAlreadyExistsError, DuplicateMembershipError } from '@is488/shared';
import { InMemoryProjectCreationAdapter } from './in-memory-project-creation.adapter.js';
import { InMemoryProjectRepository } from './in-memory-project.repository.js';
import { InMemoryMembershipRepository } from './in-memory-membership.repository.js';

const NOW = '2026-10-12T12:00:00.000Z';

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Proyecto de Prueba',
    courseCode: 'IS-488',
    status: 'active',
    startDate: '2026-10-15T00:00:00.000Z',
    targetDate: '2026-12-20T00:00:00.000Z',
    creatorId: 'user-creator-01',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeOwnerMembership(
  projectId: string,
  overrides: Partial<ProjectMembership> = {},
): ProjectMembership {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    projectId,
    userId: 'user-creator-01',
    role: 'owner',
    status: 'active',
    removedAt: null,
    joinedAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('InMemoryProjectCreationAdapter', () => {
  let projectMap: Map<string, Project>;
  let membershipMap: Map<string, ProjectMembership>;
  let adapter: InMemoryProjectCreationAdapter;

  beforeEach(() => {
    projectMap = new Map();
    membershipMap = new Map();
    adapter = new InMemoryProjectCreationAdapter(projectMap, membershipMap);
  });

  describe('caso exitoso', () => {
    it('persiste proyecto y membresía en los mapas compartidos', async () => {
      const project = makeProject();
      const membership = makeOwnerMembership(project.id);

      await adapter.createProjectWithOwner(project, membership);

      expect(projectMap.has(project.id)).toBe(true);
      expect(membershipMap.has(membership.id)).toBe(true);
      expect(projectMap.get(project.id)?.title).toBe(project.title);
      expect(membershipMap.get(membership.id)?.role).toBe('owner');
    });

    it('el proyecto persiste de forma verificable a través de InMemoryProjectRepository (mismas referencias)', async () => {
      const project = makeProject();
      const membership = makeOwnerMembership(project.id);

      await adapter.createProjectWithOwner(project, membership);

      const projectRepo = new InMemoryProjectRepository(projectMap);
      const found = await projectRepo.findById(project.id);
      expect(found).not.toBeNull();
      expect(found?.title).toBe(project.title);
      expect(found?.creatorId).toBe(project.creatorId);
    });
  });

  describe('fallo en precondición — proyecto duplicado', () => {
    it('lanza ProjectAlreadyExistsError y no modifica ningún Map', async () => {
      const project = makeProject();
      projectMap.set(project.id, { ...project }); // Pre-poblar el mapa

      const membership = makeOwnerMembership(project.id);

      const initialProjectMapSize = projectMap.size;
      const initialMembershipMapSize = membershipMap.size;

      await expect(adapter.createProjectWithOwner(project, membership)).rejects.toThrow(
        ProjectAlreadyExistsError,
      );

      // Ningún Map se modificó (tamaños iguales, sin nueva membresía)
      expect(projectMap.size).toBe(initialProjectMapSize);
      expect(membershipMap.size).toBe(initialMembershipMapSize);
    });
  });

  describe('fallo en precondición — membresía duplicada', () => {
    it('lanza DuplicateMembershipError y no modifica ningún Map', async () => {
      const project = makeProject();
      const existingMembership = makeOwnerMembership(project.id, {
        id: '33333333-3333-4333-8333-333333333333',
      });
      membershipMap.set(existingMembership.id, existingMembership); // Pre-poblar membresía activa

      const membership = makeOwnerMembership(project.id);

      const initialProjectMapSize = projectMap.size;

      await expect(adapter.createProjectWithOwner(project, membership)).rejects.toThrow(
        DuplicateMembershipError,
      );

      // projectMap no fue modificado
      expect(projectMap.size).toBe(initialProjectMapSize);
    });
  });

  describe('fallo en segunda mutación (Map instrumentado)', () => {
    it('revierte la primera mutación (rollback compensatorio) y propaga el error original', async () => {
      const project = makeProject();
      const membership = makeOwnerMembership(project.id);

      // Crear un Map proxy que lanza en `set()` (simula fallo en segunda mutación)
      const throwingMembershipMap = new Map<string, ProjectMembership>();
      const originalSet = throwingMembershipMap.set.bind(throwingMembershipMap);
      let throwOnSet = false;
      throwingMembershipMap.set = (key: string, value: ProjectMembership) => {
        if (throwOnSet) {
          throw new Error('Error simulado en segunda mutación del Map');
        }
        return originalSet(key, value);
      };

      const adapterWithThrowingMap = new InMemoryProjectCreationAdapter(
        projectMap, // Map normal para proyectos
        throwingMembershipMap, // Map que lanzará en set
      );

      throwOnSet = true; // Activar el lanzamiento antes de la llamada

      const errorCaught = await adapterWithThrowingMap
        .createProjectWithOwner(project, membership)
        .catch((e: Error) => e);

      expect(errorCaught).toBeInstanceOf(Error);
      expect((errorCaught as Error).message).toContain('segunda mutación');

      // projectMap NO debe contener el proyecto (compensación aplicada)
      expect(projectMap.has(project.id)).toBe(false);
      // membershipMap (throwing) no contiene la membresía (set falló antes de insertar)
      expect(throwingMembershipMap.has(membership.id)).toBe(false);
    });
  });

  describe('[Integración] Composición correcta con mismas instancias de Map (Patrón B.1)', () => {
    it('las tres clases comparten estado observable con las mismas referencias', async () => {
      // Crear los tres adaptadores con las mismas referencias de Map
      const projectRepo = new InMemoryProjectRepository(projectMap);
      const membershipRepo = new InMemoryMembershipRepository(membershipMap);
      const creationAdapter = new InMemoryProjectCreationAdapter(projectMap, membershipMap);

      const project = makeProject();
      const ownerMembership = makeOwnerMembership(project.id);

      await creationAdapter.createProjectWithOwner(project, ownerMembership);

      // projectRepository.findById retorna el proyecto con los campos correctos
      const foundProject = await projectRepo.findById(project.id);
      expect(foundProject).not.toBeNull();
      expect(foundProject?.id).toBe(project.id);
      expect(foundProject?.title).toBe(project.title);
      expect(foundProject?.creatorId).toBe('user-creator-01');

      // membershipRepository.findByProjectAndUser retorna la membresía owner activa
      const foundMembership = await membershipRepo.findByProjectAndUser(
        project.id,
        ownerMembership.userId,
      );
      expect(foundMembership).not.toBeNull();
      expect(foundMembership?.role).toBe('owner');
      expect(foundMembership?.status).toBe('active');
      expect(foundMembership?.userId).toBe('user-creator-01');
    });
  });
});
