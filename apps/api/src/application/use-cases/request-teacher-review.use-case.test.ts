import { describe, it, expect, beforeEach } from 'vitest';
import { RequestTeacherReviewUseCase } from './request-teacher-review.use-case.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryReviewRepository } from '../../infrastructure/adapters/repositories/in-memory-review.repository.js';

const NOW = '2026-11-05T00:00:00.000Z';
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = 'owner-001';
const COLLAB_ID = 'collab-001';
const OTHER_ID = 'other-001';
const REMOVED_ID = 'removed-001';

function fixture() {
  const memberships = new InMemoryMembershipRepository();
  const reviews = new InMemoryReviewRepository();
  const useCase = new RequestTeacherReviewUseCase(memberships, reviews);
  return { memberships, reviews, useCase };
}

async function seedActiveMembership(
  repo: InMemoryMembershipRepository,
  projectId: string,
  userId: string,
  role: 'owner' | 'collaborator' = 'owner',
) {
  return repo.addMember({
    projectId,
    userId,
    role,
    status: 'active',
    joinedAt: NOW,
    updatedAt: NOW,
    removedAt: null,
  });
}

async function seedRemovedMembership(
  repo: InMemoryMembershipRepository,
  projectId: string,
  userId: string,
) {
  const m = await repo.addMember({
    projectId,
    userId,
    role: 'collaborator',
    status: 'active',
    joinedAt: NOW,
    updatedAt: NOW,
    removedAt: null,
  });
  await repo.removeMember({ membershipId: m.id, projectId, userId, removedAt: NOW });
}

describe('RequestTeacherReviewUseCase', () => {
  let f: ReturnType<typeof fixture>;

  beforeEach(() => {
    f = fixture();
  });

  // ─── Éxito ───────────────────────────────────────────────────────────────

  it('owner activo puede solicitar revisión; retorna PENDING con campos del servidor', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');

    const result = await f.useCase.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Avance sprint 1',
      description: 'Completamos la integración de la API de autenticación',
    });

    expect(result.id).toBeDefined();
    expect(result.status).toBe('PENDING');
    expect(result.projectId).toBe(PROJECT_A);
    expect(result.requesterId).toBe(OWNER_ID);
    expect(result.title).toBe('Avance sprint 1');
    expect(result.description).toBe('Completamos la integración de la API de autenticación');
    expect(result.createdAt).toBeDefined();
    expect(result.updatedAt).toBeDefined();
  });

  it('colaborador activo puede solicitar revisión', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, COLLAB_ID, 'collaborator');

    const result = await f.useCase.execute({
      projectId: PROJECT_A,
      requesterId: COLLAB_ID,
      title: 'Implementación modulo reportes',
      description: 'Se terminó el módulo de reportes con exportación a PDF',
      evidenceUrl: 'https://github.com/org/repo/pull/42',
    });

    expect(result.status).toBe('PENDING');
    expect(result.requesterId).toBe(COLLAB_ID);
    expect(result.evidenceUrl).toBe('https://github.com/org/repo/pull/42');
  });

  it('preserva descripción y enlace originales en el registro persistido', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');

    const description = 'Se finalizó el análisis de requisitos y se documentaron 12 casos de uso';
    const evidenceUrl = 'https://docs.example.com/requirements-v2.pdf';

    const result = await f.useCase.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Análisis completado',
      description,
      evidenceUrl,
    });

    // Verificar consultando el repo directamente
    const stored = await f.reviews.findById(PROJECT_A, result.id);
    expect(stored?.description).toBe(description);
    expect(stored?.evidenceUrl).toBe(evidenceUrl);
  });

  it('el cliente no puede fijar status, id ni timestamps (campos de servidor)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');

    const result = await f.useCase.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Validación de dominio',
      description: 'Prueba de que campos controlados no pueden ser inyectados',
    });

    // status siempre PENDING sin importar lo que pudiera pasar
    expect(result.status).toBe('PENDING');
    // id generado en servidor (UUID v4-like)
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ─── Rechazo: membresía inactiva o inexistente → 404 ─────────────────────

  it('rechaza con 404 si el usuario no tiene membresía en el proyecto', async () => {
    // PROJECT_A existe solo con OWNER_ID; OTHER_ID no tiene membresía
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');

    await expect(
      f.useCase.execute({
        projectId: PROJECT_A,
        requesterId: OTHER_ID,
        title: 'Solicitud no autorizada',
        description: 'Este usuario no es miembro del proyecto',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 si la membresía del solicitante fue retirada', async () => {
    await seedRemovedMembership(f.memberships, PROJECT_A, REMOVED_ID);

    await expect(
      f.useCase.execute({
        projectId: PROJECT_A,
        requesterId: REMOVED_ID,
        title: 'Solicitud de miembro retirado',
        description: 'No debería poder solicitar revisión',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 para proyecto inexistente (mismo código que membresía ausente)', async () => {
    await expect(
      f.useCase.execute({
        projectId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        requesterId: OWNER_ID,
        title: 'Proyecto fantasma',
        description: 'El proyecto no existe en el sistema',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ─── Aislamiento: projectId y reviewId verificados conjuntamente ──────────

  it('aislamiento: membresía en PROJECT_A no autoriza a solicitar en PROJECT_B', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');

    await expect(
      f.useCase.execute({
        projectId: PROJECT_B,
        requesterId: OWNER_ID,
        title: 'Solicitud en proyecto ajeno',
        description: 'No tiene membresía en PROJECT_B',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
