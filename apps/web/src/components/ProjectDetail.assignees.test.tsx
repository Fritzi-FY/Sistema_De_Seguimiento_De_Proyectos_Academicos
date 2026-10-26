import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  BoardResponse,
  MembershipResponse,
  ProjectResponse,
  TaskResponse,
} from '@is488/shared';
import { ProjectDetail } from './ProjectDetail.js';
import * as service from '../services/task.service.js';

const id = '11111111-1111-4111-8111-111111111111';
const assignee = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-25T00:00:00.000Z';
const task: TaskResponse = {
  id,
  projectId: id,
  columnId: id,
  title: 'Asignación verificable',
  priority: 'MEDIUM',
  orderIndex: 0,
  labels: [],
  assigneeIds: [],
  creatorId: id,
  createdAt: stamp,
  updatedAt: stamp,
};
const project: ProjectResponse = {
  id,
  title: 'Proyecto',
  courseCode: 'IS488',
  status: 'active',
  creatorId: id,
  startDate: stamp,
  targetDate: stamp,
  createdAt: stamp,
  updatedAt: stamp,
};
const board: BoardResponse = {
  id,
  projectId: id,
  createdAt: stamp,
  updatedAt: stamp,
  columns: [
    {
      id,
      boardId: id,
      name: 'Por hacer',
      orderIndex: 0,
      category: 'TODO',
      createdAt: stamp,
      updatedAt: stamp,
    },
  ],
};
const member: MembershipResponse = {
  id: assignee,
  userId: assignee,
  projectId: id,
  role: 'collaborator',
  status: 'active',
  joinedAt: stamp,
  updatedAt: stamp,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('Responsible users in ProjectDetail', () => {
  it('bloquea el selector al crear con responsables y conserva el payload UUID', async () => {
    const pending = deferred<TaskResponse>();
    const create = vi.spyOn(service, 'createTask').mockReturnValue(pending.promise);
    try {
      render(
        <ProjectDetail
          project={project}
          onBack={() => {}}
          boardFetcher={async () => board}
          tasksFetcher={async () => []}
          membersFetcher={async () => [member]}
        />,
      );
      const boardElement = await screen.findByTestId('kanban-board');
      fireEvent.click(screen.getByRole('button', { name: 'Agregar tarea' }));
      fireEvent.click(await screen.findByRole('checkbox', { name: assignee }));
      fireEvent.change(screen.getByLabelText('Título *'), {
        target: { value: 'Asignación verificable' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
      expect(create).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ assigneeIds: [assignee] }),
        undefined,
        undefined,
      );
      expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled();
      expect(screen.getByTestId('kanban-board')).toBe(boardElement);
      await act(async () => pending.resolve({ ...task, assigneeIds: [assignee] }));
      expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByText('Asignación verificable')).toBeInTheDocument();
    } finally {
      create.mockRestore();
    }
  });
  it('bloquea selector durante PATCH de responsables, desbloquea en rechazo/éxito y muestra confirmación al reabrir', async () => {
    const failed = deferred<TaskResponse>();
    const succeeded = deferred<TaskResponse>();
    const update = vi
      .spyOn(service, 'updateTask')
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(succeeded.promise);
    try {
      render(
        <ProjectDetail
          project={project}
          onBack={() => {}}
          boardFetcher={async () => board}
          tasksFetcher={async () => [task]}
          membersFetcher={async () => [member]}
        />,
      );
      const boardElement = await screen.findByTestId('kanban-board');
      fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
      fireEvent.click(await screen.findByRole('checkbox', { name: assignee }));
      fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      expect(update).toHaveBeenCalledWith(
        id,
        id,
        { assigneeIds: [assignee] },
        undefined,
        undefined,
      );
      expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
      expect(screen.getByTestId('kanban-board')).toBe(boardElement);
      await act(async () => failed.reject(new Error('Fallo controlado')));
      expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled();
      expect(screen.getByRole('checkbox', { name: assignee })).toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
      expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled();
      await act(async () => succeeded.resolve({ ...task, assigneeIds: [assignee] }));
      expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Editar tarea' }));
      await screen.findByRole('checkbox', { name: assignee });
      expect(
        within(screen.getByRole('region', { name: 'Responsables actuales' })).getByText(assignee),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    } finally {
      update.mockRestore();
    }
  });
});
