import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, ReviewNotificationListResponse } from '@is488/shared';
import { AppShell } from './AppShell.js';
import { SessionGate } from './SessionGate.js';
import * as notifications from '../services/review-notification.service.js';
import * as identity from '../services/identity.service.js';

vi.mock('../services/review-notification.service.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getReviewNotifications: vi.fn(),
}));
vi.mock('../services/identity.service.js', () => ({
  currentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  requestVerification: vi.fn(),
  confirmVerification: vi.fn(),
}));
vi.mock('../services/health.service.js', () => ({
  fetchSystemHealth: async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: '2026-11-13T12:00:00.000Z',
  }),
}));
vi.mock('../services/project.service.js', () => ({
  fetchProjects: async () => [],
  createProject: vi.fn(),
}));

const user: CurrentUser = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student',
  name: 'Synthetic student',
  email: 'student@synthetic.example.test',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};
const item = {
  id: '22222222-2222-4222-8222-222222222222',
  projectId: '33333333-3333-4333-8333-333333333333',
  reviewId: '44444444-4444-4444-8444-444444444444',
  responseActionId: '55555555-5555-4555-8555-555555555555',
  status: 'APPROVED' as const,
  createdAt: '2026-11-13T12:00:00.123456Z',
};
const page = { items: [item], nextCursor: null };
const empty = { items: [], nextCursor: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(notifications.getReviewNotifications).mockResolvedValue(empty);
  window.history.replaceState(null, '', '/');
});
afterEach(() => vi.restoreAllMocks());

describe('Inbox integration with existing shell and session gate (mock HTTP)', () => {
  it.each(['teacher', 'admin', undefined] as const)(
    'does not expose navigation or query notifications without a student session: %s',
    async (role) => {
      await act(async () => {
        render(<AppShell user={role ? { ...user, role } : undefined} />);
      });
      expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
      expect(notifications.getReviewNotifications).not.toHaveBeenCalled();
    },
  );
  it('loads on student navigation, clears on exit and queries fresh on reentry', async () => {
    vi.mocked(notifications.getReviewNotifications)
      .mockResolvedValueOnce(page)
      .mockResolvedValue(empty);
    render(<AppShell user={user} />);
    expect(notifications.getReviewNotifications).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    expect(await screen.findByText(item.projectId)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Proyectos' }));
    expect(screen.queryByText(item.projectId)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await screen.findByText('No hay notificaciones de revisión disponibles.');
    expect(notifications.getReviewNotifications).toHaveBeenCalledTimes(2);
    expect(notifications.getReviewNotifications).toHaveBeenLastCalledWith(
      { limit: 20, cursor: undefined },
      { signal: expect.any(AbortSignal) },
    );
  });
  it('discards immediately on identity or role changes and on session suspension', async () => {
    vi.mocked(notifications.getReviewNotifications)
      .mockResolvedValueOnce(page)
      .mockResolvedValue(empty);
    const view = render(<AppShell user={user} />);
    fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
    await screen.findByText(item.projectId);
    view.rerender(<AppShell user={user} sessionSuspended />);
    expect(screen.queryByText(item.projectId)).not.toBeInTheDocument();
    view.rerender(<AppShell user={user} />);
    await screen.findByText('No hay notificaciones de revisión disponibles.');
    view.rerender(<AppShell user={{ ...user, userId: '66666666-6666-4666-8666-666666666666' }} />);
    await waitFor(() => expect(notifications.getReviewNotifications).toHaveBeenCalledTimes(3));
    view.rerender(<AppShell user={{ ...user, role: 'teacher' }} />);
    expect(
      screen.queryByRole('heading', { name: 'Notificaciones de revisión' }),
    ).not.toBeInTheDocument();
  });
  it('discards inbox rows as soon as logout starts, aborts the inbox and keeps no data after confirmed logout', async () => {
    vi.mocked(identity.currentUser).mockResolvedValue(user);
    const pending = deferred<void>();
    vi.mocked(identity.logout).mockReturnValue(pending.promise);
    vi.mocked(notifications.getReviewNotifications).mockResolvedValue(page);
    render(<SessionGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }));
    await screen.findByText(item.projectId);
    const signal = vi.mocked(notifications.getReviewNotifications).mock.calls[0]![1]!.signal!;
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(screen.queryByText(item.projectId)).not.toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve());
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
    expect(screen.queryByText(item.projectId)).not.toBeInTheDocument();
  });
  it('preserves inbox navigation but clears data during session revalidation and loads from the beginning after focus', async () => {
    const pending = deferred<CurrentUser | null>();
    vi.mocked(identity.currentUser)
      .mockResolvedValueOnce(user)
      .mockReturnValueOnce(pending.promise);
    vi.mocked(notifications.getReviewNotifications)
      .mockResolvedValueOnce(page)
      .mockResolvedValue(empty);
    render(<SessionGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }));
    await screen.findByText(item.projectId);
    fireEvent(window, new Event('focus'));
    expect(screen.queryByText(item.projectId)).not.toBeInTheDocument();
    await act(async () => pending.resolve(user));
    await screen.findByText('No hay notificaciones de revisión disponibles.');
    expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(notifications.getReviewNotifications).toHaveBeenLastCalledWith(
      { limit: 20, cursor: undefined },
      { signal: expect.any(AbortSignal) },
    );
  });
  it('does not allow an old pending inbox response to repopulate after logout', async () => {
    vi.mocked(identity.currentUser).mockResolvedValue(user);
    vi.mocked(identity.logout).mockResolvedValue();
    const pending = deferred<ReviewNotificationListResponse>();
    vi.mocked(notifications.getReviewNotifications).mockReturnValue(pending.promise);
    render(<SessionGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Notificaciones' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    await screen.findByRole('button', { name: 'Iniciar sesión' });
    await act(async () => pending.resolve(page));
    expect(screen.queryByText(item.projectId)).not.toBeInTheDocument();
  });
});
