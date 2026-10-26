import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoardResponse, PaginatedTasksResponse } from '@is488/shared';
import { TaskListView } from './TaskListView.js';

const columnId = '11111111-1111-4111-8111-111111111111';
const board: BoardResponse = {
  id: columnId,
  projectId: 'A',
  createdAt: '',
  updatedAt: '',
  columns: [
    {
      id: columnId,
      boardId: columnId,
      name: 'Por hacer',
      orderIndex: 0,
      category: 'TODO',
      createdAt: '',
      updatedAt: '',
    },
  ],
};
const page = (number = 1): PaginatedTasksResponse => ({
  page: number,
  limit: 20,
  totalItems: 21,
  totalPages: 2,
  items: ['Zeta', 'Alfa'].map((title, index) => ({
    id: title,
    title,
    projectId: 'A',
    columnId,
    priority: 'LOW',
    orderIndex: index,
    labels: [],
    assigneeIds: [],
    creatorId: 'user',
    createdAt: '',
    updatedAt: '',
  })),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function applyText(text: string) {
  fireEvent.change(screen.getByLabelText('Buscar texto'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
}

describe('List server filter integration', () => {
  it('reinicia página atómicamente y conserva filtros aplicados al paginar/reintentar, independientemente del borrador', async () => {
    const fetcher = vi.fn().mockImplementation(async (_id, query) => page(query.page));
    render(<TaskListView projectId="A" tasksFetcher={fetcher} boardFetcher={async () => board} />);
    await screen.findByRole('option', { name: 'Por hacer' });
    await screen.findByText('Zeta');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText(/Página 2 de 2/);
    fireEvent.change(screen.getByLabelText('Columna'), { target: { value: columnId } });
    fireEvent.change(screen.getByLabelText('Prioridad'), { target: { value: 'HIGH' } });
    fireEvent.change(screen.getByLabelText('Responsable (UUID)'), { target: { value: columnId } });
    fireEvent.change(screen.getByLabelText('Etiqueta exacta'), { target: { value: ' UX ' } });
    applyText(' QA ');
    await screen.findByText(/Página 1 de 2/);
    const filters = { search: 'QA', columnId, priority: 'HIGH', label: 'UX', assigneeId: columnId };
    expect(fetcher.mock.calls[2]?.[1]).toEqual({ ...filters, page: 1, limit: 20 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Zeta');
    expect(rows[2]).toHaveTextContent('Alfa');
    fireEvent.change(screen.getByLabelText('Buscar texto'), { target: { value: 'No aplicado' } });
    fetcher.mockRejectedValueOnce(new Error('Fallo de página'));
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await screen.findByText(/Fallo de página/);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText(/Página 2 de 2/);
    expect(fetcher.mock.calls[3]?.[1]).toEqual({ ...filters, page: 2, limit: 20 });
    expect(fetcher.mock.calls[4]?.[1]).toEqual({ ...filters, page: 2, limit: 20 });
    fireEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }));
    await screen.findByText(/Página 1 de 2/);
    expect(fetcher.mock.calls[5]?.[1]).toEqual({ page: 1, limit: 20 });
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('muestra cero coincidencias sin página imposible y deshabilita navegación', async () => {
    render(
      <TaskListView
        projectId="A"
        boardFetcher={async () => board}
        tasksFetcher={async () => ({ items: [], page: 1, limit: 20, totalItems: 0, totalPages: 0 })}
      />,
    );
    await screen.findByText('Sin coincidencias');
    expect(screen.queryByText(/Página 1 de 0/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  it.each(['resolve', 'reject'] as const)(
    'descarta %s de filtros anteriores incluso si abort no detiene transporte',
    async (settlement) => {
      const old = deferred<PaginatedTasksResponse>();
      const current = deferred<PaginatedTasksResponse>();
      const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
      render(
        <TaskListView projectId="A" boardFetcher={async () => board} tasksFetcher={fetcher} />,
      );
      applyText('actual');
      expect(fetcher.mock.calls[0]?.[2].signal.aborted).toBe(true);
      await act(async () => {
        if (settlement === 'resolve') old.resolve(page());
        else old.reject(new Error('Antiguo'));
      });
      expect(screen.getByText('Cargando lista de tareas...')).toBeInTheDocument();
      expect(screen.queryByText('Zeta')).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await act(async () => current.resolve(page()));
      expect(screen.getByText('Zeta')).toBeInTheDocument();
    },
  );

  it('recupera columnas independientemente sin repetir la consulta de tareas', async () => {
    const columns = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fallo columnas'))
      .mockResolvedValueOnce(board);
    const fetcher = vi.fn().mockResolvedValue(page());
    render(<TaskListView projectId="A" boardFetcher={columns} tasksFetcher={fetcher} />);
    await screen.findByText('Zeta');
    await screen.findByText(/Fallo columnas/);
    expect(screen.getByLabelText('Columna')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar columnas' }));
    await screen.findByRole('option', { name: 'Por hacer' });
    expect(screen.getByLabelText('Columna')).toBeEnabled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['resolve', 'reject'] as const)(
    'descarta %s tardío de columnas al cambiar proyecto',
    async (settlement) => {
      const old = deferred<BoardResponse>();
      const current = deferred<BoardResponse>();
      const columns = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
      const fetcher = vi.fn().mockResolvedValue(page());
      const { rerender } = render(
        <TaskListView projectId="A" boardFetcher={columns} tasksFetcher={fetcher} />,
      );
      await screen.findByText('Zeta');
      applyText('anterior');
      rerender(<TaskListView projectId="B" boardFetcher={columns} tasksFetcher={fetcher} />);
      await act(async () => {
        if (settlement === 'resolve') old.resolve(board);
        else old.reject(new Error('Antiguo'));
      });
      expect(screen.getByText('Cargando columnas...')).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'Por hacer' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Buscar texto')).toHaveValue('');
      await act(async () => current.resolve({ ...board, columns: [] }));
      await waitFor(() =>
        expect(screen.queryByText('Cargando columnas...')).not.toBeInTheDocument(),
      );
      expect(fetcher).toHaveBeenLastCalledWith(
        'B',
        { page: 1, limit: 20 },
        { signal: expect.any(AbortSignal) },
      );
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'descarta %s de columnas tras desmontar y reentrar',
    async (settlement) => {
      const old = deferred<BoardResponse>();
      const columns = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce({ ...board, columns: [] });
      const fetcher = vi.fn().mockResolvedValue(page());
      const first = render(
        <TaskListView projectId="A" boardFetcher={columns} tasksFetcher={fetcher} />,
      );
      first.unmount();
      expect(columns.mock.calls[0]?.[1].signal.aborted).toBe(true);
      render(<TaskListView projectId="A" boardFetcher={columns} tasksFetcher={fetcher} />);
      await screen.findByText('Zeta');
      await act(async () => {
        if (settlement === 'resolve') old.resolve(board);
        else old.reject(new Error('Antiguo'));
      });
      expect(screen.queryByRole('option', { name: 'Por hacer' })).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByLabelText('Columna')).toBeEnabled();
    },
  );
});
