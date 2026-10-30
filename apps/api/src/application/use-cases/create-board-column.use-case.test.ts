import { describe, it, expect, beforeEach } from 'vitest';
import { CreateBoardColumnUseCase } from './create-board-column.use-case.js';
import { UpdateBoardColumnUseCase } from './update-board-column.use-case.js';
import { InMemoryBoardRepository } from '../../infrastructure/adapters/repositories/in-memory-board.repository.js';
import { InMemoryProjectRepository } from '../../infrastructure/adapters/repositories/in-memory-project.repository.js';
import { InMemoryMembershipRepository } from '../../infrastructure/adapters/repositories/in-memory-membership.repository.js';
import { MaxColumnsReachedError } from '@is488/shared';
import type { Project } from '@is488/shared';

describe('CreateBoardColumnUseCase & UpdateBoardColumnUseCase', () => {
  let boardRepository: InMemoryBoardRepository;
  let projectRepository: InMemoryProjectRepository;
  let membershipRepository: InMemoryMembershipRepository;
  let createUseCase: CreateBoardColumnUseCase;
  let updateUseCase: UpdateBoardColumnUseCase;

  const projectId = '11111111-1111-4111-8111-111111111111';
  const creatorId = '22222222-2222-4222-8222-222222222222';
  const collaboratorId = '33333333-3333-4333-8333-333333333333';
  const unassignedTeacherId = '55555555-5555-4555-8555-555555555555';
  const outsiderId = '66666666-6666-4666-8666-666666666666';

  const sampleProject: Project = {
    id: projectId,
    title: 'Proyecto IS488',
    description: 'Kanban Column Test',
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
    createUseCase = new CreateBoardColumnUseCase(
      boardRepository,
      projectRepository,
      membershipRepository,
    );
    updateUseCase = new UpdateBoardColumnUseCase(
      boardRepository,
      projectRepository,
      membershipRepository,
    );

    await projectRepository.save(sampleProject);

    await membershipRepository.addMember({
      projectId,
      userId: collaboratorId,
      role: 'collaborator',
      status: 'active',
      removedAt: null,
      joinedAt: '2026-03-02T00:00:00.000Z',
      updatedAt: '2026-03-02T00:00:00.000Z',
    });
  });

  describe('CreateBoardColumnUseCase', () => {
    it('creates a new column with correlative orderIndex when authorized', async () => {
      const col = await createUseCase.execute({
        projectId,
        requesterId: collaboratorId,
        name: 'En revisión',
        category: 'IN_REVIEW',
        color: '#f59e0b',
      });

      expect(col.name).toBe('En revisión');
      expect(col.category).toBe('IN_REVIEW');
      expect(col.color).toBe('#f59e0b');
      expect(col.orderIndex).toBe(3);
    });

    it('rejects creating an 11th column with 400 Bad Request (MaxColumnsReachedError)', async () => {
      for (let i = 3; i < 10; i++) {
        await createUseCase.execute({
          projectId,
          requesterId: creatorId,
          name: `Columna ${i + 1}`,
          category: 'TODO',
        });
      }

      await expect(
        createUseCase.execute({
          projectId,
          requesterId: creatorId,
          name: 'Undécima columna',
          category: 'TODO',
        }),
      ).rejects.toThrow(MaxColumnsReachedError);

      await expect(
        createUseCase.execute({
          projectId,
          requesterId: creatorId,
          name: 'Undécima columna',
          category: 'TODO',
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects with 404 when requester is a teacher without real assignment evidence (default denial)', async () => {
      await expect(
        createUseCase.execute({
          projectId,
          requesterId: unassignedTeacherId,
          name: 'Columna docente sin asignación',
          category: 'TODO',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 404 when requester is an outsider', async () => {
      await expect(
        createUseCase.execute({
          projectId,
          requesterId: outsiderId,
          name: 'Columna ajena',
          category: 'TODO',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 400 when name is empty or invalid', async () => {
      await expect(
        createUseCase.execute({
          projectId,
          requesterId: creatorId,
          name: '',
          category: 'TODO',
        }),
      ).rejects.toThrow();
    });
  });

  describe('UpdateBoardColumnUseCase', () => {
    it('updates column name and category successfully when authorized', async () => {
      const board = await boardRepository.findOrCreateDefaultBoard(projectId);
      const targetColumn = board.columns[0]!;

      const updated = await updateUseCase.execute({
        projectId,
        columnId: targetColumn.id,
        requesterId: collaboratorId,
        name: 'Backlog Priorizado',
        category: 'TODO',
        color: '#6366f1',
      });

      expect(updated.id).toBe(targetColumn.id);
      expect(updated.name).toBe('Backlog Priorizado');
      expect(updated.color).toBe('#6366f1');
    });

    it('rejects with 404 when updating column of another project or non-existent', async () => {
      await expect(
        updateUseCase.execute({
          projectId,
          columnId: '00000000-0000-4000-8000-000000000000',
          requesterId: creatorId,
          name: 'No existe',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects with 404 when teacher without assignment evidence tries to update column (default denial)', async () => {
      const board = await boardRepository.findOrCreateDefaultBoard(projectId);
      const targetColumn = board.columns[0]!;

      await expect(
        updateUseCase.execute({
          projectId,
          columnId: targetColumn.id,
          requesterId: unassignedTeacherId,
          name: 'Intento no autorizado',
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
