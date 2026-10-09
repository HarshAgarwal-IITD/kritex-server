import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { FAKE_SHIPROCKET_WEBHOOK_TOKEN } from '../src/shipping/provider/fake-shipping.provider';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { seedCheckoutCatalog } from './checkout-fixtures';
import { outbox, placeOrder, settle } from './ops-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

describe('Shipping (e2e): fake Shiprocket flow, tracking webhook, public tracking', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let staff: { user: { id: string }; cookie: string };
  let customer: { user: { id: string; email: string }; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await settle(app);
    await resetDatabase(prisma);
    resetThrottler(app);
    outbox(app).length = 0;
    v = await seedCheckoutCatalog(prisma);
    staff = await signInAsStaff(app);
    customer = await createSignedInUser(app, { name: 'Asha Rao' });
  });

  afterAll(async () => {
    await settle(app);
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const asStaff = (url: string) =>
    http().post(`/api/v1${url}`).set('Cookie', staff.cookie).set('Origin', TEST_ORIGIN);
  const webhook = (body: unknown, token = FAKE_SHIPROCKET_WEBHOOK_TOKEN) =>
    http()
      .post('/api/v1/webhooks/shiprocket')
      .set('x-api-key', token)
      .send(body as object);
  const orderRow = (id: string) => prisma.order.findUniqueOrThrow({ where: { id } });

  it('creates a shipment (order + AWB + label + pickup) → SHIPPED, then webhook DELIVERED', async () => {
    const o = await placeOrder(app, [{ variantId: v.shirtM.id, quantity: 2 }], { user: customer });
    await settle(app);

    const created = await asStaff(`/admin/orders/${o.id}/shiprocket`).send({}).expect(201);
    expect(created.body).toEqual({
      id: expect.any(String),
      carrier: 'Fake Courier',
      awb: expect.stringMatching(/^FAKE\d{10}$/),
      trackingUrl: expect.stringContaining('/fake-shiprocket/track/FAKE'),
      status: 'READY_TO_SHIP',
      events: [
        expect.objectContaining({ status: 'AWB ASSIGNED' }),
        expect.objectContaining({ status: 'PICKUP SCHEDULED' }),
      ],
      shippedAt: expect.any(String),
      deliveredAt: null,
      shiprocketOrderId: expect.stringMatching(/^fake_order_\d{9}$/),
      shiprocketShipmentId: expect.stringMatching(/^fake_ship_\d{9}$/),
      labelUrl: expect.stringContaining('/fake-shiprocket/labels/'),
      manual: false,
    });
    expect((await orderRow(o.id)).status).toBe('SHIPPED');
    const awb = created.body.awb as string;

    // A second create is refused once the parcel is handed over (the order is SHIPPED).
    const again = await asStaff(`/admin/orders/${o.id}/shiprocket`).send({}).expect(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');

    // Carrier updates: in transit, then delivered (sent twice: idempotent).
    await webhook({
      awb,
      current_status: 'IN TRANSIT',
      current_timestamp: '10 10 2026 09:00:00',
      courier_name: 'Fake Courier',
      scans: [
        {
          date: '2026-10-10 08:30:00',
          activity: 'Picked up from seller',
          location: 'Mumbai',
          'sr-status-label': 'PICKED UP',
        },
      ],
    }).expect(200, { received: true });
    const delivered = {
      awb,
      current_status: 'DELIVERED',
      current_timestamp: '11 10 2026 15:20:00',
      scans: [
        {
          date: '2026-10-11 15:20:00',
          activity: 'Delivered to consignee',
          location: 'Mumbai',
          'sr-status-label': 'DELIVERED',
        },
      ],
    };
    await webhook(delivered).expect(200, { received: true });
    await webhook(delivered).expect(200, { received: true });
    await settle(app);

    const shipment = await prisma.shipment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(shipment.status).toBe('DELIVERED');
    expect(shipment.deliveredAt?.toISOString()).toBe('2026-10-11T09:50:00.000Z'); // 15:20 IST
    const statuses = (shipment.events as { status: string }[]).map((e) => e.status);
    expect(statuses).toEqual([
      'AWB ASSIGNED',
      'PICKUP SCHEDULED',
      'PICKED UP',
      'IN TRANSIT',
      'DELIVERED',
    ]);
    expect((await orderRow(o.id)).status).toBe('DELIVERED');

    const events = await prisma.orderEvent.findMany({
      where: { orderId: o.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.filter((e) => e.type === 'DELIVERED')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'SHIPMENT_IN_TRANSIT')).toHaveLength(1);

    // Emails: shipped once (with the AWB), delivered once.
    const mails = outbox(app).filter((m) => m.to === customer.user.email);
    expect(mails.map((m) => m.tag).sort()).toEqual([
      'order-confirmation',
      'order-delivered',
      'order-shipped',
    ]);
    expect(mails.find((m) => m.tag === 'order-shipped')!.text).toContain(awb);

    // Public tracking: needs the order email; no PII beyond status / timeline.
    const tracking = await http()
      .get(`/api/v1/orders/${o.number.toLowerCase()}/tracking`)
      .query({ email: customer.user.email.toUpperCase() })
      .expect(200);
    expect(tracking.body).toEqual({
      orderNumber: o.number,
      status: 'DELIVERED',
      placedAt: o.createdAt.toISOString(),
      shipments: [
        {
          id: created.body.id,
          carrier: 'Fake Courier',
          awb,
          trackingUrl: created.body.trackingUrl,
          status: 'DELIVERED',
          events: expect.arrayContaining([
            {
              at: '2026-10-11T09:50:00.000Z',
              status: 'DELIVERED',
              location: 'Mumbai',
              description: 'Delivered to consignee',
            },
          ]),
          shippedAt: expect.any(String),
          deliveredAt: '2026-10-11T09:50:00.000Z',
        },
      ],
      timeline: expect.arrayContaining([
        expect.objectContaining({ type: 'SHIPPED' }),
        expect.objectContaining({ type: 'DELIVERED' }),
      ]),
    });
    expect((tracking.body.timeline as { type: string }[]).map((t) => t.type)).not.toContain(
      'SHIPMENT_CREATED', // internal
    );
    expect(JSON.stringify(tracking.body)).not.toContain('MG Road');

    const wrong = await http()
      .get(`/api/v1/orders/${o.number}/tracking`)
      .query({ email: 'someone@else.com' })
      .expect(404);
    expect(wrong.body.error.code).toBe('NOT_FOUND');
    await http()
      .get('/api/v1/orders/KTX-999999/tracking')
      .query({ email: customer.user.email })
      .expect(404);
    await http().get(`/api/v1/orders/${o.number}/tracking`).expect(400);
  });

  it('without pickup: PROCESSING; label + pickup endpoints; webhook PICKED UP is a no-op for the order', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    const created = await asStaff(`/admin/orders/${o.id}/shiprocket`)
      .send({ schedulePickup: false, weightGrams: 1200, lengthCm: 40 })
      .expect(201);
    expect(created.body.status).toBe('READY_TO_SHIP');
    expect((await orderRow(o.id)).status).toBe('PROCESSING');

    // Calling create again resumes the same shipment (nothing left to do but pickup).
    const resumed = await asStaff(`/admin/orders/${o.id}/shiprocket`)
      .send({ schedulePickup: false })
      .expect(201);
    expect(resumed.body.id).toBe(created.body.id);
    expect(await prisma.shipment.count({ where: { orderId: o.id } })).toBe(1);

    const label = await asStaff(`/admin/shipments/${created.body.id}/label`).expect(201);
    expect(label.body.labelUrl).toContain('/fake-shiprocket/labels/');

    const picked = await asStaff(`/admin/shipments/${created.body.id}/pickup`).expect(201);
    expect((picked.body.events as { status: string }[]).at(-1)?.status).toBe('PICKUP SCHEDULED');
    expect((await orderRow(o.id)).status).toBe('SHIPPED');

    await webhook({ awb: created.body.awb, current_status: 'PICKED UP' }).expect(200);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(s.status).toBe('SHIPPED');
    expect((await orderRow(o.id)).status).toBe('SHIPPED');

    await asStaff('/admin/shipments/clx0000000000000000000000/label').expect(404);
  });

  it('refuses unpaid orders and a second concurrent create', async () => {
    const unpaid = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], {
      user: customer,
      pay: false,
    });
    const res = await asStaff(`/admin/orders/${unpaid.id}/shiprocket`).send({}).expect(409);
    expect(res.body.error).toEqual(
      expect.objectContaining({
        code: 'INVALID_TRANSITION',
        details: { from: 'PENDING_PAYMENT', to: 'SHIPPED' },
      }),
    );

    const paid = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    const results = await Promise.all([
      asStaff(`/admin/orders/${paid.id}/shiprocket`).send({}),
      asStaff(`/admin/orders/${paid.id}/shiprocket`).send({}),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.shipment.count({ where: { orderId: paid.id } })).toBe(1);

    // Customers can't use admin routes.
    await http()
      .post(`/api/v1/admin/orders/${paid.id}/shiprocket`)
      .set('Cookie', customer.cookie)
      .set('Origin', TEST_ORIGIN)
      .send({})
      .expect(403);
  });

  it('webhook: checks the x-api-key token; ignores unknown AWBs and malformed bodies', async () => {
    const bad = await webhook({ awb: 'X', current_status: 'DELIVERED' }, 'wrong-token').expect(401);
    expect(bad.body.error.code).toBe('UNAUTHORIZED');
    await http()
      .post('/api/v1/webhooks/shiprocket')
      .send({ awb: 'X', current_status: 'DELIVERED' })
      .expect(401);
    await webhook({ awb: 'UNKNOWN123', current_status: 'DELIVERED' }).expect(200, {
      received: true,
    });
    await webhook({ hello: 'world' }).expect(200, { received: true });
  });

  it('webhook DELIVERED for an order still PROCESSING passes through SHIPPED (both emails once)', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    const created = await asStaff(`/admin/orders/${o.id}/shiprocket`)
      .send({ schedulePickup: false })
      .expect(201);
    await webhook({ awb: created.body.awb, current_status: 'DELIVERED' }).expect(200);
    await webhook({ awb: created.body.awb, current_status: 'DELIVERED' }).expect(200);
    await settle(app);
    expect((await orderRow(o.id)).status).toBe('DELIVERED');
    const tags = outbox(app)
      .filter((m) => m.to === customer.user.email)
      .map((m) => m.tag)
      .sort();
    expect(tags).toEqual(['order-confirmation', 'order-delivered', 'order-shipped']);
  });

  it('RTO is recorded as an internal event without changing the order', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    const created = await asStaff(`/admin/orders/${o.id}/shiprocket`).send({}).expect(201);
    await webhook({ awb: created.body.awb, current_status: 'RTO INITIATED' }).expect(200);
    const s = await prisma.shipment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(s.status).toBe('RTO');
    expect((await orderRow(o.id)).status).toBe('SHIPPED');
    const rto = await prisma.orderEvent.findFirstOrThrow({
      where: { orderId: o.id, type: 'SHIPMENT_RTO' },
    });
    expect(rto.internal).toBe(true);
    // Later updates can't move it back.
    await webhook({ awb: created.body.awb, current_status: 'DELIVERED' }).expect(200);
    expect((await prisma.shipment.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('RTO');
  });
});
