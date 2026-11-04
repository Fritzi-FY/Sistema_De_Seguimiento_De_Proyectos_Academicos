import { createHash } from 'node:crypto';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { PostgresDialect } from 'kysely';
import type { Pool } from 'pg';
import {
  CurrentUserSchema,
  type IdentitySessionPort,
  type IdentityMailPort,
  type LoginRequest,
} from '@is488/shared';

export const MAX_SESSION_SECONDS = 28800;
export function authOptions(
  pool: Pool,
  settings: { secret: string; origin: string; mail: IdentityMailPort },
): BetterAuthOptions {
  return {
    appName: 'IS488',
    baseURL: settings.origin,
    secret: settings.secret,
    database: { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'public' },
    trustedOrigins: [settings.origin],
    telemetry: { enabled: false },
    logger: { disabled: true },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      sendOnSignIn: false,
      expiresIn: 3600,
      async sendVerificationEmail({ user, token }) {
        const allowed = await pool.query(
          'SELECT 1 FROM public.auth_role_grants WHERE user_id=$1 AND active',
          [user.id],
        );
        if (allowed.rowCount === 1)
          await settings.mail.sendVerification(
            user.email,
            settings.origin + '/verify-email?token=' + encodeURIComponent(token),
          );
      },
    },
    user: { modelName: 'auth_user' },
    account: { modelName: 'auth_account', accountLinking: { enabled: false } },
    verification: { modelName: 'auth_verification' },
    session: {
      modelName: 'auth_session',
      expiresIn: MAX_SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'auth_rate_limit',
      max: 20,
      window: 60,
    },
    advanced: {
      database: { generateId: 'uuid' },
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    },
    databaseHooks: {
      session: {
        create: {
          async before(session) {
            const allowed = await pool.query(
              'SELECT 1 FROM public.auth_role_grants WHERE user_id=$1 AND active',
              [session.userId],
            );
            if (allowed.rowCount !== 1)
              throw new APIError('FORBIDDEN', { message: 'Access denied' });
            return {
              data: {
                ...session,
                expiresAt: new Date(
                  Math.min(
                    session.expiresAt.getTime(),
                    session.createdAt.getTime() + MAX_SESSION_SECONDS * 1000,
                  ),
                ),
              },
            };
          },
        },
      },
    },
  };
}

export class BetterAuthSessionAdapter implements IdentitySessionPort {
  private readonly auth;
  constructor(
    private readonly pool: Pool,
    private readonly settings: { secret: string; origin: string; mail: IdentityMailPort },
  ) {
    this.auth = betterAuth(authOptions(pool, settings));
  }
  async ready() {
    await (await this.auth.$context).checkSchema?.();
  }
  async current(headers: Headers) {
    const value = await this.auth.api.getSession({ headers });
    if (!value || !value.user.emailVerified) return null;
    const grant = (
      await this.pool.query(
        'SELECT role FROM public.auth_role_grants WHERE user_id=$1 AND active',
        [value.user.id],
      )
    ).rows[0];
    if (!grant) return null;
    return CurrentUserSchema.parse({
      userId: value.user.id,
      role: grant.role,
      email: value.user.email,
      name: value.user.name,
      expiresAt: value.session.expiresAt.toISOString(),
    });
  }
  private request(path: string, headers: Headers, body: unknown) {
    const next = new Headers(headers);
    next.set('content-type', 'application/json');
    next.delete('content-length');
    return new Request(this.settings.origin + '/api/auth/' + path, {
      method: 'POST',
      headers: next,
      body: JSON.stringify(body),
    });
  }
  async login(input: LoginRequest, headers: Headers) {
    const result = await this.auth.handler(
      this.request('sign-in/email', headers, { ...input, rememberMe: false }),
    );
    const output = new Headers(result.headers);
    output.set('cache-control', 'private, no-store');
    return new Response(
      JSON.stringify(result.ok ? { success: true } : { error: 'Access denied' }),
      { status: result.status, headers: output },
    );
  }
  async logout(headers: Headers) {
    return await this.auth.handler(this.request('sign-out', headers, {}));
  }
  async requestVerification(email: string, headers: Headers) {
    await this.auth.handler(this.request('send-verification-email', headers, { email }));
  }
  async confirmVerification(token: string, headers: Headers) {
    const url = new URL(this.settings.origin + '/api/auth/verify-email');
    url.searchParams.set('token', token);
    const digest = createHash('sha256').update(token).digest('hex');
    if (
      (
        await this.pool.query(
          'SELECT 1 FROM public.auth_verification_consumptions WHERE token_hash=$1',
          [digest],
        )
      ).rowCount
    )
      return false;
    const response = await this.auth.handler(new Request(url, { headers }));
    if (!response.ok) return false;
    const consumed = await this.pool.query(
      'INSERT INTO public.auth_verification_consumptions(token_hash) VALUES ($1) ON CONFLICT DO NOTHING RETURNING token_hash',
      [digest],
    );
    return consumed.rowCount === 1;
  }
}
