import { randomUUID } from 'node:crypto';
import { type INestApplication } from '@nestjs/common';
import type { Role, User } from '@prisma/client';
import { hashPassword } from 'better-auth/crypto';
import { AuthService } from '../src/auth/auth.service';
import { MailService } from '../src/auth/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Default password for users created by the helpers below. */
export const TEST_PASSWORD = 'correct-horse-battery-staple';
/** The storefront origin allowed by the test env (CORS_ORIGIN / WEB_URL). */
export const TEST_ORIGIN = 'http://localhost:8080';

let counter = 0;

/** `Set-Cookie` values → a `Cookie` request header (`name=value; name2=value2`). */
export function cookieHeader(setCookies: string[] | string | undefined): string {
  const list = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  return list.map((cookie) => cookie.split(';')[0]).join('; ');
}

export interface CreateUserOptions {
  email?: string;
  name?: string;
  role?: Role;
  password?: string;
  emailVerified?: boolean;
}

/**
 * Creates a user with a Better Auth credential account straight in the database (fast, and not
 * subject to the HTTP sign-up throttle). Use the real HTTP flow when testing sign-up itself.
 */
export async function createUser(
  app: INestApplication,
  options: CreateUserOptions = {},
): Promise<User> {
  const prisma = app.get(PrismaService);
  counter += 1;
  const email = (options.email ?? `user${counter}-${randomUUID().slice(0, 8)}@kritex.test`)
    .trim()
    .toLowerCase();
  const user = await prisma.user.create({
    data: {
      email,
      name: options.name ?? `Test User ${counter}`,
      role: options.role ?? 'CUSTOMER',
      emailVerified: options.emailVerified ?? true,
    },
  });
  await prisma.account.create({
    data: {
      id: randomUUID(),
      userId: user.id,
      accountId: user.id,
      providerId: 'credential',
      password: await hashPassword(options.password ?? TEST_PASSWORD),
    },
  });
  return user;
}

/**
 * Signs in through Better Auth's server API (bypassing the HTTP throttle) and returns a
 * `Cookie` header carrying the session.
 */
export async function signIn(
  app: INestApplication,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<string> {
  const { auth } = app.get(AuthService);
  const { headers } = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = cookieHeader(headers.getSetCookie());
  if (!cookie.includes('better-auth.session_token=')) {
    throw new Error(`signIn(${email}) did not return a session cookie`);
  }
  return cookie;
}

/** Creates a user (default role CUSTOMER) and signs them in. */
export async function createSignedInUser(
  app: INestApplication,
  options: CreateUserOptions = {},
): Promise<{ user: User; cookie: string }> {
  const user = await createUser(app, options);
  const cookie = await signIn(app, user.email, options.password);
  return { user, cookie };
}

/** Shortcuts for the common roles. */
export const signInAsAdmin = (app: INestApplication, options: CreateUserOptions = {}) =>
  createSignedInUser(app, { ...options, role: 'ADMIN' });
export const signInAsStaff = (app: INestApplication, options: CreateUserOptions = {}) =>
  createSignedInUser(app, { ...options, role: 'STAFF' });
export const signInAsCustomer = (app: INestApplication, options: CreateUserOptions = {}) =>
  createSignedInUser(app, { ...options, role: 'CUSTOMER' });

/** The test-env mail outbox (MailService keeps messages in memory when NODE_ENV=test). */
export function mailbox(app: INestApplication): MailService {
  return app.get(MailService);
}

/** The first URL in an email body, as a path + query usable with supertest. */
export function linkPath(text: string): string {
  const match = /https?:\/\/\S+/.exec(text);
  if (!match) throw new Error(`No link in email:\n${text}`);
  const url = new URL(match[0]);
  return `${url.pathname}${url.search}`;
}

/** The 6-digit code in an OTP email. */
export function otpCode(text: string): string {
  const match = /\b(\d{6})\b/.exec(text);
  if (!match) throw new Error(`No OTP in email:\n${text}`);
  return match[1];
}
