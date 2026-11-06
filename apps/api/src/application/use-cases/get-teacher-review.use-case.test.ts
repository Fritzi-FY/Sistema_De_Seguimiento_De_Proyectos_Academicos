import { describe, it, expect, beforeEach } from 'vitest';
import { GetTeacherReviewUseCase } from './get-teacher-review.use-case.js';
import { RequestTeacherReviewUseCase } from './request-teacher-review.use-case.js';
import { RespondTeacherReviewUseCase } from './respond-teacher-review.use-case.js';
import { ResubmitTeacherReviewUseCase } from './resubmit-teacher-review.use-case.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryReviewRepository } from '../../infrastructure/adapters/repositories/in-memory-review.repository.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../infrastructure/adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { NotificationTestSpy } from '../../testing/notification-test-spy.js';

const NOW = '2026-11-05T00:00:00.000Z';
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = 'owner-001';
const COLLAB_ID = 'collab-001';
const OTHER_STUDENT = 'other-student';
const TEACHER_1 = 'teacher-001';
const TEACHER_2 = 'teacher-002';

function fixture() {
  const memberships = new InMemoryMembershipRepository();
  const reviews = new InMemoryReviewRepository();
  const grants = new Map<string, readonly string[]>();
  const scope = new InMemoryTeacherProjectScopeAdapter(grants);
  const spy = new NotificationTestSpy();
  const requestUC = new RequestTeacherReviewUseCase(memberships, reviews);
  const respondUC = new RespondTeacherReviewUseCase(scope, memberships, reviews, spy);
  const resubmitUC = new ResubmitTeacherReviewUseCase(memberships, reviews);
  const getUC = new GetTeacherReviewUseCase(memberships, scope, reviews);
  return { memberships, reviews, grants, spy, requestUC, respondUC, resubmitUC, getUC };
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

describe('GetTeacherReviewUseCase', () => {
  let f: ReturnType<typeof fixture>;

  beforeEach(() => {
    f = fixture();
  });

  // ─── Éxito: solicitante activo ────────────────────────────────────────────

  it('solicitante activo puede consultar su revisión', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Avance sprint 3',
      description: 'Se completó la implementación del módulo de seguimiento de proyectos',
    });

    const detail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: OWNER_ID,
    });

    expect(detail.request.id).toBe(review.id);
    expect(detail.request.status).toBe('PENDING');
  });

  // ─── Éxito: docente asignado ──────────────────────────────────────────────

  it('docente asignado puede consultar la revisión', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Avance documentación',
      description: 'Se finalizó la documentación técnica y el manual de usuario del sistema',
    });

    const detail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: TEACHER_1,
    });

    expect(detail.request.id).toBe(review.id);
  });

  // ─── Historial determinista ───────────────────────────────────────────────

  it('devuelve historial completo ordenado por sequenceNumber ASC con evento 0 en PENDING', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Sprint final',
      description: 'Implementación completa y pruebas de aceptación del sistema IS488',
    });

    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Falta la sección de conclusiones en el informe final',
    });
    await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Se agregó la sección de conclusiones y se revisó el formato del informe',
    });
    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Informe completo y bien estructurado. Proyecto aprobado.',
    });

    const detail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: OWNER_ID,
    });

    expect(detail.timeline).toHaveLength(4); // seq 0 + 3 acciones
    // Evento de incepción: siempre PENDING aunque el estado actual sea APPROVED
    expect(detail.timeline[0]).toMatchObject({
      sequenceNumber: 0,
      actionType: 'INITIAL_REQUEST',
      actorId: OWNER_ID,
      actorRole: 'student',
      status: 'PENDING',
    });
    expect(detail.timeline[1]).toMatchObject({
      sequenceNumber: 1,
      actionType: 'TEACHER_RESPONSE',
      status: 'CHANGES_REQUESTED',
    });
    expect(detail.timeline[2]).toMatchObject({
      sequenceNumber: 2,
      actionType: 'STUDENT_RESUBMISSION',
      status: 'PENDING',
    });
    expect(detail.timeline[3]).toMatchObject({
      sequenceNumber: 3,
      actionType: 'TEACHER_RESPONSE',
      status: 'APPROVED',
    });
  });

  it('el evento de incepción preserva status PENDING aunque la revisión esté APPROVED', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Revisión directa',
      description: 'Revisión que será aprobada directamente sin ciclos de corrección previos',
    });
    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Aprobado directamente sin observaciones adicionales',
    });

    const detail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: TEACHER_1,
    });

    expect(detail.request.status).toBe('APPROVED');
    // El evento de incepción SIEMPRE es PENDING (invariante)
    expect(detail.timeline[0]?.status).toBe('PENDING');
    expect(detail.timeline[0]?.sequenceNumber).toBe(0);
  });

  it('las copias devueltas no permiten mutar el almacén interno', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Prueba de inmutabilidad',
      description:
        'Verificar que las copias devueltas no afectan el almacén interno del repositorio',
    });

    const detail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: OWNER_ID,
    });

    // Mutar la copia devuelta usando doble cast para evitar error de TS
    (detail.request as unknown as Record<string, unknown>).status = 'APPROVED';

    // El almacén interno no debe verse afectado
    const freshDetail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: OWNER_ID,
    });
    expect(freshDetail.request.status).toBe('PENDING');
  });

  // ─── Reasignación docente ─────────────────────────────────────────────────

  it('nuevo docente T2 puede consultar historial completo tras reasignación', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Revisión con reasignación',
      description: 'Revisión que tendrá una reasignación docente durante su ciclo de vida',
    });
    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Observaciones iniciales del docente T1 antes de la reasignación',
    });

    // Reasignar a TEACHER_2
    f.grants.set(TEACHER_1, []);
    f.grants.set(TEACHER_2, [PROJECT_A]);

    // T2 puede consultar el historial completo (incluyendo acciones de T1)
    const detail = await f.getUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      userId: TEACHER_2,
    });

    expect(detail.timeline).toHaveLength(2);
    // La acción de T1 permanece inmutable
    expect(detail.actions[0]?.actorId).toBe(TEACHER_1);
  });

  it('docente saliente (T1) no puede consultar tras desasignación', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Acceso post-desasignación',
      description: 'Verificar que el docente saliente pierde acceso inmediatamente',
    });

    // Desasignar T1
    f.grants.set(TEACHER_1, []);
    f.grants.set(TEACHER_2, [PROJECT_A]);

    await expect(
      f.getUC.execute({ projectId: PROJECT_A, reviewId: review.id, userId: TEACHER_1 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ─── Pérdida de acceso: membresía retirada ────────────────────────────────

  it('solicitante retirado pierde acceso a consultar su revisión', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, COLLAB_ID, 'collaborator');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: COLLAB_ID,
      title: 'Revisión con membresía retirada',
      description: 'Verificar que el estudiante pierde acceso al ser retirado del proyecto',
    });

    // Retirar membresía
    const existing = await f.memberships.findByProjectAndUser(PROJECT_A, COLLAB_ID);
    await f.memberships.removeMember({
      membershipId: existing!.id,
      projectId: PROJECT_A,
      userId: COLLAB_ID,
      removedAt: NOW,
    });

    await expect(
      f.getUC.execute({ projectId: PROJECT_A, reviewId: review.id, userId: COLLAB_ID }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ─── Rechazo: sin acceso → 404 ───────────────────────────────────────────

  it('rechaza con 404 para colaborador del mismo proyecto que no es el solicitante', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    await seedActiveMembership(f.memberships, PROJECT_A, COLLAB_ID, 'collaborator');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Revisión privada',
      description: 'Esta revisión solo puede ser consultada por el solicitante y el docente',
    });

    await expect(
      f.getUC.execute({ projectId: PROJECT_A, reviewId: review.id, userId: COLLAB_ID }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 para usuario sin ninguna relación con el proyecto', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Revisión protegida',
      description: 'Revisión que no debe ser accesible para usuarios sin relación con el proyecto',
    });

    await expect(
      f.getUC.execute({ projectId: PROJECT_A, reviewId: review.id, userId: OTHER_STUDENT }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 si la revisión no existe', async () => {
    f.grants.set(TEACHER_1, [PROJECT_A]);

    await expect(
      f.getUC.execute({
        projectId: PROJECT_A,
        reviewId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        userId: TEACHER_1,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('aislamiento: reviewId de PROJECT_B no revelado con PROJECT_A', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    await seedActiveMembership(f.memberships, PROJECT_B, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A, PROJECT_B]);

    const reviewB = await f.requestUC.execute({
      projectId: PROJECT_B,
      requesterId: OWNER_ID,
      title: 'Revisión en proyecto B',
      description: 'Esta revisión pertenece exclusivamente al proyecto B del equipo académico',
    });

    await expect(
      f.getUC.execute({ projectId: PROJECT_A, reviewId: reviewB.id, userId: OWNER_ID }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
