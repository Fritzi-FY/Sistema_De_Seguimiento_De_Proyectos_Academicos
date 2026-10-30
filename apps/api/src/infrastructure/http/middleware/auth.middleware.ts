import type { MiddlewareHandler } from 'hono';
export interface AuthUserContext {
  userId: string;
  role: string;
}
export type AuthMiddleware = MiddlewareHandler;
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUserContext;
  }
}
