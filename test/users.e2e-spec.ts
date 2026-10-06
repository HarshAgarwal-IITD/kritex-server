import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';
import {
  TEST_ORIGIN,
  TEST_PASSWORD,
  createSignedInUser,
  createUser,
  linkPath,
  mailbox,
} from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

describe('Admin users (e2e)', () => {
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

  it('is ADMIN only', async () => {
    const staff = await createSignedInUser(app, { role: 'STAFF' });
    await http().get('/api/v1/admin/users').set('Cookie', staff.cookie).expect(403);
    await http().get('/api/v1/admin/users').expect(401);
  });

  it('lists staff and admins by default', async () => {
    const admin = await createSignedInUser(app, { role: 'ADMIN', name: 'Admin' });
    await createSignedInUser(app, { role: 'STAFF', name: 'Staff' });
    await createSignedInUser(app, { role: 'CUSTOMER', name: 'Customer' });

    const res = await http().get('/api/v1/admin/users').set('Cookie', admin.cookie).expect(200);
    expect(res.body).toEqual({
      items: [
        {
          id: admin.user.id,
          email: admin.user.email,
          name: 'Admin',
          role: 'ADMIN',
          emailVerified: true,
          disabled: false,
          createdAt: expect.any(String),
        },
        expect.objectContaining({ name: 'Staff', role: 'STAFF' }),
      ],
      page: 1,
      limit: 20,
      total: 2,
    });
    const customers = await http()
      .get('/api/v1/admin/users?role=CUSTOMER')
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(customers.body.items).toEqual([expect.objectContaining({ name: 'Customer' })]);
  });

  it('invites a staff member who sets a password from the email and signs in', async () => {
    const admin = await createSignedInUser(app, { role: 'ADMIN' });
    const created = await http()
      .post('/api/v1/admin/users')
      .set('Cookie', admin.cookie)
      .send({ email: ' New.Staff@Kritex.test ', name: 'New Staff', role: 'STAFF' })
      .expect(201);
    expect(created.body).toEqual(
      expect.objectContaining({ email: 'new.staff@kritex.test', role: 'STAFF', disabled: false }),
    );

    const invite = mailbox(app).lastTo('new.staff@kritex.test', 'staff-invite');
    expect(invite).toBeDefined();
    const redirect = await http().get(linkPath(invite!.text)).expect(302);
    const location = new URL(redirect.headers.location);
    expect(`${location.origin}${location.pathname}`).toBe(`${TEST_ORIGIN}/reset-password`);

    await http()
      .post('/api/v1/auth/reset-password')
      .send({ token: location.searchParams.get('token'), newPassword: TEST_PASSWORD })
      .expect(200);
    const signIn = await http()
      .post('/api/v1/auth/sign-in/email')
      .send({ email: 'new.staff@kritex.test', password: TEST_PASSWORD })
      .expect(200);
    expect(signIn.body.user).toEqual(expect.objectContaining({ role: 'STAFF' }));

    const dup = await http()
      .post('/api/v1/admin/users')
      .set('Cookie', admin.cookie)
      .send({ email: 'new.staff@kritex.test', name: 'Again', role: 'ADMIN' })
      .expect(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('changes roles and disables users (sessions revoked, sign-in blocked)', async () => {
    const admin = await createSignedInUser(app, { role: 'ADMIN' });
    const staff = await createSignedInUser(app, { role: 'STAFF' });

    const promoted = await http()
      .patch(`/api/v1/admin/users/${staff.user.id}`)
      .set('Cookie', admin.cookie)
      .send({ role: 'ADMIN', name: 'Promoted' })
      .expect(200);
    expect(promoted.body).toEqual(expect.objectContaining({ role: 'ADMIN', name: 'Promoted' }));
    // Roles apply immediately to the existing session.
    await http().get('/api/v1/admin/users').set('Cookie', staff.cookie).expect(200);

    const disabled = await http()
      .patch(`/api/v1/admin/users/${staff.user.id}`)
      .set('Cookie', admin.cookie)
      .send({ disabled: true })
      .expect(200);
    expect(disabled.body.disabled).toBe(true);
    await http().get('/api/v1/me').set('Cookie', staff.cookie).expect(401);
    const blocked = await http()
      .post('/api/v1/auth/sign-in/email')
      .send({ email: staff.user.email, password: TEST_PASSWORD })
      .expect(403);
    expect(blocked.body.code).toBe('ACCOUNT_DISABLED');

    await http()
      .patch(`/api/v1/admin/users/${staff.user.id}`)
      .set('Cookie', admin.cookie)
      .send({ disabled: false })
      .expect(200);
    await http()
      .post('/api/v1/auth/sign-in/email')
      .send({ email: staff.user.email, password: TEST_PASSWORD })
      .expect(200);
  });

  it('CANNOT_MODIFY_SELF and 404', async () => {
    const admin = await createSignedInUser(app, { role: 'ADMIN' });
    for (const body of [{ role: 'STAFF' }, { disabled: true }]) {
      const res = await http()
        .patch(`/api/v1/admin/users/${admin.user.id}`)
        .set('Cookie', admin.cookie)
        .send(body)
        .expect(409);
      expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
    }
    // Renaming yourself is fine.
    await http()
      .patch(`/api/v1/admin/users/${admin.user.id}`)
      .set('Cookie', admin.cookie)
      .send({ name: 'Me' })
      .expect(200);
    await http()
      .patch('/api/v1/admin/users/unknown')
      .set('Cookie', admin.cookie)
      .send({ name: 'x' })
      .expect(404);
  });

  it('LAST_ADMIN: the last active admin cannot be demoted or disabled', async () => {
    // Over HTTP the acting admin is always a second active admin, so this guards races and
    // non-HTTP callers; exercise the service directly.
    const users = app.get(UsersService);
    const solo = await createUser(app, { role: 'ADMIN' });
    const disabledAdmin = await createUser(app, { role: 'ADMIN' });
    await prisma.user.update({ where: { id: disabledAdmin.id }, data: { banned: true } });

    for (const input of [{ role: 'STAFF' as const }, { disabled: true }]) {
      await expect(users.update(solo.id, input, 'another-actor')).rejects.toMatchObject({
        code: 'LAST_ADMIN',
      });
    }
    // With a second active admin it is allowed.
    await prisma.user.update({ where: { id: disabledAdmin.id }, data: { banned: false } });
    await expect(users.update(solo.id, { role: 'STAFF' }, 'another-actor')).resolves.toMatchObject({
      role: 'STAFF',
    });
  });
});
