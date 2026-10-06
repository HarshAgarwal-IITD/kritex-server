import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser } from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const validBody = {
  name: 'Harsh Agarwal',
  organization: 'Kritex',
  email: 'harsh@example.com',
  requirements: '200 combat shirts, size M-XL',
};

describe('Queries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/v1/queries')
      .send(body as object);

  describe('POST /api/v1/queries', () => {
    it('creates a query → 201 { id, createdAt } and stores trimmed values', async () => {
      const res = await post({
        ...validBody,
        name: '  Harsh Agarwal  ',
        email: ' harsh@example.com ',
      }).expect(201);

      expect(res.body).toEqual({
        id: expect.any(String),
        createdAt: expect.stringMatching(ISO_DATETIME),
      });
      expect(Object.keys(res.body).sort()).toEqual(['createdAt', 'id']);

      const stored = await prisma.query.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored).toMatchObject({
        name: 'Harsh Agarwal',
        organization: 'Kritex',
        email: 'harsh@example.com',
        requirements: validBody.requirements,
        status: 'NEW',
      });
      expect(stored.createdAt.toISOString()).toBe(res.body.createdAt);
    });

    it.each([
      ['empty string', ''],
      ['whitespace only', '   '],
      ['omitted', undefined],
    ])('stores organization as null when %s', async (_label, organization) => {
      const res = await post({ ...validBody, organization }).expect(201);
      const stored = await prisma.query.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(stored.organization).toBeNull();
    });

    it('rejects invalid input → 400 VALIDATION_ERROR with per-field details', async () => {
      const res = await post({
        name: '   ',
        email: 'not-an-email',
        requirements: 'x'.repeat(5001),
        organization: 'o'.repeat(201),
      }).expect(400);

      expect(res.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: expect.any(Array),
        },
      });
      const paths = (res.body.error.details as { path: string }[]).map((d) => d.path).sort();
      expect(paths).toEqual(['email', 'name', 'organization', 'requirements']);
      for (const detail of res.body.error.details) {
        expect(detail).toEqual({
          path: expect.any(String),
          code: expect.any(String),
          message: expect.any(String),
        });
      }
      expect(await prisma.query.count()).toBe(0);
    });

    it('rejects a missing body → 400 VALIDATION_ERROR', async () => {
      const res = await post({}).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects malformed JSON → 400 BAD_REQUEST in the error shape', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/queries')
        .set('Content-Type', 'application/json')
        .send('{"name": ')
        .expect(400);
      expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: expect.any(String) } });
    });

    it('is rate limited to 5/min per IP → 429 TOO_MANY_REQUESTS', async () => {
      for (let i = 0; i < 5; i++) {
        await post(validBody).expect(201);
      }
      const res = await post(validBody).expect(429);
      expect(res.body).toEqual({
        error: { code: 'TOO_MANY_REQUESTS', message: expect.any(String) },
      });
    });
  });

  describe.each([
    ['GET /api/v1/queries (listQueries)', '/api/v1/queries'],
    ['GET /api/v1/admin/queries (adminListQueries)', '/api/v1/admin/queries'],
  ])('%s', (_label, url) => {
    it('requires a STAFF/ADMIN session → 401 / 403', async () => {
      const missing = await request(app.getHttpServer()).get(url).expect(401);
      expect(missing.body).toEqual({
        error: { code: 'UNAUTHORIZED', message: expect.any(String) },
      });
      // The retired API key no longer works.
      await request(app.getHttpServer())
        .get(url)
        .set('Authorization', 'Bearer test-admin-key')
        .expect(401);

      const customer = await createSignedInUser(app);
      await request(app.getHttpServer()).get(url).set('Cookie', customer.cookie).expect(403);
    });

    it('lists queries newest first with the full Query shape', async () => {
      const first = await post({ ...validBody, name: 'First', organization: '' }).expect(201);
      const second = await post({ ...validBody, name: 'Second' }).expect(201);
      const { cookie } = await createSignedInUser(app, { role: 'STAFF' });

      const res = await request(app.getHttpServer()).get(url).set('Cookie', cookie).expect(200);

      expect(res.body).toEqual([
        {
          id: second.body.id,
          name: 'Second',
          organization: 'Kritex',
          email: validBody.email,
          requirements: validBody.requirements,
          status: 'NEW',
          createdAt: expect.stringMatching(ISO_DATETIME),
        },
        expect.objectContaining({ id: first.body.id, name: 'First', organization: null }),
      ]);
    });

    it('returns [] when there are no queries', async () => {
      const { cookie } = await createSignedInUser(app, { role: 'ADMIN' });
      const res = await request(app.getHttpServer()).get(url).set('Cookie', cookie).expect(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('PATCH /api/v1/admin/queries/:id', () => {
    it('updates the status', async () => {
      const created = await post(validBody).expect(201);
      const { cookie } = await createSignedInUser(app, { role: 'STAFF' });
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/queries/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({ id: created.body.id, status: 'IN_PROGRESS' }),
      );
    });

    it('400 for an unknown status, 404 for an unknown id', async () => {
      const { cookie } = await createSignedInUser(app, { role: 'ADMIN' });
      const created = await post(validBody).expect(201);
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/queries/${created.body.id}`)
        .set('Cookie', cookie)
        .send({ status: 'NOPE' })
        .expect(400);
      const res = await request(app.getHttpServer())
        .patch('/api/v1/admin/queries/unknown')
        .set('Cookie', cookie)
        .send({ status: 'IN_PROGRESS' })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });
  });
});
