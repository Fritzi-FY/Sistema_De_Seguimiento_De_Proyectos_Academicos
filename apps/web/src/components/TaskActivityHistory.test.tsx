import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TaskActivityListResponse } from '@is488/shared';
import { TaskActivityHistory } from './TaskActivityHistory.js';
const event = {
  id: 'event',
  taskId: 'task',
  projectId: 'project',
  actorId: 'actor-real',
  action: 'CREATED' as const,
  createdAt: '2026-10-25T00:00:00.000Z',
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
describe('Real activity history UI', () => {
  it('shows load/error/retry and real event fields, without arbitrary details', async () => {
    const request = deferred<TaskActivityListResponse>();
    const fetcher = vi
      .fn()
      .mockReturnValueOnce(request.promise)
      .mockResolvedValueOnce([{ ...event, details: { private: 'do-not-render' } }]);
    render(<TaskActivityHistory projectId="project" taskId="task" fetcher={fetcher} />);
    expect(screen.getByText('Cargando historial...')).toBeInTheDocument();
    await act(async () => request.reject(new Error('Sin conexión')));
    expect(screen.queryByText('Sin actividad registrada.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar historial' }));
    expect(await screen.findByText('Creación')).toBeInTheDocument();
    expect(screen.getByText('Actor: actor-real')).toBeInTheDocument();
    expect(screen.getByText(/2026-10-25T00:00:00.000Z/)).toBeInTheDocument();
    expect(screen.queryByText('do-not-render')).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('shows genuine empty state', async () => {
    render(<TaskActivityHistory projectId="project" taskId="task" fetcher={async () => []} />);
    expect(await screen.findByText('Sin actividad registrada.')).toBeInTheDocument();
  });
  it.each(['resolve', 'reject'] as const)(
    'ignores obsolete %s after task/project changes',
    async (settlement) => {
      const old = deferred<TaskActivityListResponse>();
      const current = deferred<TaskActivityListResponse>();
      const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
      const { rerender } = render(
        <TaskActivityHistory projectId="project" taskId="task" fetcher={fetcher} />,
      );
      rerender(<TaskActivityHistory projectId="other" taskId="other" fetcher={fetcher} />);
      expect(fetcher.mock.calls[0]?.[2].signal.aborted).toBe(true);
      await act(async () => {
        if (settlement === 'resolve') old.resolve([event]);
        else old.reject(new Error('Antiguo'));
      });
      expect(screen.getByText('Cargando historial...')).toBeInTheDocument();
      expect(screen.queryByText('Creación')).not.toBeInTheDocument();
      expect(screen.queryByText(/Antiguo/)).not.toBeInTheDocument();
      await act(async () => current.resolve([]));
      expect(screen.getByText('Sin actividad registrada.')).toBeInTheDocument();
    },
  );
  it.each(['resolve', 'reject'] as const)(
    'ignores obsolete %s after unmount/reentry even without transport cancellation',
    async (settlement) => {
      const old = deferred<TaskActivityListResponse>();
      const fetcher = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValueOnce([]);
      const first = render(
        <TaskActivityHistory projectId="project" taskId="task" fetcher={fetcher} />,
      );
      first.unmount();
      render(<TaskActivityHistory projectId="project" taskId="task" fetcher={fetcher} />);
      await screen.findByText('Sin actividad registrada.');
      await act(async () => {
        if (settlement === 'resolve') old.resolve([event]);
        else old.reject(new Error('Antiguo'));
      });
      expect(screen.getByText('Sin actividad registrada.')).toBeInTheDocument();
      expect(screen.queryByText('Creación')).not.toBeInTheDocument();
      expect(screen.queryByText(/Antiguo/)).not.toBeInTheDocument();
    },
  );
});
