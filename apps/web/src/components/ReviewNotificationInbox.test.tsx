import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeReviewNotificationCursor, type ReviewNotificationListResponse } from '@is488/shared';
import { ReviewNotificationInbox } from './ReviewNotificationInbox.js';
import { ReviewNotificationFetchError } from '../services/review-notification.service.js';

const student = { userId: 'student-a', role: 'student' as const };
const first = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  reviewId: '33333333-3333-4333-8333-333333333333',
  responseActionId: '44444444-4444-4444-8444-444444444444',
  status: 'CHANGES_REQUESTED' as const,
  createdAt: '2026-11-13T12:00:00.123456Z',
};
const second = {
  ...first,
  id: '55555555-5555-4555-8555-555555555555',
  status: 'APPROVED' as const,
  projectId: '66666666-6666-4666-8666-666666666666',
  createdAt: '2026-11-13T12:00:00.123100Z',
};
const cursor = encodeReviewNotificationCursor(first);
const page = { items: [first], nextCursor: cursor };
const empty = { items: [], nextCursor: null };

function deferred() {
  let resolve!: (value: ReviewNotificationListResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReviewNotificationListResponse>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.restoreAllMocks());

describe('Student inbox view (DOM with simulated reader)', () => {
  it.each(['teacher', 'admin'] as const)('never loads or renders an inbox for %s', (role) => {
    const fetcher = vi.fn();
    render(<ReviewNotificationInbox user={{ ...student, role }} fetcher={fetcher} />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('announces loading and actual empty state without a next-page button', async () => {
    const pending = deferred();
    const fetcher = vi.fn().mockReturnValue(pending.promise);
    render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando notificaciones');
    expect(screen.getByRole('region')).toHaveAttribute('aria-busy', 'true');
    await act(async () => pending.resolve(empty));
    expect(screen.getByRole('status')).toHaveTextContent('No hay notificaciones');
    expect(screen.queryByRole('button', { name: 'Siguiente' })).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      { limit: 20, cursor: undefined },
      { signal: expect.any(AbortSignal) },
    );
  });
  it('uses the literal API cursor, discards the previous page while loading and replaces instead of appending', async () => {
    const pending = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce(page).mockReturnValueOnce(pending.promise);
    render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    expect(await screen.findByText('Cambios solicitados')).toBeInTheDocument();
    expect(document.querySelector('time')).toHaveAttribute('datetime', first.createdAt);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Siguiente' });
    more.focus();
    expect(more).toHaveFocus();
    fireEvent.click(more);
    expect(screen.queryByText('Cambios solicitados')).not.toBeInTheDocument();
    expect(fetcher.mock.calls[1]![0]).toEqual({ limit: 20, cursor });
    await act(async () => pending.resolve({ items: [second], nextCursor: null }));
    expect(screen.getByText('Revisión aprobada')).toBeInTheDocument();
    expect(screen.queryByText(first.projectId)).not.toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Notificaciones de revisión' })).toHaveFocus();
  });
  it('shows sanitized error with no stale items, retries the failed cursor and refreshes from the beginning', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(new Error('private'))
      .mockResolvedValueOnce({ items: [second], nextCursor: null })
      .mockResolvedValue(empty);
    render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('private');
    expect(screen.queryByText(first.projectId)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar notificaciones' }));
    expect(await screen.findByText('Revisión aprobada')).toBeInTheDocument();
    expect(fetcher.mock.calls[2]![0]).toEqual({ limit: 20, cursor });
    fireEvent.click(screen.getByRole('button', { name: 'Actualizar notificaciones' }));
    await screen.findByText('No hay notificaciones de revisión disponibles.');
    expect(fetcher.mock.calls[3]![0]).toEqual({ limit: 20, cursor: undefined });
  });
  it('revalidates on focus from the first page, clears earlier data and ignores a late page reply', async () => {
    const stale = deferred();
    const fresh = deferred();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(fresh.promise);
    render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
    fireEvent(window, new Event('focus'));
    expect(fetcher.mock.calls[2]![0]).toEqual({ limit: 20, cursor: undefined });
    expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);
    await act(async () => stale.resolve({ items: [second], nextCursor: null }));
    expect(screen.queryByText('Revisión aprobada')).not.toBeInTheDocument();
    await act(async () => fresh.resolve(empty));
    expect(screen.getByRole('status')).toHaveTextContent('No hay notificaciones');
  });
  it.each([401, 403])('clears page/cursor and stops automatic retries after %i', async (status) => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(new ReviewNotificationFetchError(status));
    render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
    await screen.findByRole('alert');
    expect(screen.queryByText(first.projectId)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reintentar notificaciones' }),
    ).not.toBeInTheDocument();
    fireEvent(window, new Event('focus'));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Actualizar notificaciones' })).toBeDisabled();
  });
  it.each(['resolve', 'reject'])(
    'discards old identity state and late %s on user changes',
    async (outcome) => {
      const stale = deferred();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(page)
        .mockReturnValueOnce(stale.promise)
        .mockResolvedValueOnce(empty);
      const view = render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
      view.rerender(
        <ReviewNotificationInbox user={{ ...student, userId: 'student-b' }} fetcher={fetcher} />,
      );
      expect(screen.queryByText(first.projectId)).not.toBeInTheDocument();
      await act(async () =>
        outcome === 'resolve'
          ? stale.resolve({ items: [second], nextCursor: null })
          : stale.reject(new Error('late')),
      );
      await screen.findByText('No hay notificaciones de revisión disponibles.');
      expect(screen.queryByText(second.projectId)).not.toBeInTheDocument();
      expect(fetcher.mock.calls[2]![0]).toEqual({ limit: 20, cursor: undefined });
    },
  );
  it('clears immediately on role change, leaving the view or an unauthorized event and aborts pending work', async () => {
    const pending = deferred();
    const fetcher = vi.fn().mockResolvedValueOnce(page).mockReturnValue(pending.promise);
    const view = render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
    fireEvent(window, new Event('identity:unauthorized'));
    expect(screen.queryByText(first.projectId)).not.toBeInTheDocument();
    expect(fetcher.mock.calls[1]![1].signal.aborted).toBe(true);
    await act(async () => pending.resolve({ items: [second], nextCursor: null }));
    expect(screen.queryByText(second.projectId)).not.toBeInTheDocument();
    view.rerender(
      <ReviewNotificationInbox user={{ ...student, role: 'teacher' }} fetcher={fetcher} />,
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    view.unmount();
  });
  it('aborts on unmount and reloads fresh on reentry without cached items', async () => {
    const pending = deferred();
    const fetcher = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(empty);
    const view = render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    view.unmount();
    expect(fetcher.mock.calls[0]![1].signal.aborted).toBe(true);
    render(<ReviewNotificationInbox user={student} fetcher={fetcher} />);
    await act(async () => pending.resolve(page));
    await screen.findByText('No hay notificaciones de revisión disponibles.');
    expect(screen.queryByText(first.projectId)).not.toBeInTheDocument();
  });
});
