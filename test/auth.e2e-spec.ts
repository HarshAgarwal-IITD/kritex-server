import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hashPassword } from 'better-auth/crypto';
import { runSeed } from '../prisma/seed/lib/seed';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  cookieHeader,
  createSignedInUser,
  createUser,
  linkPath,
  mailbox,
  otpCode,
  signIn,
} from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const AUTH = '/api/v1/auth';

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
    mailbox(app).clearOutbox();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  const sessionCookie = (res: request.Response) => cookieHeader(res.headers['set-cookie']);

  describe('sign up → verify email → sign in → GET /me', () => {
    const email = 'new.customer@kritex.test';

    it('works end to end over HTTP', async () => {
      // 1. Sign up: no session until the email is verified.
      const signUp = await http()
        .post(`${AUTH}/sign-up/email`)
        .send({ email, password: TEST_PASSWORD, name: 'New Customer' })
        .expect(200);
      expect(signUp.body.user).toEqual(
        expect.objectContaining({ email, name: 'New Customer', emailVerified: false }),
      );
      expect(sessionCookie(signUp)).not.toContain('session_token=');

      // Kritex-owned fields can't be set from the sign-up body.
      const stored = await prisma.user.findUniqueOrThrow({ where: { email } });
      expect(stored.role).toBe('CUSTOMER');

      // 2. Signing in before verifying is refused.
      const early = await http()
        .post(`${AUTH}/sign-in/email`)
        .send({ email, password: TEST_PASSWORD })
        .expect(403);
      expect(early.body.code).toBe('EMAIL_NOT_VERIFIED');

      // 3. The verification email links to Better Auth's verify endpoint, which signs the user in.
      const message = mailbox(app).lastTo(email, 'verify-email');
      expect(message?.subject).toMatch(/verify/i);
      const verify = await http().get(linkPath(message!.text));
      expect([200, 302]).toContain(verify.status);
      expect(sessionCookie(verify)).toContain('better-auth.session_token=');
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBe(true);

      // 4. Sign in with email + password: an httpOnly, SameSite=Lax session cookie.
      const signInRes = await http()
        .post(`${AUTH}/sign-in/email`)
        .set('Origin', TEST_ORIGIN)
        .send({ email, password: TEST_PASSWORD })
        .expect(200);
      const setCookie = (signInRes.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('better-auth.session_token='),
      );
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).not.toMatch(/Secure/i); // only in production (https)
      const cookie = sessionCookie(signInRes);

      // 5. GET /me
      const me = await http().get('/api/v1/me').set('Cookie', cookie).expect(200);
      expect(me.body).toEqual({
        id: stored.id,
        email,
        emailVerified: true,
        name: 'New Customer',
        phone: null,
        role: 'CUSTOMER',
        businessProfile: null,
        createdAt: expect.any(String),
      });

      // get-session works for the SPA too.
      const session = await http().get(`${AUTH}/get-session`).set('Cookie', cookie).expect(200);
      expect(session.body.user).toEqual(expect.objectContaining({ email, role: 'CUSTOMER' }));

      // 6. Sign out kills the session.
      await http()
        .post(`${AUTH}/sign-out`)
        .set('Cookie', cookie)
        .set('Origin', TEST_ORIGIN)
        .expect(200);
      await http().get('/api/v1/me').set('Cookie', cookie).expect(401);
    });

    it('a duplicate sign-up reveals nothing and changes nothing; a wrong password is 401', async () => {
      const existing = await createUser(app, { email });
      // With required email verification Better Auth answers 200 (no account enumeration).
      const dup = await http()
        .post(`${AUTH}/sign-up/email`)
        .send({ email, password: 'some-other-password', name: 'Dup' })
        .expect(200);
      expect(sessionCookie(dup)).not.toContain('session_token=');
      expect(await prisma.user.count()).toBe(1);
      expect((await prisma.user.findUniqueOrThrow({ where: { email } })).name).toBe(existing.name);
      await signIn(app, email); // the original password still works

      const wrong = await http()
        .post(`${AUTH}/sign-in/email`)
        .send({ email, password: 'not-the-password' })
        .expect(401);
      expect(wrong.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
    });

    it('enforces a minimum password length', async () => {
      const res = await http()
        .post(`${AUTH}/sign-up/email`)
        .send({ email, password: 'short', name: 'X' })
        .expect(400);
      expect(res.body.code).toBe('PASSWORD_TOO_SHORT');
    });
  });

  describe('password reset', () => {
    it('emails a link that leads to setting a new password', async () => {
      const user = await createUser(app);
      const oldCookie = await signIn(app, user.email);

      await http()
        .post(`${AUTH}/request-password-reset`)
        .send({ email: user.email, redirectTo: `${TEST_ORIGIN}/reset-password` })
        .expect(200);
      const message = mailbox(app).lastTo(user.email, 'reset-password');
      expect(message).toBeDefined();

      // The link redirects to the storefront with ?token=…
      const redirect = await http().get(linkPath(message!.text)).expect(302);
      const location = new URL(redirect.headers.location);
      expect(`${location.origin}${location.pathname}`).toBe(`${TEST_ORIGIN}/reset-password`);
      const token = location.searchParams.get('token');
      expect(token).toBeTruthy();

      await http()
        .post(`${AUTH}/reset-password`)
        .send({ token, newPassword: 'a-brand-new-password' })
        .expect(200);

      // Old sessions are revoked; the new password works, the old one doesn't.
      await http().get('/api/v1/me').set('Cookie', oldCookie).expect(401);
      await http()
        .post(`${AUTH}/sign-in/email`)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(401);
      await http()
        .post(`${AUTH}/sign-in/email`)
        .send({ email: user.email, password: 'a-brand-new-password' })
        .expect(200);
    });

    it('does not reveal whether an email is registered', async () => {
      const res = await http()
        .post(`${AUTH}/request-password-reset`)
        .send({ email: 'nobody@kritex.test' })
        .expect(200);
      expect(res.body.status).toBe(true);
      expect(mailbox(app).outbox).toHaveLength(0);
    });
  });

  describe('email OTP', () => {
    it('signs in with a 6-digit code', async () => {
      const user = await createUser(app);
      await http()
        .post(`${AUTH}/email-otp/send-verification-otp`)
        .send({ email: user.email, type: 'sign-in' })
        .expect(200);
      const message = mailbox(app).lastTo(user.email, 'otp-sign-in');
      const otp = otpCode(message!.text);

      const wrong = await http()
        .post(`${AUTH}/sign-in/email-otp`)
        .send({ email: user.email, otp: otp === '000000' ? '111111' : '000000' });
      expect(wrong.status).toBe(400);

      const res = await http()
        .post(`${AUTH}/sign-in/email-otp`)
        .send({ email: user.email, otp })
        .expect(200);
      const me = await http().get('/api/v1/me').set('Cookie', sessionCookie(res)).expect(200);
      expect(me.body.id).toBe(user.id);
    });

    it('verifies an email address with a code', async () => {
      const user = await createUser(app, { emailVerified: false });
      await http()
        .post(`${AUTH}/email-otp/send-verification-otp`)
        .send({ email: user.email, type: 'email-verification' })
        .expect(200);
      const otp = otpCode(mailbox(app).lastTo(user.email, 'otp-email-verification')!.text);
      await http()
        .post(`${AUTH}/email-otp/verify-email`)
        .send({ email: user.email, otp })
        .expect(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerified).toBe(
        true,
      );
    });
  });

  describe('AuthGuard', () => {
    it('401 without a session, or with a forged/unknown session cookie', async () => {
      const res = await http().get('/api/v1/me').expect(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
      await http()
        .get('/api/v1/me')
        .set('Cookie', 'better-auth.session_token=forged.value')
        .expect(401);
    });

    it('403 FORBIDDEN when the role is not allowed; STAFF/ADMIN reach admin routes', async () => {
      const customer = await createSignedInUser(app);
      const res = await http()
        .get('/api/v1/admin/customers')
        .set('Cookie', customer.cookie)
        .expect(403);
      expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });

      const staff = await createSignedInUser(app, { role: 'STAFF' });
      await http().get('/api/v1/admin/customers').set('Cookie', staff.cookie).expect(200);
      // ADMIN-only
      await http().get('/api/v1/admin/users').set('Cookie', staff.cookie).expect(403);
    });

    it('public routes work without a session', async () => {
      await http().get('/api/v1/health').expect(200);
    });

    it('rejects cookie-authenticated mutations from a foreign Origin (CSRF)', async () => {
      const { cookie } = await createSignedInUser(app);
      const res = await http()
        .patch('/api/v1/me')
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .send({ name: 'Hacked' })
        .expect(403);
      expect(res.body.error.code).toBe('INVALID_ORIGIN');

      await http()
        .patch('/api/v1/me')
        .set('Cookie', cookie)
        .set('Origin', TEST_ORIGIN)
        .send({ name: 'Fine' })
        .expect(200);
    });

    it('disabled (banned) users cannot sign in and lose their sessions', async () => {
      const { user, cookie } = await createSignedInUser(app);
      await prisma.user.update({ where: { id: user.id }, data: { banned: true } });
      await http().get('/api/v1/me').set('Cookie', cookie).expect(401);

      const res = await http()
        .post(`${AUTH}/sign-in/email`)
        .send({ email: user.email, password: TEST_PASSWORD })
        .expect(403);
      expect(res.body.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('throttling', () => {
    it('sign-in: 10/min per IP → 429 TOO_MANY_REQUESTS', async () => {
      const body = { email: 'nobody@kritex.test', password: 'whatever-password' };
      for (let i = 0; i < 10; i++) {
        await http().post(`${AUTH}/sign-in/email`).send(body).expect(401);
      }
      const res = await http().post(`${AUTH}/sign-in/email`).send(body).expect(429);
      expect(res.body).toEqual({
        error: { code: 'TOO_MANY_REQUESTS', message: expect.any(String) },
      });
    });

    it('email-sending endpoints: 5/min per IP', async () => {
      for (let i = 0; i < 5; i++) {
        await http()
          .post(`${AUTH}/request-password-reset`)
          .send({ email: `nobody${i}@kritex.test` })
          .expect(200);
      }
      await http()
        .post(`${AUTH}/request-password-reset`)
        .send({ email: 'nobody@kritex.test' })
        .expect(429);
      // Shares the bucket with OTP sends, so codes can't be sprayed either.
      await http()
        .post(`${AUTH}/email-otp/send-verification-otp`)
        .send({ email: 'nobody@kritex.test', type: 'sign-in' })
        .expect(429);
    });

    it('other auth endpoints: 60/min per IP', async () => {
      for (let i = 0; i < 60; i++) {
        await http().get(`${AUTH}/get-session`).expect(200);
      }
      await http().get(`${AUTH}/get-session`).expect(429);
    });
  });

  it('the seeded admin (SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD) can sign in and use /admin', async () => {
    await runSeed(prisma, {
      catalog: { source: 'test', categories: [], products: [] },
      placeholderPrices: false,
      admin: {
        email: 'Owner@Kritex.test',
        name: 'Owner',
        passwordHash: await hashPassword('seeded-admin-password'),
      },
    });
    const res = await http()
      .post(`${AUTH}/sign-in/email`)
      .set('Origin', TEST_ORIGIN)
      .send({ email: 'owner@kritex.test', password: 'seeded-admin-password' })
      .expect(200);
    expect(res.body.user).toEqual(expect.objectContaining({ role: 'ADMIN', emailVerified: true }));
    await http().get('/api/v1/admin/users').set('Cookie', sessionCookie(res)).expect(200);
  });

  it('unknown auth paths → 404', async () => {
    await http().get(`${AUTH}/does-not-exist`).expect(404);
  });
});
