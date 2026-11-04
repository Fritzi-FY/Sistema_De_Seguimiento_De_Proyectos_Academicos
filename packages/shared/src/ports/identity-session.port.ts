import type { CurrentUser, LoginRequest } from '../contracts/identity-access.contract.js';

export interface IdentitySessionPort {
  current(headers: Headers): Promise<CurrentUser | null>;
  login(input: LoginRequest, headers: Headers): Promise<Response>;
  logout(headers: Headers): Promise<Response>;
  requestVerification(email: string, headers: Headers): Promise<void>;
  confirmVerification(token: string, headers: Headers): Promise<boolean>;
}
export interface IdentityMailPort {
  sendVerification(email: string, url: string): Promise<void>;
}
