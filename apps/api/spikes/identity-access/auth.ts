import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import type { Pool } from 'pg';
import { PostgresDialect } from 'kysely';

export const MAX_SESSION_SECONDS = 8 * 60 * 60;
export function createSpikeOptions(
  pool: Pool,
  settings: { secret: string; origin: string },
): BetterAuthOptions {
  return {
    appName: 'IS488 local authentication spike',
    baseURL: settings.origin,
    secret: settings.secret,
    database: { dialect: new PostgresDialect({ pool }), type: 'postgres', schemaName: 'public' },
    trustedOrigins: [settings.origin],
    telemetry: { enabled: false },
    logger: { level: 'error' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      sendOnSignIn: false,
      async sendVerificationEmail({ user, url }) {
        await pool.query('INSERT INTO public.spike_auth_mail (email,url) VALUES ($1,$2)', [
          user.email,
          url,
        ]);
      },
    },
    user: { modelName: 'spike_auth_user' },
    account: { modelName: 'spike_auth_account', accountLinking: { enabled: false } },
    verification: { modelName: 'spike_auth_verification' },
    session: {
      modelName: 'spike_auth_session',
      expiresIn: MAX_SESSION_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'spike_auth_rate_limit',
      max: 100,
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
              'SELECT user_id FROM public.spike_role_grants WHERE user_id=$1 AND active',
              [session.userId],
            );
            if (allowed.rowCount !== 1)
              throw new APIError('FORBIDDEN', { message: 'Account not provisioned' });
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
export function createSpikeAuth(pool: Pool, settings: { secret: string; origin: string }) {
  return betterAuth(createSpikeOptions(pool, settings));
}
