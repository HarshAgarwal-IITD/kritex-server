import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

describe('Admin coupons (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let staff: string;

  const http = () => request(app.getHttpServer());
  const codes = (res: request.Response) =>
    (res.body as { items: { code: string }[] }).items.map((c) => c.code);
  const create = (body: object, cookie = staff) =>
    http()
      .post('/api/v1/admin/coupons')
      .set('Cookie', cookie)
      .set('Origin', TEST_ORIGIN)
      .send(body);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    resetThrottler(app);
    await resetDatabase(prisma);
    staff = (await signInAsStaff(app)).cookie;
  });

  afterAll(async () => {
    await app.close();
  });

  it('requires STAFF/ADMIN (401 anonymous, 403 customer)', async () => {
    await http().get('/api/v1/admin/coupons').expect(401);
    const customer = (await createSignedInUser(app)).cookie;
    const res = await http().get('/api/v1/admin/coupons').set('Cookie', customer).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await create({ code: 'X10', type: 'PERCENT', value: 10 }, customer).expect(403);
    const admin = (await createSignedInUser(app, { role: 'ADMIN' })).cookie;
    await http().get('/api/v1/admin/coupons').set('Cookie', admin).expect(200);
  });

  it('creates (upper-cased), gets, lists with filters and updates', async () => {
    const res = await create({
      code: 'diwali-25',
      type: 'PERCENT',
      value: 25,
      maxDiscount: 50000,
      minSubtotal: 100000,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z',
      usageLimit: 100,
      perUserLimit: 1,
    }).expect(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      code: 'DIWALI-25',
      type: 'PERCENT',
      value: 25,
      minSubtotal: 100000,
      maxDiscount: 50000,
      startsAt: '2026-10-01T00:00:00.000Z',
      endsAt: '2026-11-01T00:00:00.000Z',
      usageLimit: 100,
      perUserLimit: 1,
      usedCount: 0,
      isActive: true,
      createdAt: expect.any(String),
    });
    await create({ code: 'SHIPFREE', type: 'FREE_SHIPPING', value: 0, isActive: false }).expect(
      201,
    );

    const got = await http()
      .get(`/api/v1/admin/coupons/${res.body.id}`)
      .set('Cookie', staff)
      .expect(200);
    expect(got.body.code).toBe('DIWALI-25');

    const all = await http().get('/api/v1/admin/coupons').set('Cookie', staff).expect(200);
    expect(all.body).toMatchObject({ page: 1, limit: 20, total: 2 });
    const active = await http()
      .get('/api/v1/admin/coupons')
      .query({ isActive: 'true' })
      .set('Cookie', staff)
      .expect(200);
    expect(codes(active)).toEqual(['DIWALI-25']);
    const search = await http()
      .get('/api/v1/admin/coupons')
      .query({ q: 'ship' })
      .set('Cookie', staff)
      .expect(200);
    expect(codes(search)).toEqual(['SHIPFREE']);

    const updated = await http()
      .patch(`/api/v1/admin/coupons/${res.body.id}`)
      .set('Cookie', staff)
      .send({ value: 30, endsAt: null, code: 'diwali-30' })
      .expect(200);
    expect(updated.body).toMatchObject({ code: 'DIWALI-30', value: 30, endsAt: null });

    await http()
      .get('/api/v1/admin/coupons/clx0000000000000000000000')
      .set('Cookie', staff)
      .expect(404);
  });

  it('codes are unique case-insensitively (409 CONFLICT)', async () => {
    await create({ code: 'SAVE10', type: 'PERCENT', value: 10 }).expect(201);
    const dup = await create({ code: 'save10', type: 'FLAT', value: 100 }).expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
    // A legacy mixed-case row still blocks.
    await prisma.coupon.create({ data: { code: 'Legacy', type: 'FLAT', value: 100 } });
    await create({ code: 'LEGACY', type: 'FLAT', value: 100 }).expect(409);

    const other = await create({ code: 'OTHER', type: 'FLAT', value: 100 }).expect(201);
    await http()
      .patch(`/api/v1/admin/coupons/${other.body.id}`)
      .set('Cookie', staff)
      .send({ code: 'Save10' })
      .expect(409);
    // Re-saving its own code is fine.
    await http()
      .patch(`/api/v1/admin/coupons/${other.body.id}`)
      .set('Cookie', staff)
      .send({ code: 'other' })
      .expect(200);
  });

  it('validates values and dates (400 VALIDATION_ERROR), also against the stored coupon', async () => {
    const bad = async (body: object, path: string) => {
      const res = await create(body).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ path })]),
      );
    };
    await bad({ code: 'P0', type: 'PERCENT', value: 10 }, 'code'); // too short
    await bad({ code: 'BAD CODE', type: 'PERCENT', value: 10 }, 'code');
    await bad({ code: 'P150', type: 'PERCENT', value: 150 }, 'value');
    await bad({ code: 'F0', type: 'FLAT', value: 0 }, 'value');
    await bad({ code: 'FS5', type: 'FREE_SHIPPING', value: 5 }, 'value');
    await bad({ code: 'FMAX', type: 'FLAT', value: 100, maxDiscount: 50 }, 'maxDiscount');
    await bad(
      {
        code: 'DATES',
        type: 'FLAT',
        value: 100,
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-10-01T00:00:00.000Z',
      },
      'endsAt',
    );

    const flat = await create({ code: 'FLAT100', type: 'FLAT', value: 100 }).expect(201);
    // Switching to PERCENT keeps value 100 (ok) but switching to FREE_SHIPPING needs value 0.
    const res = await http()
      .patch(`/api/v1/admin/coupons/${flat.body.id}`)
      .set('Cookie', staff)
      .send({ type: 'FREE_SHIPPING' })
      .expect(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'value' })]);
    await http()
      .patch(`/api/v1/admin/coupons/${flat.body.id}`)
      .set('Cookie', staff)
      .send({ endsAt: '2020-01-01T00:00:00.000Z', startsAt: '2021-01-01T00:00:00.000Z' })
      .expect(400);
  });

  it('deletes an unused coupon; deactivates a used one', async () => {
    const unused = await create({ code: 'UNUSED', type: 'FLAT', value: 100 }).expect(201);
    await http().delete(`/api/v1/admin/coupons/${unused.body.id}`).set('Cookie', staff).expect(204);
    expect(await prisma.coupon.count()).toBe(0);

    const used = await create({ code: 'USED', type: 'FLAT', value: 100 }).expect(201);
    await prisma.coupon.update({ where: { id: used.body.id }, data: { usedCount: 1 } });
    await http().delete(`/api/v1/admin/coupons/${used.body.id}`).set('Cookie', staff).expect(204);
    expect(await prisma.coupon.findUnique({ where: { id: used.body.id } })).toMatchObject({
      isActive: false,
    });

    await http().delete(`/api/v1/admin/coupons/${unused.body.id}`).set('Cookie', staff).expect(404);
  });
});
