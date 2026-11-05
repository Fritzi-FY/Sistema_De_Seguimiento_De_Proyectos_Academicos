import { CurrentUserSchema, LoginRequestSchema, type LoginRequest } from '@is488/shared';
export async function currentUser() {
  const response = await fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('No se pudo comprobar la sesión.');
  return CurrentUserSchema.parse(await response.json());
}
async function post(path: string, body: unknown) {
  const response = await fetch('/api/auth/' + path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(
      path === 'sign-out'
        ? 'Cierre no confirmado. Comprueba la conexión antes de volver a intentarlo.'
        : 'No se pudo completar la solicitud. Comprueba tus datos o la verificación de correo.',
    );
}
export const login = (input: LoginRequest) =>
  post('sign-in/email', LoginRequestSchema.parse(input));
export const logout = () => post('sign-out', {});
export const requestVerification = (email: string) => post('verification/request', { email });
export const confirmVerification = (token: string) => post('verification/confirm', { token });
