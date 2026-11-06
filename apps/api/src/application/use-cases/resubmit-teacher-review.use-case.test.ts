import { describe, it, expect, beforeEach } from 'vitest';
import { ResubmitTeacherReviewUseCase } from './resubmit-teacher-review.use-case.js';
import { RequestTeacherReviewUseCase } from './request-teacher-review.use-case.js';
import { RespondTeacherReviewUseCase } from './respond-teacher-review.use-case.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { InMemoryReviewRepository } from '../../infrastructure/adapters/repositories/in-memory-review.repository.js';
import { InMemoryTeacherProjectScopeAdapter } from '../../infrastructure/adapters/repositories/in-memory-teacher-project-scope.adapter.js';
import { NotificationTestSpy } from '../../testing/notification-test-spy.js';

const NOW = '2026-11-05T00:00:00.000Z';
const PROJECT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PROJECT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OWNER_ID = 'owner-001';
const COLLAB_ID = 'collab-001';
const OTHER_ID = 'other-001';
const TEACHER_1 = 'teacher-001';

function fixture() {
  const memberships = new InMemoryMembershipRepository();
  const reviews = new InMemoryReviewRepository();
  const grants = new Map<string, readonly string[]>();
  const scope = new InMemoryTeacherProjectScopeAdapter(grants);
  const spy = new NotificationTestSpy();
  const requestUC = new RequestTeacherReviewUseCase(memberships, reviews);
  const respondUC = new RespondTeacherReviewUseCase(scope, memberships, reviews, spy);
  const resubmitUC = new ResubmitTeacherReviewUseCase(memberships, reviews);
  return { memberships, reviews, grants, spy, requestUC, respondUC, resubmitUC };
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

/** Crea revisión, docente responde con CHANGES_REQUESTED. Deja en estado re-solicitarable. */
async function setupReviewAwaitingResubmit(f: ReturnType<typeof fixture>) {
  await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
  f.grants.set(TEACHER_1, [PROJECT_A]);

  const review = await f.requestUC.execute({
    projectId: PROJECT_A,
    requesterId: OWNER_ID,
    title: 'Avance sprint 2',
    description: 'Se completó el diseño de la base de datos y los diagramas ER del proyecto',
  });

  await f.respondUC.execute({
    projectId: PROJECT_A,
    reviewId: review.id,
    user: { userId: TEACHER_1, role: 'teacher' },
    status: 'CHANGES_REQUESTED',
    observation: 'Falta documentar las restricciones de integridad en el diagrama ER',
  });

  return review;
}

describe('ResubmitTeacherReviewUseCase', () => {
  let f: ReturnType<typeof fixture>;

  beforeEach(() => {
    f = fixture();
  });

  // ─── Éxito ───────────────────────────────────────────────────────────────

  it('solicitante activo puede re-someter tras CHANGES_REQUESTED; estado retorna a PENDING', async () => {
    const review = await setupReviewAwaitingResubmit(f);

    const result = await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Se agregaron restricciones de integridad y se actualizó el diagrama ER',
    });

    expect(result.status).toBe('PENDING');
    expect(result.id).toBe(review.id);
  });

  it('re-solicitud almacena descripción de ajustes como acción inmutable con sequenceNumber correcto', async () => {
    const review = await setupReviewAwaitingResubmit(f);

    await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Se corrigieron todos los puntos observados por el docente evaluador',
      evidenceUrl: 'https://github.com/org/repo/pull/55',
    });

    const detail = await f.reviews.findById(PROJECT_A, review.id);
    expect(detail?.actions).toHaveLength(2); // 1 TEACHER_RESPONSE + 1 STUDENT_RESUBMISSION
    const resubmitAction = detail?.actions[1];
    expect(resubmitAction?.actionType).toBe('STUDENT_RESUBMISSION');
    expect(resubmitAction?.actorId).toBe(OWNER_ID);
    expect(resubmitAction?.actorRole).toBe('student');
    expect(resubmitAction?.status).toBe('PENDING');
    expect(resubmitAction?.sequenceNumber).toBe(2);
    expect(resubmitAction?.comment).toBe(
      'Se corrigieron todos los puntos observados por el docente evaluador',
    );
    expect(resubmitAction?.evidenceUrl).toBe('https://github.com/org/repo/pull/55');
  });

  it('dos ciclos completos de corrección (Solicitud → CR → Ajuste → CR → Ajuste → APPROVED)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);

    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Implementación completa',
      description: 'Se terminó la primera versión de la implementación del sistema IS488',
    });

    // Ciclo 1: PENDING → CHANGES_REQUESTED → PENDING
    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Primer conjunto de observaciones del docente evaluador',
    });
    await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Primera corrección aplicada según las observaciones del docente',
    });

    // Ciclo 2: PENDING → CHANGES_REQUESTED → PENDING
    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Segundo conjunto de observaciones del docente evaluador',
    });
    await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Segunda corrección aplicada con mejoras adicionales solicitadas',
    });

    // Aprobación final
    const approved = await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Todas las correcciones aplicadas correctamente. Aprobado.',
    });

    expect(approved.status).toBe('APPROVED');

    const detail = await f.reviews.findById(PROJECT_A, review.id);
    expect(detail?.actions).toHaveLength(5); // 2 TEACHER_RESPONSE + 2 STUDENT_RESUBMISSION + 1 TEACHER_RESPONSE(APPROVED)
    // Verificar secuencias monotónicas
    const seqs = detail?.actions.map((a) => a.sequenceNumber);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    // Verificar tipos de acción en orden
    const types = detail?.actions.map((a) => a.actionType);
    expect(types).toEqual([
      'TEACHER_RESPONSE',
      'STUDENT_RESUBMISSION',
      'TEACHER_RESPONSE',
      'STUDENT_RESUBMISSION',
      'TEACHER_RESPONSE',
    ]);
    // Verificar que la notificación fue emitida 3 veces (una por cada respuesta docente)
    expect(f.spy.callCount).toBe(3);
  });

  it('preserva autores originales del historial tras múltiples ciclos', async () => {
    const review = await setupReviewAwaitingResubmit(f);
    await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Corrección aplicada según las instrucciones del docente',
    });

    const detail = await f.reviews.findById(PROJECT_A, review.id);
    expect(detail?.actions[0]?.actorId).toBe(TEACHER_1); // primera respuesta docente
    expect(detail?.actions[1]?.actorId).toBe(OWNER_ID); // re-solicitud del estudiante
  });

  // ─── Concurrencia: 409 ante estado ya cambiado ────────────────────────────

  it('dos re-solicitudes concurrentes: una triunfa, otra falla con 409', async () => {
    const review = await setupReviewAwaitingResubmit(f);

    // Lanzar dos re-solicitudes concurrentes
    const [r1, r2] = await Promise.allSettled([
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: OWNER_ID,
        description: 'Primera re-solicitud concurrente con ajustes del sprint completados',
      }),
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: OWNER_ID,
        description: 'Segunda re-solicitud concurrente con mismos ajustes aplicados',
      }),
    ]);

    const successes = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failures = [r1, r2].filter((r) => r.status === 'rejected');

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as PromiseRejectedResult).reason).toMatchObject({ statusCode: 409 });

    // Solo debe haber una acción de re-solicitud (sin duplicados)
    const detail = await f.reviews.findById(PROJECT_A, review.id);
    const resubmits = detail?.actions.filter((a) => a.actionType === 'STUDENT_RESUBMISSION');
    expect(resubmits).toHaveLength(1);
    // Estado debe ser PENDING (una sola transición)
    expect(detail?.status).toBe('PENDING');
  });

  // ─── Rechazo: estado incorrecto → 409 ────────────────────────────────────

  it('rechaza con 409 si el estado ya es PENDING (re-solicitud no permitida)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Estado PENDING',
      description: 'Solicitud en estado inicial que no permite re-solicitar directamente',
    });

    // Estado es PENDING, no CHANGES_REQUESTED
    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: OWNER_ID,
        description: 'Re-solicitud no válida sobre estado PENDING',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rechaza con 409 si el estado es APPROVED (estado terminal)', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A]);
    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: OWNER_ID,
      title: 'Revisión aprobada',
      description: 'Esta revisión ya fue aprobada y no admite más transiciones',
    });
    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'APPROVED',
      observation: 'Revisión aprobada sin observaciones adicionales',
    });

    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: OWNER_ID,
        description: 'Intentar re-someter después de aprobación no permitida',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  // ─── Rechazo: sin acceso → 404 ───────────────────────────────────────────

  it('rechaza con 404 si studentId no es el solicitante original', async () => {
    const review = await setupReviewAwaitingResubmit(f);
    await seedActiveMembership(f.memberships, PROJECT_A, OTHER_ID, 'collaborator');

    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: OTHER_ID, // no es el requesterId original
        description: 'Intento de re-solicitud por usuario no autorizado en el proyecto',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 si la membresía del solicitante fue retirada', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, COLLAB_ID, 'collaborator');
    f.grants.set(TEACHER_1, [PROJECT_A]);

    const review = await f.requestUC.execute({
      projectId: PROJECT_A,
      requesterId: COLLAB_ID,
      title: 'Avance colaborador',
      description: 'Avance del colaborador que posteriormente será retirado del proyecto',
    });

    await f.respondUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Se requieren ajustes antes de aprobar el avance',
    });

    // Retirar membresía del colaborador
    const existing = await f.memberships.findByProjectAndUser(PROJECT_A, COLLAB_ID);
    await f.memberships.removeMember({
      membershipId: existing!.id,
      projectId: PROJECT_A,
      userId: COLLAB_ID,
      removedAt: NOW,
    });

    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: COLLAB_ID,
        description: 'Re-solicitud de miembro retirado no permitida',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rechaza con 404 si la revisión no existe', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');

    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        studentId: OWNER_ID,
        description: 'Revisión que no existe en el sistema de seguimiento',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('aislamiento: revisión de PROJECT_B no accesible con PROJECT_A', async () => {
    await seedActiveMembership(f.memberships, PROJECT_A, OWNER_ID, 'owner');
    await seedActiveMembership(f.memberships, PROJECT_B, OWNER_ID, 'owner');
    f.grants.set(TEACHER_1, [PROJECT_A, PROJECT_B]);

    const reviewB = await f.requestUC.execute({
      projectId: PROJECT_B,
      requesterId: OWNER_ID,
      title: 'Revisión en proyecto B',
      description: 'Esta revisión pertenece al segundo proyecto del equipo académico',
    });
    await f.respondUC.execute({
      projectId: PROJECT_B,
      reviewId: reviewB.id,
      user: { userId: TEACHER_1, role: 'teacher' },
      status: 'CHANGES_REQUESTED',
      observation: 'Observaciones del docente para el proyecto B',
    });

    // Usar reviewId de PROJECT_B con projectId de PROJECT_A → 404
    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: reviewB.id,
        studentId: OWNER_ID,
        description: 'Intento de acceso cruzado entre proyectos no permitido',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rollback: 409 no deja acciones duplicadas en el historial', async () => {
    const review = await setupReviewAwaitingResubmit(f);
    // Primera re-solicitud exitosa
    await f.resubmitUC.execute({
      projectId: PROJECT_A,
      reviewId: review.id,
      studentId: OWNER_ID,
      description: 'Primera re-solicitud exitosa con todos los cambios solicitados',
    });
    // Segunda re-solicitud → 409 (estado ya es PENDING)
    await expect(
      f.resubmitUC.execute({
        projectId: PROJECT_A,
        reviewId: review.id,
        studentId: OWNER_ID,
        description: 'Segunda re-solicitud que debe fallar por estado incorrecto',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });

    // El historial no tiene duplicados: solo 1 TEACHER_RESPONSE + 1 STUDENT_RESUBMISSION
    const detail = await f.reviews.findById(PROJECT_A, review.id);
    expect(detail?.actions).toHaveLength(2);
    expect(detail?.status).toBe('PENDING');
  });
});
