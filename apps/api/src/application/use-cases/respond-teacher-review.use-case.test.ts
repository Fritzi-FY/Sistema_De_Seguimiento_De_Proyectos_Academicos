import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RespondTeacherReviewUseCase } from './respond-teacher-review.use-case.js';
import { RequestTeacherReviewUseCase } from './request-teacher-review.use-case.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryReviewRepository } from '../../infrastructure/adapters/repositories/in-memory-review.repository.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../infrastructure/adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { NotificationTestSpy } from '../../testing/notification-test-spy.js';

const NOW = '2026-11-05T00:00:00.000Z';
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = 'owner-001';
const COLLAB_ID = 'collab-001';
const TEACHER_1 = 'teacher-001';
const TEACHER_2 = 'teacher-002';
const STUDENT_ID = 'student-001';

function fixture() {
  const memberships = new InMemoryMembershipRepository();
  const reviews = new InMemoryReviewRepository();
  const grants = new Map<string, readonly string[]>();
  const scope = new InMemoryTeacherProjectScopeAdapter(grants);
  const spy = new NotificationTestSpy();
  const requestUC = new RequestTeacherReviewUseCase(memberships, reviews);
  const respondUC = new RespondTeacherReviewUseCase(scope, memberships, reviews, spy);
  return { memberships, reviews, grants, scope, spy, requestUC, respondUC };
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

async function createReview(
  f: ReturnType<typeof fixture>,
  projectId = PROJECT_A,
  requesterId = OWNER_ID,
) {
  return f.requestUC.execute({
    role: 'student',
    projectId,
    requesterId,
    title: 'Avance sprint 1',
    description: 'Se completó la integración de la API de autenticación con OAuth2',
  });
}

describe('RespondTeacherReviewUseCase', () => {
  let f: ReturnType<typeof fixture>;

  beforeEach(() => {
    f = fixture();
  });

  // ─── Éxito: Docente asignado ─────────────────────────────────────────────

  it('docente asignado puede aprobar una revisión PENDING', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    const result = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Excelente trabajo, todos los objetivos del sprint cumplidos',
    });

    expect(result.status).toBe('APPROVED');
    expect(result.id).toBe(review.id);
  });

  it('docente asignado puede solicitar cambios (CHANGES_REQUESTED)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    const result = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Falta documentar la cobertura de pruebas unitarias',
    });

    expect(result.status).toBe('CHANGES_REQUESTED');
  });

  // ─── Control de Rol e Identidad Confiable ────────────────────────────────

  it('rechaza con 403 si un estudiante intenta responder', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, STUDENT_ID, 'collaborator');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      role: 'student',
      projectId: PROJECT_A,
      requesterId: STUDENT_ID,
      title: 'Solicitud del estudiante',
      description: 'Descripción del avance del estudiante para el proyecto',
    });

    // Rol student explícito desde el contexto autenticado → 403
    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        user: { userId: STUDENT_ID, role: 'student' },
        status: 'APPROVED',
        observation: 'Auto-aprobación no permitida',
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rechaza con 404 si el docente no está asignado al proyecto', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_B]); // asignado a otro proyecto
    const review = await createReview(f);

    // Rol teacher pero sin asignación vigente a PROJECT_A → 404
    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        user: { userId: TEACHER_1, role: 'teacher' },
        status: 'APPROVED',
        observation: 'No debería llegar aquí',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ─── Notificación y Resiliencia ───────────────────────────────────────────

  it('emite notificación con status APPROVED después de guardar', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Todo correcto, aprobado',
    });

    expect(f.spy.callCount).toBe(1);
    expect(f.spy.lastCall).toMatchObject({
      projectId: PROJECT_A,
      reviewId: review.id,
      reviewerId: TEACHER_1,
      status: 'APPROVED',
      recipientUserIds: [OWNER_ID],
    });
  });

  it('emite notificación con status CHANGES_REQUESTED', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Revisar la implementación del módulo de reportes',
    });

    expect(f.spy.lastCall?.status).toBe('CHANGES_REQUESTED');
  });

  it('fallo del puerto de notificaciones se captura, registra diagnóstico sin datos sensibles y caso de uso retorna éxito', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);
    f.spy.configureToThrow('Error de red al entregar notificación');

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Observación confidencial del docente evaluador',
    });

    // 1. El caso de uso retorna éxito (HTTP 200)
    expect(result.status).toBe('APPROVED');
    expect(result.id).toBe(review.id);

    // 2. Estado y acción conservados exactamente una sola vez en el almacén
    const stored = await f.reviews.findById(PROJECT_A, review.id);
    expect(stored?.status).toBe('APPROVED');
    expect(stored?.actions).toHaveLength(1);
    expect(stored?.actions[0]?.comment).toBe('Observación confidencial del docente evaluador');

    // 3. Diagnóstico registrado mediante el mecanismo existente (console.error JSON)
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = errorSpy.mock.calls[0]?.[0];
    expect(typeof loggedMessage).toBe('string');
    const parsed = JSON.parse(loggedMessage as string);
    expect(parsed).toMatchObject({
      stage: 'review-notification',
      outcome: 'failed',
      projectId: PROJECT_A,
      reviewId: review.id,
      error: 'Error',
    });

    // 4. No incluye datos sensibles (observaciones, comentarios, enlaces)
    expect(loggedMessage).not.toContain('Observación confidencial');
    expect(loggedMessage).not.toContain('evidenceUrl');

    errorSpy.mockRestore();
  });

  it('si findByProjectAndUser falla después de persistir, resuelve con éxito, conserva una acción y no invoca notificación', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    // Espiar findByProjectAndUser para que falle después del guardado
    vi.spyOn(f.memberships, 'findByProjectAndUser').mockRejectedValueOnce(
      new Error('Fallo temporal al consultar membresía'),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Aprobación confirmada',
    });

    // 1. El caso de uso resuelve con éxito
    expect(result.status).toBe('APPROVED');
    expect(result.id).toBe(review.id);

    // 2. Estado y acción conservados exactamente una sola vez
    const stored = await f.reviews.findById(PROJECT_A, review.id);
    expect(stored?.status).toBe('APPROVED');
    expect(stored?.actions).toHaveLength(1);

    // 3. Evita enviar notificación al no poder confirmar el permiso del destinatario
    expect(f.spy.callCount).toBe(0);

    // 4. Diagnóstico seguro registrado
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedMessage = errorSpy.mock.calls[0]?.[0];
    const parsed = JSON.parse(loggedMessage as string);
    expect(parsed).toMatchObject({
      stage: 'review-notification',
      outcome: 'failed',
      projectId: PROJECT_A,
      reviewId: review.id,
      error: 'Error',
    });

    errorSpy.mockRestore();
  });

  it('no se intenta notificar si falla la persistencia', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    // Simular fallo en la persistencia del repositorio
    vi.spyOn(f.reviews, 'recordTeacherResponse').mockRejectedValueOnce(
      new Error('Fallo crítico en base de datos PostgreSQL'),
    );

    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        user: { userId: TEACHER_1, role: 'teacher' },
        status: 'APPROVED',
        observation: 'Dictamen aprobatorio',
      }),
    ).rejects.toThrow('Fallo crítico en base de datos PostgreSQL');

    // El puerto de notificaciones no debe ser invocado
    expect(f.spy.callCount).toBe(0);
  });

  it('solo se notifica al solicitante si mantiene membresía activa y permiso de consulta', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, COLLAB_ID, 'collaborator');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f, PROJECT_A, COLLAB_ID);

    // Retirar membresía del colaborador solicitante
    const m = await f.memberships.findByProjectAndUser(PROJECT_A, COLLAB_ID);
    await f.memberships.removeMember({
      membershipId: m!.id,
      projectId: PROJECT_A,
      userId: COLLAB_ID,
      removedAt: NOW,
    });

    // El docente responde a la revisión
    const result = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Ajustes solicitados antes de aprobar',
    });

    expect(result.status).toBe('CHANGES_REQUESTED');
    // Al haber perdido la membresía activa, no tiene permiso de consulta y no se le despacha notificación
    expect(f.spy.callCount).toBe(0);
  });

  it('no emite notificación cuando el docente no está asignado', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    // TEACHER_2 no está asignado
    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        user: { userId: TEACHER_2, role: 'teacher' },
        status: 'APPROVED',
        observation: 'Intento no autorizado',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(f.spy.callCount).toBe(0);
  });

  // ─── Rechazo y Aislamiento ───────────────────────────────────────────────

  it('rechaza con 404 tras desasignación docente (docente saliente pierde acceso)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    // Simular desasignación: eliminar del mapa
    f.grants.set(TEACHER_1, []);

    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        user: { userId: TEACHER_1, role: 'teacher' },
        status: 'APPROVED',
        observation: 'Acceso ya no vigente',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 si la revisión no existe', async () => {
    f.grants.set(TEACHER_1, [PROJECT_A]);

    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        user: { userId: TEACHER_1, role: 'teacher' },
        status: 'APPROVED',
        observation: 'Revisión inexistente',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 si se usa reviewId de otro proyecto (aislamiento)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    await seedActiveMembership(f.memberships, PROJECT_B, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A, PROJECT_B]);

    const reviewB = await f.requestUC.execute({
      role: 'student',
      projectId: PROJECT_B,
      requesterId: OWNER_ID,
      title: 'Avance en proyecto B',
      description: 'Descripción del avance en el segundo proyecto del equipo',
    });

    // Usar reviewId del proyecto B con projectId del proyecto A → 404
    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: reviewB.id,
        user: { userId: TEACHER_1, role: 'teacher' },
        status: 'APPROVED',
        observation: 'Acceso cruzado no permitido',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  // ─── Reasignación docente ─────────────────────────────────────────────────

  it('nuevo docente T2 puede responder solicitudes PENDING tras reasignación; T1 ya no puede', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await createReview(f);

    // Reasignar a TEACHER_2
    f.grants.set(TEACHER_1, []);
    f.grants.set(TEACHER_2, [PROJECT_A]);

    // T1 ya no puede responder
    await expect(
      f.respondUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        user: { userId: TEACHER_1, role: 'teacher' },
        status: 'APPROVED',
        observation: 'Acceso revocado',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });

    // T2 puede responder
    const result = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_2, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'El nuevo docente solicita ajustes en la documentación técnica',
    });

    expect(result.status).toBe('CHANGES_REQUESTED');
    const detail = await f.reviews.findById(PROJECT_A, review.id);
    expect(detail?.actions[0]?.actorId).toBe(TEACHER_2);
  });
});
