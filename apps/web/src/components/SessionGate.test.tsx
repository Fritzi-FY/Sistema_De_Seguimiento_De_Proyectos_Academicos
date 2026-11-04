import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionGate } from './SessionGate.js';
import * as identity from '../services/identity.service.js';
vi.mock('../services/identity.service.js', () => ({
  currentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  requestVerification: vi.fn(),
  confirmVerification: vi.fn(),
}));
vi.mock('./AppShell.js', () => ({
  AppShell: ({ user }: { user: { userId: string } }) => <main>Private {user.userId}</main>,
}));
const user = {
  userId: '11111111-1111-4111-8111-111111111111',
  role: 'student' as const,
  email: 's@synthetic.example.test',
  name: 'Synthetic',
  expiresAt: new Date(Date.now() + 28800000).toISOString(),
};
beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState(null, '', '/');
});
afterEach(() => {
  vi.useRealTimers();
});
describe('session gate', () => {
  it('withholds private content until server identity is confirmed and rehydrates on reload', async () => {
    let resolve!: (value: typeof user) => void;
    vi.mocked(identity.currentUser).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<SessionGate />);
    expect(screen.queryByText(/Private/)).not.toBeInTheDocument();
    await act(async () => {
      resolve(user);
    });
    expect(screen.getByText(/Private/)).toBeInTheDocument();
  });
  it('keeps the authenticated UI and reports uncertain logout on transport failure', async () => {
    vi.mocked(identity.currentUser).mockResolvedValue(user);
    vi.mocked(identity.logout).mockRejectedValue(new Error('Cierre no confirmado.'));
    render(<SessionGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cierre no confirmado');
    expect(screen.getByText(/Private/)).toBeInTheDocument();
    expect(identity.logout).toHaveBeenCalledTimes(1);
  });
  it('clears private state after confirmed logout or API rejection', async () => {
    vi.mocked(identity.currentUser).mockResolvedValue(user);
    vi.mocked(identity.logout).mockResolvedValue();
    render(<SessionGate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Cerrar sesión' }));
    await waitFor(() => expect(screen.queryByText(/Private/)).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });
  it('expires locally at the server absolute deadline', async () => {
    vi.useFakeTimers();
    vi.mocked(identity.currentUser).mockResolvedValue({
      ...user,
      expiresAt: new Date(Date.now() + 1000).toISOString(),
    });
    await act(async () => {
      render(<SessionGate />);
    });
    expect(screen.getByText(/Private/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(1001);
    });
    expect(screen.queryByText(/Private/)).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('expiró');
  });
  it('treats network failure as unconfirmed identity and never renders private content', async () => {
    vi.mocked(identity.currentUser).mockRejectedValue(new Error('network'));
    render(<SessionGate />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo comprobar');
    expect(screen.queryByText(/Private/)).not.toBeInTheDocument();
  });
});
