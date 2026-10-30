import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardColumnResponse, MembershipResponse, TaskResponse } from '@is488/shared';
import { CreateTaskModal } from './CreateTaskModal.js';
const id = '11111111-1111-4111-8111-111111111111';
const candidate = '22222222-2222-4222-8222-222222222222';
const stamp = '2026-10-25T00:00:00.000Z';
const column: BoardColumnResponse = {
  id,
  boardId: id,
  name: 'Por hacer',
  orderIndex: 0,
  category: 'TODO',
  createdAt: stamp,
  updatedAt: stamp,
};
const member = (userId: string): MembershipResponse => ({
  id,
  userId,
  projectId: id,
  role: 'collaborator',
  status: 'active',
  removedAt: null,
  joinedAt: stamp,
  updatedAt: stamp,
});
const task: TaskResponse = {
  id,
  projectId: id,
  columnId: id,
  title: 'Creada',
  priority: 'MEDIUM',
  orderIndex: 0,
  labels: [],
  assigneeIds: [candidate],
  creatorId: id,
  createdAt: stamp,
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
describe('Creation responsible users', () => {
  it('preserves exact UUID selection, refuses dev identity conversion and prevents double sends', async () => {
    const pending = deferred<TaskResponse>();
    const submit = vi.fn().mockReturnValue(pending.promise);
    const close = vi.fn();
    render(
      <CreateTaskModal
        isOpen
        projectId={id}
        columns={[column]}
        initialColumnId={id}
        membersFetcher={async () => [member(candidate), member('dev-student-01')]}
        onSubmit={submit}
        onClose={close}
      />,
    );
    fireEvent.click(await screen.findByRole('checkbox', { name: candidate }));
    expect(screen.getByRole('checkbox', { name: /dev-student-01/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Creada' } });
    const form = screen.getByRole('button', { name: 'Crear tarea' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ assigneeIds: [candidate] }));
    expect(screen.getByRole('checkbox', { name: candidate })).toBeDisabled();
    await act(async () => pending.reject(new Error('Fallo')));
    expect(screen.getByRole('checkbox', { name: candidate })).toBeChecked();
    expect(screen.getByLabelText('Título *')).toHaveValue('Creada');
    expect(close).not.toHaveBeenCalled();
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores old creation %s after project change',
    async (settlement) => {
      const pending = deferred<TaskResponse>();
      const close = vi.fn();
      const submit = vi.fn().mockReturnValue(pending.promise);
      const members = async () => [member(candidate)];
      const { rerender } = render(
        <CreateTaskModal
          isOpen
          projectId={id}
          columns={[column]}
          initialColumnId={id}
          membersFetcher={members}
          onSubmit={submit}
          onClose={close}
        />,
      );
      fireEvent.click(await screen.findByRole('checkbox', { name: candidate }));
      fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Creada' } });
      fireEvent.click(screen.getByRole('button', { name: 'Crear tarea' }));
      rerender(
        <CreateTaskModal
          isOpen
          projectId={candidate}
          columns={[column]}
          initialColumnId={id}
          membersFetcher={members}
          onSubmit={submit}
          onClose={close}
        />,
      );
      fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Borrador actual' } });
      await act(async () => {
        if (settlement === 'resolve') pending.resolve(task);
        else pending.reject(new Error('Error antiguo'));
      });
      expect(screen.getByLabelText('Título *')).toHaveValue('Borrador actual');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(close).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Crear tarea' })).toBeEnabled();
    },
  );
});
