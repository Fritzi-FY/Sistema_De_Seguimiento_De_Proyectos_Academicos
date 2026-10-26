import type { ComponentProps } from 'react';
import type * as DndCore from '@dnd-kit/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardResponse, ProjectResponse, TaskResponse } from '@is488/shared';
import { ProjectDetail } from './ProjectDetail.js';
import * as service from '../services/task.service.js';

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof DndCore>();
  return {
    ...actual,
    DndContext: (props: ComponentProps<typeof actual.DndContext>) => (
      <actual.DndContext {...props}>
        <button
          onClick={() =>
            props.onDragEnd?.({
              active: { id: 'task' },
              over: { id: 'column:22222222-2222-4222-8222-222222222222' },
            } as Parameters<NonNullable<typeof props.onDragEnd>>[0])
          }
        >
          Simular movimiento
        </button>
        {props.children}
      </actual.DndContext>
    ),
  };
});

const project: ProjectResponse = {
  id: 'A',
  title: 'Proyecto de prueba',
  description: '',
  courseCode: 'IS488',
  status: 'active',
  creatorId: 'user',
  startDate: '2026-10-01T00:00:00Z',
  targetDate: '2026-12-01T00:00:00Z',
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
};
const task: TaskResponse = {
  id: 'task',
  projectId: 'A',
  columnId: '11111111-1111-4111-8111-111111111111',
  title: 'Tarea original',
  priority: 'MEDIUM',
  orderIndex: 0,
  labels: [],
  assigneeIds: [],
  creatorId: 'user',
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
};
const board: BoardResponse = {
  id: 'board',
  projectId: 'A',
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  columns: ['first', 'second'].map((id, orderIndex) => ({
    id:
      orderIndex === 0
        ? '11111111-1111-4111-8111-111111111111'
        : '22222222-2222-4222-8222-222222222222',
    boardId: 'board',
    name: id,
    orderIndex,
    category: 'TODO',
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  })),
};
const props = {
  project,
  onBack: () => {},
  membersFetcher: async () => [],
  boardFetcher: async () => board,
  tasksFetcher: async () => [task],
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
afterEach(() => vi.restoreAllMocks());

describe('ProjectDetail view integration', () => {
  it('actualiza la vista activa y conserva responsable y filtros aplicados de Lista', async () => {
    const boardFetcher = vi.fn(async () => board);
    const tasksFetcher = vi.fn(async () => [task]);
    const pageFetcher = vi
      .fn()
      .mockResolvedValue({ items: [task], totalItems: 1, totalPages: 1, page: 1, limit: 20 });
    render(
      <ProjectDetail
        {...props}
        boardFetcher={boardFetcher}
        tasksFetcher={tasksFetcher}
        taskPageFetcher={pageFetcher}
      />,
    );
    await screen.findByTestId('kanban-board');
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar vista de tablero' }));
    await waitFor(() => expect(tasksFetcher).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('Responsable (UUID)'), {
      target: { value: board.columns[0]!.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(pageFetcher).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Responsable (UUID)'), {
      target: { value: board.columns[1]!.id },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar vista de lista' }));
    await waitFor(() => expect(pageFetcher).toHaveBeenCalledTimes(3));
    expect(pageFetcher.mock.calls[2]?.[1]).toEqual({
      assigneeId: board.columns[0]!.id,
      page: 1,
      limit: 20,
    });
    expect(screen.getByLabelText('Responsable (UUID)')).toHaveValue(board.columns[1]!.id);
    expect(screen.getByText('Consulta tareas y aplica filtros.')).toBeInTheDocument();
  });
  it('consulta página 1 en cada entrada y reinicia a Tablero al cambiar proyecto', async () => {
    const pageFetcher = vi
      .fn()
      .mockResolvedValue({ items: [task], totalItems: 21, totalPages: 2, page: 1, limit: 20 });
    const { rerender } = render(<ProjectDetail {...props} taskPageFetcher={pageFetcher} />);
    await screen.findByTestId('kanban-board');
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() => expect(pageFetcher).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Tablero' }));
    await screen.findByTestId('kanban-board');
    pageFetcher.mockResolvedValue({
      items: [{ ...task, title: 'Actualizada en tablero' }],
      totalItems: 1,
      totalPages: 1,
      page: 1,
      limit: 20,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    await screen.findByText('Actualizada en tablero');
    expect(pageFetcher.mock.calls[2]?.slice(0, 2)).toEqual(['A', { page: 1, limit: 20 }]);
    rerender(
      <ProjectDetail {...props} project={{ ...project, id: 'B' }} taskPageFetcher={pageFetcher} />,
    );
    expect(screen.getByRole('button', { name: 'Tablero' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('Actualizada en tablero')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
    await waitFor(() =>
      expect(pageFetcher.mock.calls[3]?.slice(0, 2)).toEqual(['B', { page: 1, limit: 20 }]),
    );
  });

  it.each(['create', 'edit', 'move'] as const)(
    'bloquea selector y conserva tablero durante %s, tanto éxito como rechazo',
    async (operation) => {
      const first = deferred<TaskResponse>();
      const second = deferred<TaskResponse>();
      const mutation = vi
        .spyOn(
          service,
          operation === 'create' ? 'createTask' : operation === 'edit' ? 'updateTask' : 'moveTask',
        )
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise);
      render(<ProjectDetail {...props} />);
      const boardElement = await screen.findByTestId('kanban-board');
      const start = async () => {
        if (operation === 'move')
          fireEvent.click(screen.getByRole('button', { name: 'Simular movimiento' }));
        else {
          fireEvent.click(
            operation === 'create'
              ? screen.getAllByRole('button', { name: /Agregar tarea/ })[0]!
              : screen.getByRole('button', { name: 'Editar tarea' }),
          );
          fireEvent.change(screen.getByLabelText('Título *'), {
            target: { value: 'Título cambiado' },
          });
          fireEvent.click(
            screen.getByRole('button', {
              name: operation === 'create' ? 'Crear tarea' : 'Guardar cambios',
            }),
          );
        }
        await waitFor(() => expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled());
        expect(screen.getByText(/Operación de tarea pendiente/)).toHaveAttribute('role', 'status');
        fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
        expect(screen.getByTestId('kanban-board')).toBe(boardElement);
        expect(screen.queryByRole('table')).not.toBeInTheDocument();
      };
      await start();
      await act(async () => first.reject(new Error('Fallo controlado')));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled());
      if (operation !== 'move') {
        fireEvent.click(
          screen.getByRole('button', {
            name: operation === 'create' ? 'Crear tarea' : 'Guardar cambios',
          }),
        );
        await waitFor(() => expect(mutation).toHaveBeenCalledTimes(2));
        expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled();
      } else await start();
      await act(async () =>
        second.resolve({
          ...task,
          id: operation === 'create' ? 'created' : task.id,
          title: 'Título cambiado',
          columnId: operation === 'move' ? '22222222-2222-4222-8222-222222222222' : task.columnId,
        }),
      );
      await waitFor(() => expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled());
      expect(screen.getByText('Título cambiado')).toBeInTheDocument();
      expect(screen.getByTestId('kanban-board')).toBe(boardElement);
    },
  );
});
