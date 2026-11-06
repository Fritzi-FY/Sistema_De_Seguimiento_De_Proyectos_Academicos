import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryReviewRepository } from './in-memory-review.repository.js';

const PROJECT_1 = '11111111-1111-4111-8111-111111111111';
const PROJECT_2 = '22222222-2222-4222-8222-222222222222';
const STUDENT_1 = 'student-001';
const TEACHER_1 = 'teacher-001';

describe('InMemoryReviewRepository', () => {
  let repo: InMemoryReviewRepository;

  beforeEach(() => {
    repo = new InMemoryReviewRepository();
  });

  it('crea una solicitud con estado inicial PENDING y campos de servidor', async () => {
    const created = await repo.createRequest({
      projectId: PROJECT_1,
      requesterId: STUDENT_1,
      title: 'Entrega inicial',
      description: 'Descripción de avance del proyecto',
      evidenceUrl: 'https://example.com/evidence',
    });

    expect(created.id).toBeDefined();
    expect(created.projectId).toBe(PROJECT_1);
    expect(created.requesterId).toBe(STUDENT_1);
    expect(created.title).toBe('Entrega inicial');
    expect(created.status).toBe('PENDING');
    expect(created.createdAt).toBeDefined();
    expect(created.updatedAt).toBeDefined();
  });

  it('findById verifica conjuntamente projectId y reviewId y devuelve copias', async () => {
    const created = await repo.createRequest({
      projectId: PROJECT_1,
      requesterId: STUDENT_1,
      title: 'Entrega inicial',
      description: 'Descripción de avance',
    });

    // Mismo reviewId pero con otro projectId devuelve null
    const notFoundWrongProject = await repo.findById(PROJECT_2, created.id);
    expect(notFoundWrongProject).toBeNull();

    // ID correcto devuelve detalle con actions
    const found = await repo.findById(PROJECT_1, created.id);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(created.id);
    expect(found?.actions).toEqual([]);

    // Mutación externa de found no afecta el almacenamiento
    found!.title = 'Título mutado externamente';
    const fresh = await repo.findById(PROJECT_1, created.id);
    expect(fresh?.title).toBe('Entrega inicial');
  });

  it('recordTeacherResponse registra acción con sequenceNumber monotónico y transiciona estado', async () => {
    const created = await repo.createRequest({
      projectId: PROJECT_1,
      requesterId: STUDENT_1,
      title: 'Avance',
      description: 'Descripción de avance',
    });

    const updated = await repo.recordTeacherResponse(PROJECT_1, created.id, {
      reviewerId: TEACHER_1,
      status: 'CHANGES_REQUESTED',
      observation: 'Requiere ajustes en la arquitectura',
    });

    expect(updated.status).toBe('CHANGES_REQUESTED');

    const detail = await repo.findById(PROJECT_1, created.id);
    expect(detail?.actions).toHaveLength(1);
    expect(detail?.actions[0]).toMatchObject({
      sequenceNumber: 1,
      actorId: TEACHER_1,
      actorRole: 'teacher',
      actionType: 'TEACHER_RESPONSE',
      status: 'CHANGES_REQUESTED',
      comment: 'Requiere ajustes en la arquitectura',
    });
  });

  it('recordStudentResubmission registra acción y transiciona a PENDING con sequenceNumber 2', async () => {
    const created = await repo.createRequest({
      projectId: PROJECT_1,
      requesterId: STUDENT_1,
      title: 'Avance',
      description: 'Descripción',
    });

    await repo.recordTeacherResponse(PROJECT_1, created.id, {
      reviewerId: TEACHER_1,
      status: 'CHANGES_REQUESTED',
      observation: 'Ajustar pruebas',
    });

    const resubmitted = await repo.recordStudentResubmission(PROJECT_1, created.id, {
      studentId: STUDENT_1,
      description: 'Pruebas agregadas',
      evidenceUrl: 'https://example.com/tests',
    });

    expect(resubmitted.status).toBe('PENDING');

    const detail = await repo.findById(PROJECT_1, created.id);
    expect(detail?.actions).toHaveLength(2);
    expect(detail?.actions[1]).toMatchObject({
      sequenceNumber: 2,
      actorId: STUDENT_1,
      actorRole: 'student',
      actionType: 'STUDENT_RESUBMISSION',
      status: 'PENDING',
      comment: 'Pruebas agregadas',
      evidenceUrl: 'https://example.com/tests',
    });
  });

  it('recordStudentResubmission lanza 409 si el estado no es CHANGES_REQUESTED', async () => {
    const created = await repo.createRequest({
      projectId: PROJECT_1,
      requesterId: STUDENT_1,
      title: 'Avance',
      description: 'Descripción',
    });

    // Estado actual es PENDING, no CHANGES_REQUESTED
    await expect(
      repo.recordStudentResubmission(PROJECT_1, created.id, {
        studentId: STUDENT_1,
        description: 'Re-envío inválido',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('clear limpia los mapas internos', async () => {
    const created = await repo.createRequest({
      projectId: PROJECT_1,
      requesterId: STUDENT_1,
      title: 'Avance',
      description: 'Descripción',
    });

    repo.clear();
    const found = await repo.findById(PROJECT_1, created.id);
    expect(found).toBeNull();
  });
});
