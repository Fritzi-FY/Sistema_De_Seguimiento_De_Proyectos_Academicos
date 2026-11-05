import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
type Me = { userId: string; role: string; name: string; email: string };
function SpikeApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState('checking');
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/auth/me');
        if (response.status === 401) {
          setState('signed-out');
          return;
        }
        if (!response.ok) throw new Error('No se pudo comprobar la sesión');
        setMe((await response.json()) as Me);
        const data = await fetch('/api/projects');
        if (!data.ok) throw new Error('Acceso a proyectos rechazado');
        setProjects((await data.json()) as { id: string; title: string }[]);
        setState('authenticated');
      } catch {
        setState('error');
        setError('No se pudo comprobar el acceso');
      }
    })();
  }, []);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    const response = await fetch('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: values.get('email'), password: values.get('password') }),
    });
    if (!response.ok) {
      setError('Acceso no confirmado');
      return;
    }
    window.location.assign('/app');
  }
  async function logout() {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) {
      setError('Cierre no confirmado');
      return;
    }
    setMe(null);
    setProjects([]);
    window.location.assign('/');
  }
  return (
    <main data-state={state}>
      <h1>Spike local de autenticación IS488</h1>
      <p>Datos sintéticos. Google y correo real todavía no están habilitados.</p>
      {state === 'checking' && <p role="status">Comprobando sesión…</p>}
      {state === 'signed-out' && (
        <form onSubmit={(event) => void login(event)}>
          <label>
            Correo <input id="email" name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Contraseña{' '}
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button id="login" type="submit">
            Iniciar sesión
          </button>
        </form>
      )}
      {me && state === 'authenticated' && (
        <section aria-label="Aplicación protegida">
          <p id="identity" data-user-id={me.userId} data-role={me.role}>
            {me.name} ({me.role})
          </p>
          <ul id="projects">
            {projects.map((p) => (
              <li key={p.id}>{p.title}</li>
            ))}
          </ul>
          <button id="logout" onClick={() => void logout()}>
            Cerrar sesión
          </button>
        </section>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<SpikeApp />);
