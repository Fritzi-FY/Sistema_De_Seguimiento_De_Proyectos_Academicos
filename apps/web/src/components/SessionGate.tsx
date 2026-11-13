import React, { useEffect, useState, useRef } from 'react';
import type { CurrentUser } from '@is488/shared';
import {
  currentUser,
  login,
  logout,
  requestVerification,
  confirmVerification,
} from '../services/identity.service.js';
import { AppShell } from './AppShell.js';

export function SessionGate() {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  async function check() {
    const version = ++generation.current;
    setLoading(true);
    try {
      const next = await currentUser();
      if (version !== generation.current) return;
      setUser(next);
      setMessage('');
    } catch {
      if (version !== generation.current) return;
      setUser(null);
      setMessage('No se pudo comprobar la sesión.');
    } finally {
      if (version === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    void check();
    const denied = () => {
      generation.current++;
      setLoading(false);
      setUser(null);
      setMessage('La sesión terminó. Vuelve a iniciar sesión.');
    };
    window.addEventListener('identity:unauthorized', denied);
    const focus = () => {
      void check();
    };
    window.addEventListener('focus', focus);
    return () => {
      generation.current++;
      window.removeEventListener('identity:unauthorized', denied);
      window.removeEventListener('focus', focus);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    const timer = window.setTimeout(
      () => {
        generation.current++;
        setUser(null);
        setMessage('La sesión expiró. Vuelve a iniciar sesión.');
      },
      Math.max(0, Date.parse(user.expiresAt) - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [user]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setMessage('');
    try {
      await login({ email: String(data.get('email')), password: String(data.get('password')) });
      const next = await currentUser();
      if (!next) throw new Error('No se pudo confirmar la sesión.');
      setUser(next);
      window.history.replaceState(null, '', '/app');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await logout();
      generation.current++;
      setUser(null);
      setMessage('Sesión cerrada.');
      window.history.replaceState(null, '', '/');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Cierre no confirmado.');
    } finally {
      setBusy(false);
    }
  }
  const button =
    'rounded-md bg-unsch-garnet px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-unsch-garnet focus:ring-offset-2 disabled:opacity-50';
  if (loading && !user)
    return (
      <main className="p-8" role="status">
        Comprobando sesión…
      </main>
    );
  if (user)
    return (
      <>
        {loading && <p role="status">Comprobando sesión...</p>}
        <div hidden={loading}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-white p-3">
            <span data-testid="session-user" data-user-id={user.userId} data-role={user.role}>
              {user.name} · {user.email} · {user.role}
            </span>
            <button
              className={button}
              disabled={busy}
              data-testid="logout"
              onClick={() => void signOut()}
            >
              Cerrar sesión
            </button>
            {message && <p role="alert">{message}</p>}
          </div>
          <AppShell
            key={`${user.userId}/${user.role}`}
            user={user}
            sessionSuspended={loading || busy}
          />
        </div>
      </>
    );
  const token =
    window.location.pathname === '/verify-email'
      ? new URLSearchParams(window.location.search).get('token')
      : null;
  return (
    <main className="mx-auto max-w-md space-y-5 px-6 py-12">
      <h1 className="text-2xl font-bold text-slate-900">Acceso a proyectos académicos</h1>
      <p>Solo cuentas autorizadas. La sesión dura como máximo 8 horas.</p>
      {token ? (
        <button
          className={button}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void confirmVerification(token)
              .then(() => {
                window.history.replaceState(null, '', '/');
                setMessage('Correo verificado. Ya puedes iniciar sesión.');
              })
              .catch(() => setMessage('Verificación no válida o expirada.'))
              .finally(() => setBusy(false));
          }}
        >
          Confirmar correo
        </button>
      ) : (
        <form onSubmit={(event) => void submit(event)} className="space-y-4">
          <label className="block">
            Correo
            <input
              className="mt-1 block w-full rounded border border-slate-400 p-2 focus:ring-2 focus:ring-unsch-garnet"
              name="email"
              type="email"
              autoComplete="username"
              required
            />
          </label>
          <label className="block">
            Contraseña
            <input
              className="mt-1 block w-full rounded border border-slate-400 p-2 focus:ring-2 focus:ring-unsch-garnet"
              name="password"
              type="password"
              autoComplete="current-password"
              maxLength={256}
              required
            />
          </label>
          <button className={button} disabled={busy} type="submit">
            {busy ? 'Comprobando…' : 'Iniciar sesión'}
          </button>
          <button
            className="block underline focus:ring-2 focus:ring-unsch-garnet"
            type="button"
            disabled={busy}
            onClick={(event) => {
              const form = event.currentTarget.form;
              const email = form?.querySelector<HTMLInputElement>('[name=email]');
              if (!email?.reportValidity()) return;
              setBusy(true);
              void requestVerification(email.value)
                .then(() =>
                  setMessage(
                    'Si tu cuenta está habilitada, recibirás instrucciones de verificación.',
                  ),
                )
                .catch(() => setMessage('No se pudo solicitar la verificación.'))
                .finally(() => setBusy(false));
            }}
          >
            Solicitar verificación de correo
          </button>
        </form>
      )}
      {message && <p role="alert">{message}</p>}
      {message === 'No se pudo comprobar la sesión.' && (
        <button className={button} onClick={() => void check()}>
          Reintentar
        </button>
      )}
    </main>
  );
}
