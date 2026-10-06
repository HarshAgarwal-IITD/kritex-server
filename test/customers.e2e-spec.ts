import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MAX_ADDRESSES } from '../src/customers/customers.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser } from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const address = {
  name: 'Harsh Agarwal',
  phone: '+919876543210',
  line1: '12 MG Road',
  line2: 'Floor 2',
  city: 'Mumbai',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '400001',
};
const GSTIN = '27AAPFU0939F1ZV';

describe('Customers: /me, addresses, business profile (e2e)', () => {
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

  const http = () => request(app.getHttpServer());

  describe('/me', () => {
    it('GET returns the profile; PATCH updates name and phone', async () => {
      const { user, cookie } = await createSignedInUser(app, { name: 'Asha' });
      const me = await http().get('/api/v1/me').set('Cookie', cookie).expect(200);
      expect(me.body).toEqual({
        id: user.id,
        email: user.email,
        emailVerified: true,
        name: 'Asha',
        phone: null,
        role: 'CUSTOMER',
        businessProfile: null,
        createdAt: user.createdAt.toISOString(),
      });

      const updated = await http()
        .patch('/api/v1/me')
        .set('Cookie', cookie)
        .send({ name: '  Asha K ', phone: '9876543210' })
        .expect(200);
      expect(updated.body).toEqual(
        expect.objectContaining({ name: 'Asha K', phone: '9876543210' }),
      );

      const cleared = await http()
        .patch('/api/v1/me')
        .set('Cookie', cookie)
        .send({ phone: null })
        .expect(200);
      expect(cleared.body.phone).toBeNull();
    });

    it('PATCH validates input and ignores fields it does not own', async () => {
      const { user, cookie } = await createSignedInUser(app);
      await http().patch('/api/v1/me').set('Cookie', cookie).send({ phone: '12345' }).expect(400);
      await http()
        .patch('/api/v1/me')
        .set('Cookie', cookie)
        .send({ role: 'ADMIN', email: 'x@y.co' })
        .expect(200);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(stored).toMatchObject({ role: 'CUSTOMER', email: user.email });
    });
  });

  describe('/me/addresses', () => {
    it('CRUD with a single default address', async () => {
      const { cookie } = await createSignedInUser(app);
      const first = await http()
        .post('/api/v1/me/addresses')
        .set('Cookie', cookie)
        .send(address)
        .expect(201);
      expect(first.body).toEqual({
        ...address,
        id: expect.any(String),
        country: 'IN',
        isDefault: true, // first address is the default
      });

      const second = await http()
        .post('/api/v1/me/addresses')
        .set('Cookie', cookie)
        .send({ ...address, line1: '99 Park Street', line2: undefined, isDefault: true })
        .expect(201);
      expect(second.body).toEqual(expect.objectContaining({ line2: null, isDefault: true }));

      let list = await http().get('/api/v1/me/addresses').set('Cookie', cookie).expect(200);
      const items = list.body.items as { id: string; isDefault: boolean }[];
      expect(items.map((a) => [a.id, a.isDefault])).toEqual([
        [second.body.id, true],
        [first.body.id, false],
      ]);

      const patched = await http()
        .patch(`/api/v1/me/addresses/${first.body.id}`)
        .set('Cookie', cookie)
        .send({ city: 'Pune', isDefault: true })
        .expect(200);
      expect(patched.body).toEqual(expect.objectContaining({ city: 'Pune', isDefault: true }));

      // Deleting the default promotes the remaining address.
      await http()
        .delete(`/api/v1/me/addresses/${first.body.id}`)
        .set('Cookie', cookie)
        .expect(204);
      list = await http().get('/api/v1/me/addresses').set('Cookie', cookie).expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({ id: second.body.id, isDefault: true }),
      ]);
    });

    it('validates addresses', async () => {
      const { cookie } = await createSignedInUser(app);
      const res = await http()
        .post('/api/v1/me/addresses')
        .set('Cookie', cookie)
        .send({ ...address, pincode: '012345', stateCode: '99' })
        .expect(400);
      const details = res.body.error.details as { path: string }[];
      expect(details.map((d) => d.path).sort()).toEqual(['pincode', 'stateCode']);
    });

    it(`limits a user to ${MAX_ADDRESSES} addresses → 422 ADDRESS_LIMIT_REACHED`, async () => {
      const { user, cookie } = await createSignedInUser(app);
      await prisma.address.createMany({
        data: Array.from({ length: MAX_ADDRESSES }, () => ({ ...address, userId: user.id })),
      });
      const res = await http()
        .post('/api/v1/me/addresses')
        .set('Cookie', cookie)
        .send(address)
        .expect(422);
      expect(res.body.error.code).toBe('ADDRESS_LIMIT_REACHED');
    });

    it('IDOR: user B cannot read, modify or delete user A’s addresses', async () => {
      const a = await createSignedInUser(app);
      const b = await createSignedInUser(app);
      const created = await http()
        .post('/api/v1/me/addresses')
        .set('Cookie', a.cookie)
        .send(address)
        .expect(201);
      const id = created.body.id as string;

      const listB = await http().get('/api/v1/me/addresses').set('Cookie', b.cookie).expect(200);
      expect(listB.body).toEqual({ items: [] });

      const patch = await http()
        .patch(`/api/v1/me/addresses/${id}`)
        .set('Cookie', b.cookie)
        .send({ city: 'Hacked' })
        .expect(404);
      expect(patch.body.error.code).toBe('NOT_FOUND');
      await http().delete(`/api/v1/me/addresses/${id}`).set('Cookie', b.cookie).expect(404);
      // B making "their" default can't touch A's default either.
      await http()
        .post('/api/v1/me/addresses')
        .set('Cookie', b.cookie)
        .send({ ...address, isDefault: true })
        .expect(201);

      const stored = await prisma.address.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({ userId: a.user.id, city: 'Mumbai', isDefault: true });

      // Anonymous: 401 before anything else.
      await http().patch(`/api/v1/me/addresses/${id}`).send({ city: 'x' }).expect(401);
      await http().delete(`/api/v1/me/addresses/${id}`).expect(401);
    });
  });

  describe('business profile (B2B) apply → admin approve / reject', () => {
    it('apply → 201 PENDING; a second apply → 409; shows on /me', async () => {
      const { cookie } = await createSignedInUser(app);
      const res = await http()
        .post('/api/v1/me/business-profile')
        .set('Cookie', cookie)
        .send({ legalName: 'Kritex Traders', gstin: GSTIN.toLowerCase() })
        .expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        legalName: 'Kritex Traders',
        gstin: GSTIN,
        status: 'PENDING',
        rejectionReason: null,
        createdAt: expect.any(String),
        reviewedAt: null,
      });
      const again = await http()
        .post('/api/v1/me/business-profile')
        .set('Cookie', cookie)
        .send({ legalName: 'Kritex Traders', gstin: GSTIN })
        .expect(409);
      expect(again.body.error.code).toBe('BUSINESS_PROFILE_EXISTS');
      const me = await http().get('/api/v1/me').set('Cookie', cookie).expect(200);
      expect(me.body.businessProfile).toEqual(res.body);
    });

    it('admin approves: status APPROVED and role B2B_CUSTOMER', async () => {
      const customer = await createSignedInUser(app);
      const admin = await createSignedInUser(app, { role: 'ADMIN', name: 'Boss' });
      const applied = await http()
        .post('/api/v1/me/business-profile')
        .set('Cookie', customer.cookie)
        .send({ legalName: 'Kritex Traders', gstin: GSTIN })
        .expect(201);

      const queue = await http()
        .get('/api/v1/admin/business-profiles?status=PENDING')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(queue.body).toEqual({
        items: [
          expect.objectContaining({
            id: applied.body.id,
            status: 'PENDING',
            user: { id: customer.user.id, email: customer.user.email, name: customer.user.name },
            reviewedBy: null,
          }),
        ],
        page: 1,
        limit: 20,
        total: 1,
      });

      const approved = await http()
        .post(`/api/v1/admin/business-profiles/${applied.body.id}/approve`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(approved.body).toEqual(
        expect.objectContaining({
          status: 'APPROVED',
          reviewedAt: expect.any(String),
          reviewedBy: { id: admin.user.id, name: 'Boss' },
        }),
      );
      const me = await http().get('/api/v1/me').set('Cookie', customer.cookie).expect(200);
      expect(me.body.role).toBe('B2B_CUSTOMER');

      const twice = await http()
        .post(`/api/v1/admin/business-profiles/${applied.body.id}/approve`)
        .set('Cookie', admin.cookie)
        .expect(409);
      expect(twice.body.error.code).toBe('INVALID_STATUS');
    });

    it('admin rejects with a reason; the customer can re-apply', async () => {
      const customer = await createSignedInUser(app);
      const staff = await createSignedInUser(app, { role: 'STAFF' });
      const applied = await http()
        .post('/api/v1/me/business-profile')
        .set('Cookie', customer.cookie)
        .send({ legalName: 'Kritex Traders', gstin: GSTIN })
        .expect(201);

      await http()
        .post(`/api/v1/admin/business-profiles/${applied.body.id}/reject`)
        .set('Cookie', staff.cookie)
        .send({})
        .expect(400);
      const rejected = await http()
        .post(`/api/v1/admin/business-profiles/${applied.body.id}/reject`)
        .set('Cookie', staff.cookie)
        .send({ reason: 'GSTIN does not match the legal name' })
        .expect(200);
      expect(rejected.body).toEqual(
        expect.objectContaining({
          status: 'REJECTED',
          rejectionReason: 'GSTIN does not match the legal name',
        }),
      );
      const me = await http().get('/api/v1/me').set('Cookie', customer.cookie).expect(200);
      expect(me.body).toEqual(
        expect.objectContaining({
          role: 'CUSTOMER',
          businessProfile: expect.objectContaining({ status: 'REJECTED' }),
        }),
      );

      const reapplied = await http()
        .post('/api/v1/me/business-profile')
        .set('Cookie', customer.cookie)
        .send({ legalName: 'Kritex Traders Pvt Ltd', gstin: GSTIN })
        .expect(201);
      expect(reapplied.body).toEqual(
        expect.objectContaining({
          id: applied.body.id,
          status: 'PENDING',
          rejectionReason: null,
          reviewedAt: null,
        }),
      );
    });

    it('unknown profile → 404; customers cannot review', async () => {
      const customer = await createSignedInUser(app);
      const admin = await createSignedInUser(app, { role: 'ADMIN' });
      await http()
        .post('/api/v1/admin/business-profiles/unknown-id/approve')
        .set('Cookie', admin.cookie)
        .expect(404);
      await http()
        .post('/api/v1/admin/business-profiles/unknown-id/approve')
        .set('Cookie', customer.cookie)
        .expect(403);
    });
  });

  describe('admin customers', () => {
    it('lists customers (not staff) with search and shows detail', async () => {
      const admin = await createSignedInUser(app, { role: 'ADMIN' });
      const asha = await createSignedInUser(app, { name: 'Asha Rao' });
      await createSignedInUser(app, { name: 'Ravi', role: 'B2B_CUSTOMER' });
      await prisma.address.create({ data: { ...address, userId: asha.user.id, isDefault: true } });

      const list = await http()
        .get('/api/v1/admin/customers')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(list.body.total).toBe(2);
      const customers = list.body.items as { name: string }[];
      expect(customers.map((c) => c.name).sort()).toEqual(['Asha Rao', 'Ravi']);

      const search = await http()
        .get('/api/v1/admin/customers?q=asha')
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(search.body.items).toEqual([
        {
          id: asha.user.id,
          email: asha.user.email,
          emailVerified: true,
          name: 'Asha Rao',
          phone: null,
          role: 'CUSTOMER',
          businessStatus: null,
          orderCount: 0,
          totalSpent: 0,
          createdAt: expect.any(String),
        },
      ]);

      const detail = await http()
        .get(`/api/v1/admin/customers/${asha.user.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(detail.body).toEqual(
        expect.objectContaining({
          id: asha.user.id,
          businessProfile: null,
          addresses: [expect.objectContaining({ city: 'Mumbai', isDefault: true })],
          recentOrders: [],
        }),
      );
      await http().get('/api/v1/admin/customers/nope').set('Cookie', admin.cookie).expect(404);
    });
  });
});
