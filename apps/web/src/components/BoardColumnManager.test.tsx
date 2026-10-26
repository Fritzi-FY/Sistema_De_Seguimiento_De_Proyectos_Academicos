import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { BoardResponse, ProjectResponse, TaskResponse } from '@is488/shared';
import { KanbanBoard } from './KanbanBoard.js';
import { ProjectDetail } from './ProjectDetail.js';
import * as service from '../services/board.service.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const boardId = '22222222-2222-4222-8222-222222222222';
const ids = [
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];
const stamp = '2026-10-26T00:00:00Z';
function fixture(): BoardResponse {
  return {
    id: boardId,
    projectId,
    createdAt: stamp,
    updatedAt: stamp,
    columns: ids.map((id, index) => ({
      id,
      boardId,
      name: ['Por hacer', 'En progreso', 'Hecho'][index]!,
      category: (['TODO', 'IN_PROGRESS', 'DONE'] as const)[index]!,
      orderIndex: index,
      createdAt: stamp,
      updatedAt: stamp,
    })),
  };
}
const project: ProjectResponse = {
  id: projectId,
  title: 'Proyecto columnas',
  courseCode: 'IS488',
  creatorId: projectId,
  status: 'active',
  startDate: stamp,
  targetDate: stamp,
  createdAt: stamp,
  updatedAt: stamp,
};
const task: TaskResponse = {
  id: '66666666-6666-4666-8666-666666666666',
  projectId,
  columnId: ids[0]!,
  title: 'Tarea existente',
  creatorId: projectId,
  orderIndex: 0,
  priority: 'MEDIUM',
  labels: [],
  assigneeIds: [],
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
afterEach(() => vi.restoreAllMocks());

it('creates optional review, renames, orders and refreshes List filter options from server', async () => {
  let board = fixture();
  const boardFetcher = vi.fn(async () => board);
  const tasksFetcher = async () => [];
  const create = vi
    .spyOn(service, 'createBoardColumn')
    .mockImplementation(async (_project, _board, data) => {
      const column = {
        ...board.columns[0]!,
        ...data,
        id: '77777777-7777-4777-8777-777777777777',
        orderIndex: 3,
      };
      board = { ...board, columns: [...board.columns, column] };
      return column;
    });
  const update = vi
    .spyOn(service, 'updateBoardColumn')
    .mockImplementation(async (_project, _board, id, data) => {
      const previous = board.columns.find((item) => item.id === id)!;
      const column = {
        ...previous,
        name: data.name ?? previous.name,
        orderIndex: data.orderIndex ?? previous.orderIndex,
      };
      const columns = board.columns.filter((item) => item.id !== id);
      columns.splice(data.orderIndex ?? column.orderIndex, 0, column);
      board = { ...board, columns: columns.map((item, index) => ({ ...item, orderIndex: index })) };
      return board.columns.find((item) => item.id === id)!;
    });
  render(
    <ProjectDetail
      project={project}
      onBack={() => {}}
      membersFetcher={async () => []}
      boardFetcher={boardFetcher}
      tasksFetcher={tasksFetcher}
      taskPageFetcher={async () => ({
        items: [],
        page: 1,
        limit: 20,
        totalItems: 0,
        totalPages: 0,
      })}
    />,
  );
  await screen.findByTestId('kanban-board');
  expect(screen.getAllByTestId(/^kanban-column-/)).toHaveLength(3);
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  expect(screen.getByLabelText('Nombre de columna')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Nombre de columna'), {
    target: { value: 'En revisión' },
  });
  fireEvent.change(screen.getByLabelText('Categoría de columna'), {
    target: { value: 'IN_REVIEW' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Crear columna' }));
  await screen.findByText('Cambio de columnas confirmado.');
  expect(create).toHaveBeenCalledWith(projectId, boardId, {
    name: 'En revisión',
    category: 'IN_REVIEW',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Renombrar En revisión' }));
  fireEvent.change(screen.getByLabelText('Nombre de columna'), {
    target: { value: 'Revisión final' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Renombrar columna' }));
  await screen.findByRole('button', { name: 'Mover Revisión final antes' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Mover Revisión final antes' })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mover Revisión final antes' }));
  await waitFor(() =>
    expect(update).toHaveBeenLastCalledWith(
      projectId,
      boardId,
      board.columns.find((item) => item.name === 'Revisión final')!.id,
      { name: undefined, orderIndex: 2 },
    ),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Lista' }));
  const option = await screen.findByRole('option', { name: 'Revisión final' });
  expect(option).toHaveValue('77777777-7777-4777-8777-777777777777');
  expect(screen.queryByRole('option', { name: 'En revisión' })).not.toBeInTheDocument();
  expect(boardFetcher.mock.calls.length).toBeGreaterThanOrEqual(5);
});

it('requires confirmation and destination, delegates task relocation and refreshes tasks', async () => {
  let board = fixture();
  let tasks = [task];
  const remove = vi
    .spyOn(service, 'deleteBoardColumn')
    .mockImplementation(async (_project, id, query) => {
      board = {
        ...board,
        columns: board.columns
          .filter((column) => column.id !== id)
          .map((column, index) => ({ ...column, orderIndex: index })),
      };
      tasks = [{ ...task, columnId: query!.targetColumnId! }];
      return { success: true, deletedColumnId: id, migratedTasksCount: 1 };
    });
  render(
    <KanbanBoard
      projectId={projectId}
      boardFetcher={async () => board}
      tasksFetcher={async () => tasks}
    />,
  );
  await screen.findByTestId('kanban-board');
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Por hacer' }));
  expect(screen.getByRole('button', { name: 'Cancelar eliminación' })).toHaveFocus();
  fireEvent.submit(screen.getByRole('form', { name: 'Confirmar eliminación de Por hacer' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar eliminación' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Por hacer' }));
  fireEvent.change(screen.getByLabelText(/Destino de las tareas/), { target: { value: ids[1] } });
  fireEvent.submit(screen.getByRole('form', { name: 'Confirmar eliminación de Por hacer' }));
  await screen.findByText('Cambio de columnas confirmado.');
  expect(remove).toHaveBeenCalledWith(projectId, ids[0], { targetColumnId: ids[1] });
  expect(screen.queryByTestId(`kanban-column-${ids[0]}`)).not.toBeInTheDocument();
  expect(
    within(screen.getByTestId(`kanban-column-${ids[1]}`)).getByText('Tarea existente'),
  ).toBeInTheDocument();
});

it('blocks duplicate sends, task controls and view switches until confirmation plus refresh', async () => {
  const pending = deferred<ReturnType<typeof fixture>['columns'][number]>();
  const refresh = deferred<BoardResponse>();
  const board = fixture();
  const create = vi.spyOn(service, 'createBoardColumn').mockReturnValue(pending.promise);
  const boardFetcher = vi.fn().mockResolvedValueOnce(board).mockReturnValue(refresh.promise);
  render(
    <ProjectDetail
      project={project}
      onBack={() => {}}
      membersFetcher={async () => []}
      boardFetcher={boardFetcher}
      tasksFetcher={async () => []}
    />,
  );
  await screen.findByTestId('kanban-board');
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  fireEvent.change(screen.getByLabelText('Nombre de columna'), { target: { value: 'Nueva' } });
  const form = screen.getByRole('form', { name: 'Crear columna' });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled();
  expect(
    screen
      .getAllByRole('button', { name: 'Agregar tarea' })
      .every((button) => button.hasAttribute('disabled')),
  ).toBe(true);
  expect(screen.queryByText('Cambio de columnas confirmado.')).not.toBeInTheDocument();
  await act(async () => pending.resolve({ ...board.columns[0]!, name: 'Nueva' }));
  expect(screen.getByRole('button', { name: 'Lista' })).toBeDisabled();
  await act(async () => refresh.resolve(board));
  await screen.findByText('Cambio de columnas confirmado.');
  expect(screen.getByRole('button', { name: 'Lista' })).toBeEnabled();
});

it('keeps errors visible, never retries writes and requires read reconciliation', async () => {
  const board = fixture();
  const create = vi
    .spyOn(service, 'createBoardColumn')
    .mockRejectedValue(new Error('Conflicto del servidor'));
  const boardFetcher = vi.fn().mockResolvedValue(board);
  render(
    <KanbanBoard projectId={projectId} boardFetcher={boardFetcher} tasksFetcher={async () => []} />,
  );
  await screen.findByTestId('kanban-board');
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  fireEvent.change(screen.getByLabelText('Nombre de columna'), {
    target: { value: 'Conservar nombre' },
  });
  fireEvent.submit(screen.getByRole('form', { name: 'Crear columna' }));
  await screen.findAllByText(/Conflicto del servidor/);
  expect(screen.getByLabelText('Nombre de columna')).toHaveValue('Conservar nombre');
  expect(screen.queryByText('Cambio de columnas confirmado.')).not.toBeInTheDocument();
  fireEvent.submit(screen.getByRole('form', { name: 'Crear columna' }));
  expect(create).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar tablero' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Crear columna' })).toBeEnabled());
  expect(create).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)(
  'ignores late %s after project change and unmount',
  async (settlement) => {
    const board = fixture();
    const pending = deferred<(typeof board.columns)[number]>();
    vi.spyOn(service, 'createBoardColumn').mockReturnValue(pending.promise);
    const boardFetcher = async (id: string) => ({ ...board, projectId: id });
    const tasksFetcher = async () => [];
    const { rerender, unmount } = render(
      <KanbanBoard projectId={projectId} boardFetcher={boardFetcher} tasksFetcher={tasksFetcher} />,
    );
    await screen.findByTestId('kanban-board');
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
    fireEvent.change(screen.getByLabelText('Nombre de columna'), { target: { value: 'Obsoleta' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Crear columna' }));
    rerender(
      <KanbanBoard projectId={ids[2]!} boardFetcher={boardFetcher} tasksFetcher={tasksFetcher} />,
    );
    await screen.findByTestId('kanban-board');
    await act(async () => {
      if (settlement === 'resolve') pending.resolve({ ...board.columns[0]!, name: 'Obsoleta' });
      else pending.reject(new Error('Error obsoleto'));
    });
    expect(screen.queryByText('Cambio de columnas confirmado.')).not.toBeInTheDocument();
    expect(screen.queryByText(/Error obsoleto/)).not.toBeInTheDocument();
    unmount();
  },
);

it('prevents deleting last column and cancels management with Escape', async () => {
  const board = fixture();
  board.columns = [board.columns[0]!];
  render(
    <KanbanBoard
      projectId={projectId}
      boardFetcher={async () => board}
      tasksFetcher={async () => []}
    />,
  );
  await screen.findByTestId('kanban-board');
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  expect(screen.getByRole('button', { name: 'Eliminar Por hacer' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mover Por hacer antes' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mover Por hacer después' })).toBeDisabled();
  fireEvent.keyDown(screen.getByLabelText('Nombre de columna'), { key: 'Escape' });
  expect(screen.getByRole('button', { name: 'Gestionar columnas' })).toHaveFocus();
});

it('moves after, cancels rename, rejects blank name and deletes empty column only after confirmation', async () => {
  let board = fixture();
  const update = vi.spyOn(service, 'updateBoardColumn').mockResolvedValue(board.columns[0]!);
  const remove = vi.spyOn(service, 'deleteBoardColumn').mockImplementation(async (_project, id) => {
    board = { ...board, columns: board.columns.filter((column) => column.id !== id) };
    return { success: true, deletedColumnId: id, migratedTasksCount: 0 };
  });
  render(
    <KanbanBoard
      projectId={projectId}
      boardFetcher={async () => board}
      tasksFetcher={async () => []}
    />,
  );
  await screen.findByTestId('kanban-board');
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mover Por hacer después' }));
  await screen.findByText('Cambio de columnas confirmado.');
  expect(update).toHaveBeenCalledWith(projectId, boardId, ids[0], {
    name: undefined,
    orderIndex: 1,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Renombrar Por hacer' }));
  fireEvent.change(screen.getByLabelText('Nombre de columna'), { target: { value: '   ' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Renombrar columna' }));
  await screen.findByRole('alert');
  expect(update).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar cambio de nombre' }));
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar Por hacer' }));
  expect(remove).not.toHaveBeenCalled();
  fireEvent.submit(screen.getByRole('form', { name: 'Confirmar eliminación de Por hacer' }));
  await waitFor(() =>
    expect(screen.queryByTestId(`kanban-column-${ids[0]}`)).not.toBeInTheDocument(),
  );
  expect(remove).toHaveBeenCalledWith(projectId, ids[0], { targetColumnId: undefined });
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar gestión de columnas' }));
  expect(screen.queryByLabelText('Nombre de columna')).not.toBeInTheDocument();
});

it('does not announce success when post-write refresh fails and preserves recovery after a second read failure', async () => {
  const board = fixture();
  const create = vi.spyOn(service, 'createBoardColumn').mockResolvedValue(board.columns[0]!);
  const boardFetcher = vi
    .fn()
    .mockResolvedValueOnce(board)
    .mockRejectedValueOnce(new Error('Lectura fallida'))
    .mockRejectedValueOnce(new Error('Sigue sin conexión'))
    .mockResolvedValue(board);
  render(
    <KanbanBoard projectId={projectId} boardFetcher={boardFetcher} tasksFetcher={async () => []} />,
  );
  await screen.findByTestId('kanban-board');
  fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
  fireEvent.change(screen.getByLabelText('Nombre de columna'), { target: { value: 'Pendiente' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Crear columna' }));
  await screen.findAllByText(/Lectura fallida/);
  expect(screen.queryByText('Cambio de columnas confirmado.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar tablero' }));
  await screen.findByText(/Sigue sin conexión/);
  expect(screen.getByRole('button', { name: 'Crear columna' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar tablero' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Crear columna' })).toBeEnabled());
  expect(create).toHaveBeenCalledTimes(1);
});

it.each(['resolve', 'reject'] as const)(
  'ignores late %s after unmount without refetching',
  async (settlement) => {
    const board = fixture();
    const pending = deferred<(typeof board.columns)[number]>();
    vi.spyOn(service, 'createBoardColumn').mockReturnValue(pending.promise);
    const boardFetcher = vi.fn(async () => board);
    const { unmount } = render(
      <KanbanBoard
        projectId={projectId}
        boardFetcher={boardFetcher}
        tasksFetcher={async () => []}
      />,
    );
    await screen.findByTestId('kanban-board');
    fireEvent.click(screen.getByRole('button', { name: 'Gestionar columnas' }));
    fireEvent.change(screen.getByLabelText('Nombre de columna'), { target: { value: 'Tardía' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Crear columna' }));
    unmount();
    await act(async () => {
      if (settlement === 'resolve') pending.resolve(board.columns[0]!);
      else pending.reject(new Error('Tardía'));
    });
    expect(boardFetcher).toHaveBeenCalledTimes(1);
  },
);
