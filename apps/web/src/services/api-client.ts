import { DEFAULT_DEV_IDENTITY } from './dev-identity.js';
export const devIdentityEnabled = () =>
  import.meta.env.MODE === 'test' ||
  (import.meta.env.DEV && import.meta.env.VITE_AUTH_MODE === 'dev');
export function buildHeaders(user?: { userId?: string; role?: string }): HeadersInit {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(devIdentityEnabled()
      ? {
          'X-Dev-User-Id': user?.userId ?? DEFAULT_DEV_IDENTITY.userId,
          'X-Dev-User-Role': user?.role ?? DEFAULT_DEV_IDENTITY.role,
        }
      : {}),
  };
}
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, { ...init, credentials: 'same-origin' });
  if (response.status === 401 && !devIdentityEnabled())
    window.dispatchEvent(new Event('identity:unauthorized'));
  return response;
}
