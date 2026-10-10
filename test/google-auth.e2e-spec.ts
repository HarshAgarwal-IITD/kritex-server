import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { createAuth } from '../src/auth/auth.factory';
import { MailService } from '../src/auth/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_ORIGIN } from './auth';
import { createTestApp, resetDatabase } from './utils';

describe('Google sign-in (ADR-019)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /auth-options reports Google as off when it is not configured', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth-options').expect(200);
    expect(res.body).toEqual({ google: false });
  });

  it('POST /auth/sign-in/social without Google configured is refused', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/sign-in/social')
      .set('Origin', TEST_ORIGIN)
      .send({ provider: 'google', callbackURL: `${TEST_ORIGIN}/account` });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('with Google configured, sign-in redirects to Google with our callback URL', async () => {
    const auth = createAuth({
      prisma,
      mail: app.get(MailService),
      env: {
        NODE_ENV: 'test',
        BETTER_AUTH_SECRET: undefined,
        BETTER_AUTH_URL: 'http://localhost:4000',
        WEB_URL: TEST_ORIGIN,
        CORS_ORIGIN: [TEST_ORIGIN],
        AUTH_COOKIE_DOMAIN: undefined,
        GOOGLE_CLIENT_ID: 'test-client-id.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET: 'test-secret',
      },
    });
    const result = await auth.api.signInSocial({
      body: { provider: 'google', callbackURL: `${TEST_ORIGIN}/account` },
    });
    const url = new URL(result.url!);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe('test-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'http://localhost:4000/api/v1/auth/callback/google',
    );
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});
