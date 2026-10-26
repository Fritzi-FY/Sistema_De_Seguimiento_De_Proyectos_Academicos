import { describe, it, expect, beforeEach } from 'vitest';
import { GetProjectBoardUseCase } from './get-project-board.use-case.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import type { Project } from '@is488/shared';

describe('GetProjectBoardUseCase', () => {
  let boardRepository: InMemoryBoardRepository;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let useCase: GetProjectBoardUseCase;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const collaboratorId = '33333333-3333-4333-8333-333333333333';
  const secondCollaboratorId = '44444444-4444-4444-8444-444444444444';
  const unassignedTeacherId = '55555555-5555-4555-8555-555555555555';
  const outsiderId = '66666666-6666-4666-8666-666666666666';

  const sampleProject: Project = {
    id: projectId,
    title: 'Proyecto IS488',
    description: 'Seguimiento Académico',
    courseCode: 'IS488',
    status: 'active',
    startDate: '2026-03-01T00:00:00.000Z',
    targetDate: '2026-07-15T00:00:00.000Z',
    creatorId,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    boardRepository = new InMemoryBoardRepository();
    projectRepository = new InMemoryProjectRepository();
    membershipRepository = new InMemoryMembershipRepository();
    useCase = new GetProjectBoardUseCase(boardRepository, projectRepository, membershipRepository);

    await projectRepository.save(sampleProject);

    await membershipRepository.addMember({
      projectId,
      userId: collaboratorId,
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });

    await membershipRepository.addMember({
      projectId,
      userId: secondCollaboratorId,
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
  });

  it('rejects with 404 when project does not exist', async () => {
    await expect(
      useCase.execute({
        projectId: '00000000-0000-4000-8000-000000000000',
        requesterId: creatorId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects with 404 when requester is an outsider with no membership or assignment', async () => {
    await expect(
      useCase.execute({
        projectId,
        requesterId: outsiderId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects with 404 a teacher without active membership or real assignment evidence (default denial)', async () => {
    await expect(
      useCase.execute({
        projectId,
        requesterId: unassignedTeacherId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects with 404 when requester membership is removed', async () => {
    const removedUserId = '77777777-7777-4777-8777-777777777777';
    const membership = await membershipRepository.addMember({
      projectId,
      userId: removedUserId,
      role: 'collaborator',
      status: 'active',
      joinedAt: '2026-03-03T00:00:00.000Z',
      updatedAt: '2026-03-03T00:00:00.000Z',
    });
    await membershipRepository.removeMember(membership.id);

    await expect(
      useCase.execute({
        projectId,
        requesterId: removedUserId,
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('grants access to the project creator and lazily initializes canonical columns', async () => {
    const board = await useCase.execute({
      projectId,
      requesterId: creatorId,
    });

    expect(board.projectId).toBe(projectId);
    expect(board.columns).toHaveLength(3);
    expect(board.columns[0]).toMatchObject({ name: 'Por hacer', category: 'TODO', orderIndex: 0 });
    expect(board.columns[1]).toMatchObject({
      name: 'En progreso',
      category: 'IN_PROGRESS',
      orderIndex: 1,
    });
    expect(board.columns[2]).toMatchObject({ name: 'Completado', category: 'DONE', orderIndex: 2 });
  });

  it('grants access to active collaborator', async () => {
    const board = await useCase.execute({
      projectId,
      requesterId: collaboratorId,
    });

    expect(board.projectId).toBe(projectId);
    expect(board.columns).toHaveLength(3);
  });

  it('handles simultaneous concurrent invocations idempotently without duplicating columns', async () => {
    const [b1, b2, b3] = await Promise.all([
      useCase.execute({ projectId, requesterId: creatorId }),
      useCase.execute({ projectId, requesterId: collaboratorId }),
      useCase.execute({ projectId, requesterId: secondCollaboratorId }),
    ]);

    expect(b1.id).toBe(b2.id);
    expect(b2.id).toBe(b3.id);
    expect(b1.columns).toHaveLength(3);
    expect(b2.columns).toHaveLength(3);
  });
});
