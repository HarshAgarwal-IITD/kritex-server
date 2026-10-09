import { Logger } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError } from 'better-auth/api';
import { emailOTP } from 'better-auth/plugins';
import type { Env } from '../config/env.schema';
import { otpMessage, resetPasswordMessage, verifyEmailMessage } from './auth-emails';
import type { MailService } from './mail/mail.service';

/** Better Auth is mounted here (Nest global prefix + `/auth`). */
export const AUTH_BASE_PATH = '/api/v1/auth';
/** Cookie names start with this prefix: `better-auth.session_token` (`__Secure-` over https). */
export const AUTH_COOKIE_PREFIX = 'better-auth';

/** Publicly known fallback, only ever used outside production (env schema enforces it). */
const DEV_SECRET = 'kritex-dev-only-better-auth-secret-change-me';

export const SESSION_EXPIRES_IN = 60 * 60 * 24 * 30; // 30 days
export const OTP_EXPIRES_IN = 60 * 5; // 5 minutes

export type AuthEnv = Pick<
  Env,
  | 'NODE_ENV'
  | 'BETTER_AUTH_SECRET'
  | 'BETTER_AUTH_URL'
  | 'WEB_URL'
  | 'CORS_ORIGIN'
  | 'AUTH_COOKIE_DOMAIN'
>;

export interface AuthDeps {
  prisma: PrismaClient;
  mail: MailService;
  env: AuthEnv;
}

/** True while a user's ban is in force. */
export function isBanned(user: { banned: boolean; banExpires: Date | null }): boolean {
  return user.banned && (!user.banExpires || user.banExpires > new Date());
}

/**
 * Builds the Better Auth instance (ADR-004): email + password with required email verification,
 * password reset, and email OTP (sign-in, verification, password reset). Sessions are httpOnly,
 * SameSite=Lax cookies stored in the `Session` table. Better Auth's own rate limiter is off:
 * `AuthController` applies Nest throttles per endpoint instead.
 */
export function createAuth({ prisma, mail, env }: AuthDeps) {
  const production = env.NODE_ENV === 'production';
  const logger = new Logger('BetterAuth');

  return betterAuth({
    appName: 'Kritex',
    baseURL: env.BETTER_AUTH_URL,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET ?? DEV_SECRET,
    trustedOrigins: [...new Set([...env.CORS_ORIGIN, env.WEB_URL])],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    logger: {
      disabled: env.NODE_ENV === 'test',
      log: (level, message) => {
        if (level === 'error') logger.error(message);
        else if (level === 'warn') logger.warn(message);
        else logger.debug(message);
      },
    },
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    user: {
      additionalFields: {
        // Owned by Kritex: never accepted from sign-up / update-user bodies.
        role: { type: 'string', required: false, input: false, defaultValue: 'CUSTOMER' },
        phone: { type: 'string', required: false, input: false },
        banned: { type: 'boolean', required: false, input: false, defaultValue: false },
      },
    },
    session: {
      expiresIn: SESSION_EXPIRES_IN,
      updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await mail.send(await resetPasswordMessage(user.email, user.name, url));
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await mail.send(await verifyEmailMessage(user.email, user.name, url));
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: OTP_EXPIRES_IN,
        allowedAttempts: 3,
        storeOTP: 'hashed',
        sendVerificationOTP: async ({ email, otp, type }) => {
          await mail.send(await otpMessage(email, otp, type));
        },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // Disabled accounts (`PATCH /admin/users/:id { disabled: true }`) cannot sign in.
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { banned: true, banExpires: true },
            });
            if (user && isBanned(user)) {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_DISABLED',
                message: 'This account has been disabled',
              });
            }
          },
        },
      },
    },
    advanced: {
      cookiePrefix: AUTH_COOKIE_PREFIX,
      useSecureCookies: production,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: production },
      crossSubDomainCookies: env.AUTH_COOKIE_DOMAIN
        ? { enabled: true, domain: env.AUTH_COOKIE_DOMAIN }
        : undefined,
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
