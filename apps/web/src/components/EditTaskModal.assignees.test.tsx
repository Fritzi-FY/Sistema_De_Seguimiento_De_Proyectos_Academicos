import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MembershipResponse, TaskResponse } from '@is488/shared';
import { EditTaskModal } from './EditTaskModal.js';

const id = '11111111-1111-4111-8111-111111111111';
const currentId = '22222222-2222-4222-8222-222222222222';
const candidateId = '33333333-3333-4333-8333-333333333333';
const stamp = '2026-10-25T00:00:00.000Z';
const task: TaskResponse = {
  id,
  projectId: id,
  columnId: id,
  title: 'Tarea de prueba',
  priority: 'MEDIUM',
  orderIndex: 0,
  labels: [],
  assigneeIds: [currentId],
  creatorId: id,
  createdAt: stamp,
  updatedAt: stamp,
};
const member = (userId: string, changes: Partial<MembershipResponse> = {}): MembershipResponse => ({
  id: userId,
  userId,
  projectId: id,
  role: 'collaborator',
  status: 'active',
  removedAt: changes.status === 'removed' ? stamp : null,
  joinedAt: stamp,
  updatedAt: stamp,
  ...changes,
});
const membersFetcher = async () => [member(candidateId)];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const save = () => screen.getByRole('button', { name: 'Guardar cambios' });

describe('Task detail responsible users', () => {
  it('muestra actuales, permite quitar ausentes, asignar activo y evita doble envío', async () => {
    const pending = deferred<TaskResponse>();
    const submit = vi.fn().mockReturnValue(pending.promise);
    const close = vi.fn();
    render(
      <EditTaskModal
        isOpen
        task={task}
        membersFetcher={membersFetcher}
        onClose={close}
        onSubmit={submit}
      />,
    );
    expect(
      within(screen.getByRole('region', { name: 'Responsables actuales' })).getByText(currentId),
    ).toBeInTheDocument();
    const candidate = await screen.findByRole('checkbox', { name: candidateId });
    fireEvent.click(candidate);
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(currentId) }));
    expect(screen.getByRole('checkbox', { name: new RegExp(currentId) })).toBeDisabled();
    fireEvent.submit(save().closest('form')!);
    fireEvent.submit(save().closest('form')!);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith({ assigneeIds: [candidateId] });
    expect(save()).toBeDisabled();
    expect(candidate).toBeDisabled();
    await act(async () => pending.resolve({ ...task, assigneeIds: [candidateId] }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('envía [] al quitar todos los responsables', async () => {
    const submit = vi.fn().mockResolvedValue({ ...task, assigneeIds: [] });
    render(
      <EditTaskModal
        isOpen
        task={task}
        membersFetcher={membersFetcher}
        onClose={() => {}}
        onSubmit={submit}
      />,
    );
    await screen.findByRole('checkbox', { name: candidateId });
    fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(currentId) }));
    await act(async () => fireEvent.click(save()));
    expect(submit).toHaveBeenCalledWith({ assigneeIds: [] });
  });

  it('omite responsables si el conjunto no cambió y no permite miembros ajenos, retirados ni IDs incompatibles', async () => {
    const submit = vi.fn().mockResolvedValue(task);
    const removed = '44444444-4444-4444-8444-444444444444';
    const outsider = '55555555-5555-4555-8555-555555555555';
    render(
      <EditTaskModal
        isOpen
        task={task}
        onClose={() => {}}
        onSubmit={submit}
        membersFetcher={async () => [
          member(currentId),
          member(removed, { status: 'removed' }),
          member(outsider, { projectId: outsider }),
          member('dev-student-01'),
        ]}
      />,
    );
    await screen.findByRole('checkbox', { name: /dev-student-01/ });
    expect(screen.getByRole('checkbox', { name: /dev-student-01/ })).toBeDisabled();
    expect(screen.queryByRole('checkbox', { name: new RegExp(removed) })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: new RegExp(outsider) })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: currentId }));
    fireEvent.click(screen.getByRole('checkbox', { name: currentId }));
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Título cambiado' } });
    await act(async () => fireEvent.click(save()));
    expect(submit).toHaveBeenCalledWith({ title: 'Título cambiado' });
  });

  it('reintenta miembros sin perder selección o campos y conserva cambios ante rechazo de mutación', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('Sin conexión'))
      .mockResolvedValueOnce([member(candidateId)]);
    const submit = vi.fn().mockRejectedValue(new Error('Miembro ya retirado'));
    render(
      <EditTaskModal
        isOpen
        task={task}
        membersFetcher={fetcher}
        onClose={() => {}}
        onSubmit={submit}
      />,
    );
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'Título cambiado' } });
    await screen.findByText(/Sin conexión/);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar miembros' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: candidateId }));
    fireEvent.click(save());
    expect(await screen.findByRole('alert')).toHaveTextContent('Miembro ya retirado');
    expect(screen.getByLabelText('Título *')).toHaveValue('Título cambiado');
    expect(screen.getByRole('checkbox', { name: candidateId })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: new RegExp(currentId) })).toBeChecked();
  });

  it.each(['resolve', 'reject'] as const)(
    'descarta %s tardío de miembros al cambiar tarea/proyecto',
    async (settlement) => {
      const old = deferred<MembershipResponse[]>();
      const latest = deferred<MembershipResponse[]>();
      const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
      const { rerender } = render(
        <EditTaskModal
          isOpen
          task={task}
          membersFetcher={fetcher}
          onClose={() => {}}
          onSubmit={vi.fn()}
        />,
      );
      const next = {
        ...task,
        id: candidateId,
        projectId: candidateId,
        title: 'Otra tarea',
        assigneeIds: [],
      };
      rerender(
        <EditTaskModal
          isOpen
          task={next}
          membersFetcher={fetcher}
          onClose={() => {}}
          onSubmit={vi.fn()}
        />,
      );
      await act(async () => {
        if (settlement === 'resolve') old.resolve([member(currentId)]);
        else old.reject(new Error('Error antiguo'));
      });
      expect(screen.getByText('Cargando miembros activos...')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByText(/Error antiguo/)).not.toBeInTheDocument();
      await act(async () => latest.resolve([]));
      expect(
        screen.getByText('No hay miembros activos disponibles para asignar.'),
      ).toBeInTheDocument();
      expect(screen.getByLabelText('Título *')).toHaveValue('Otra tarea');
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'descarta %s tardío de guardado y miembros tras cerrar y reabrir',
    async (settlement) => {
      const pending = deferred<TaskResponse>();
      const oldMembers = deferred<MembershipResponse[]>();
      const fetcher = vi.fn().mockReturnValueOnce(oldMembers.promise).mockResolvedValueOnce([]);
      const close = vi.fn();
      const submit = vi.fn().mockReturnValue(pending.promise);
      const { rerender } = render(
        <EditTaskModal
          isOpen
          task={task}
          membersFetcher={fetcher}
          onClose={close}
          onSubmit={submit}
        />,
      );
      fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(currentId) }));
      fireEvent.click(save());
      rerender(
        <EditTaskModal
          isOpen={false}
          task={task}
          membersFetcher={fetcher}
          onClose={close}
          onSubmit={submit}
        />,
      );
      rerender(
        <EditTaskModal
          isOpen
          task={{ ...task, id: candidateId, title: 'Otra tarea', assigneeIds: [] }}
          membersFetcher={fetcher}
          onClose={close}
          onSubmit={submit}
        />,
      );
      await act(async () => {
        if (settlement === 'resolve') {
          oldMembers.resolve([member(currentId)]);
          pending.resolve(task);
        } else {
          oldMembers.reject(new Error('Antiguo'));
          pending.reject(new Error('Antiguo'));
        }
      });
      expect(close).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Título *')).toHaveValue('Otra tarea');
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    },
  );

  it('muestra el vacío real del historial sin inventar eventos', async () => {
    render(
      <EditTaskModal
        isOpen
        task={task}
        membersFetcher={membersFetcher}
        activityFetcher={async () => []}
        onClose={() => {}}
        onSubmit={vi.fn()}
      />,
    );
    expect(await screen.findByText('Sin actividad registrada.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reintentar historial/ })).not.toBeInTheDocument();
    await screen.findByRole('checkbox', { name: candidateId });
  });

  it('valida el patch antes de despachar una actualización inválida', async () => {
    const submit = vi.fn();
    render(
      <EditTaskModal
        isOpen
        task={task}
        membersFetcher={membersFetcher}
        onClose={() => {}}
        onSubmit={submit}
      />,
    );
    await screen.findByRole('checkbox', { name: candidateId });
    fireEvent.change(screen.getByLabelText('Título *'), { target: { value: 'x' } });
    fireEvent.submit(save().closest('form')!);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
