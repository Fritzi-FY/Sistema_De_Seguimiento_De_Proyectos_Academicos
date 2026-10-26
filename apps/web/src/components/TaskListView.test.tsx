import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { PaginatedTasksResponse, TaskResponse } from '@is488/shared';
import { TaskListView } from './TaskListView.js';
import * as service from '../services/task.service.js';
import * as boardService from '../services/board.service.js';

beforeEach(() => {
  vi.spyOn(boardService, 'getBoard').mockResolvedValue({
    id: 'board',
    projectId: 'A',
    columns: [],
    createdAt: '',
    updatedAt: '',
  });
});
afterEach(() => vi.restoreAllMocks());

const task = (title: string): TaskResponse => ({
  id: title,
  title,
  projectId: 'A',
  columnId: 'column',
  priority: 'MEDIUM',
  orderIndex: 0,
  labels: [],
  assigneeIds: [],
  creatorId: 'user',
  createdAt: '2026-10-25T00:00:00Z',
  updatedAt: '2026-10-25T00:00:00Z',
});
const result = (page = 1, titles = ['Segunda', 'Primera']): PaginatedTasksResponse => ({
  items: titles.map(task),
  page,
  limit: 20,
  totalPages: 2,
  totalItems: 21,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('TaskListView', () => {
  it('usa getTasks con límite 20, conserva orden y navega según metadatos del servidor', async () => {
    const getTasks = vi
      .spyOn(service, 'getTasks')
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result(2, ['Última']))
      .mockResolvedValueOnce(result());
    const all = vi.spyOn(service, 'getAllProjectTasks');
    try {
      render(<TaskListView projectId="A" />);
      expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
      await screen.findByText('Segunda');
      expect(getTasks).toHaveBeenCalledWith('A', { page: 1, limit: 20 }, undefined, {
        signal: expect.any(AbortSignal),
      });
      expect(all).not.toHaveBeenCalled();
      const rows = within(screen.getByRole('table')).getAllByRole('row');
      expect(rows[1]).toHaveTextContent('Segunda');
      expect(rows[2]).toHaveTextContent('Primera');
      expect(screen.getByText(/21 tareas · Página 1 de 2 · 20 por página/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
      expect(screen.queryByText('Segunda')).not.toBeInTheDocument();
      await screen.findByText('Última');
      expect(getTasks.mock.calls[1]?.[1]).toEqual({ page: 2, limit: 20 });
      expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
      await screen.findByText('Segunda');
      expect(getTasks.mock.calls[2]?.[1]).toEqual({ page: 1, limit: 20 });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('reintenta la página fallida y muestra vacío sin acciones de escritura', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(result())
      .mockRejectedValueOnce(new Error('Sin conexión'))
      .mockResolvedValueOnce(result(2, []));
    render(<TaskListView projectId="A" tasksFetcher={fetcher} />);
    await screen.findByText('Segunda');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin conexión');
    expect(screen.queryByText('Segunda')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText('Sin coincidencias');
    expect(fetcher.mock.calls[2]?.[1]).toEqual({ page: 2, limit: 20 });
    expect(screen.queryByRole('button', { name: /Crear|Editar|Mover/ })).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignora %s tardío al cambiar proyecto y reinicia página',
    async (settlement) => {
      const old = deferred<PaginatedTasksResponse>();
      const current = deferred<PaginatedTasksResponse>();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(result())
        .mockReturnValueOnce(old.promise)
        .mockReturnValueOnce(current.promise);
      const { rerender } = render(<TaskListView projectId="A" tasksFetcher={fetcher} />);
      await screen.findByText('Segunda');
      fireEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
      rerender(<TaskListView projectId="B" tasksFetcher={fetcher} />);
      expect(fetcher.mock.calls[2]?.slice(0, 2)).toEqual(['B', { page: 1, limit: 20 }]);
      await act(async () => {
        if (settlement === 'resolve') old.resolve(result(2, ['Antigua']));
        else old.reject(new Error('Error antiguo'));
      });
      expect(screen.getByText('Cargando lista de tareas...')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('Antigua')).not.toBeInTheDocument();
      await act(async () => current.resolve(result(1, ['Actual'])));
      expect(screen.getByText('Actual')).toBeInTheDocument();
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'invalida %s después de desmontar aunque el transporte ignore abort',
    async (settlement) => {
      const old = deferred<PaginatedTasksResponse>();
      const fetcher = vi
        .fn()
        .mockReturnValueOnce(old.promise)
        .mockResolvedValueOnce(result(1, ['Nueva entrada']));
      const first = render(<TaskListView projectId="A" tasksFetcher={fetcher} />);
      first.unmount();
      expect(fetcher.mock.calls[0]?.[2].signal.aborted).toBe(true);
      render(<TaskListView projectId="A" tasksFetcher={fetcher} />);
      await screen.findByText('Nueva entrada');
      await act(async () => {
        if (settlement === 'resolve') old.resolve(result(2, ['Antigua']));
        else old.reject(new Error('Error antiguo'));
      });
      expect(screen.getByText('Nueva entrada')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText('Antigua')).not.toBeInTheDocument();
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    },
  );
});
