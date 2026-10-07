import { type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { ADDRESS, createCart, seedCheckoutCatalog } from './checkout-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

describe('Orders (e2e): customer + admin order endpoints, dashboard', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let customer: { user: { id: string; email: string }; cookie: string };
  let staff: { user: { id: string; name: string }; cookie: string };
  let keyN = 0;
  const emitted: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    app.get(EventEmitter2).onAny((event: string | string[]) => {
      emitted.push(String(event));
    });
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
    emitted.length = 0;
    v = await seedCheckoutCatalog(prisma);
    customer = await createSignedInUser(app, { name: 'Asha' });
    staff = await signInAsStaff(app, { name: 'Staff Sam' });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const asCustomer = (method: 'get' | 'post', url: string) =>
    http()[method](`/api/v1${url}`).set('Cookie', customer.cookie).set('Origin', TEST_ORIGIN);
  const asStaff = (method: 'get' | 'post', url: string) =>
    http()[method](`/api/v1${url}`).set('Cookie', staff.cookie).set('Origin', TEST_ORIGIN);
  const ids = (res: { body: unknown }) =>
    (res.body as { items: { id: string }[] }).items.map((o) => o.id);
  const variant = (id: string) => prisma.variant.findUniqueOrThrow({ where: { id } });

  /** Signed-in checkout of `quantity` × shirt M; optionally paid through the fake gateway. */
  async function order(quantity = 1, pay = true) {
    await prisma.cart.deleteMany({ where: { userId: customer.user.id } });
    await createCart(prisma, [{ variantId: v.shirtM.id, quantity }], { userId: customer.user.id });
    const placed = await asCustomer('post', '/checkout')
      .set('Idempotency-Key', `orders-key-${++keyN}-${Date.now()}`)
      .send({
        email: 'ignored@example.com',
        phone: '9876543210',
        shippingAddress: ADDRESS,
        saveAddress: true,
      })
      .expect(201);
    if (pay) {
      await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: `pay_fake_${keyN}`,
          razorpay_signature: 'fake',
        })
        .expect(200);
    }
    const row = await prisma.order.findUniqueOrThrow({
      where: { number: placed.body.orderNumber },
    });
    return { number: row.number, id: row.id, placed: placed.body };
  }

  describe('customer', () => {
    it('lists own orders and shows detail with a customer-only timeline', async () => {
      const o = await order(2);
      expect(emitted).toContain('order.paid');
      const other = await createSignedInUser(app);
      await http().get(`/api/v1/me/orders/${o.number}`).set('Cookie', other.cookie).expect(404);

      await asStaff('post', `/admin/orders/${o.id}/note`).send({ message: 'VIP' }).expect(200);

      const list = await asCustomer('get', '/me/orders').expect(200);
      expect(list.body).toEqual({
        items: [
          {
            number: o.number,
            status: 'PAID',
            paymentMethod: 'RAZORPAY',
            total: 259800,
            itemCount: 2,
            image: '/assets/shirt.jpg',
            createdAt: expect.any(String),
          },
        ],
        page: 1,
        limit: 20,
        total: 1,
      });
      expect((await asCustomer('get', '/me/orders?status=CANCELLED').expect(200)).body.total).toBe(
        0,
      );

      const detail = await asCustomer('get', `/me/orders/${o.number.toLowerCase()}`).expect(200);
      expect(detail.body).toEqual(
        expect.objectContaining({
          number: o.number,
          status: 'PAID',
          paymentStatus: 'CAPTURED',
          email: customer.user.email,
          phone: '9876543210',
          shippingAddress: { ...ADDRESS, line2: null, country: 'IN' },
          billingAddress: { ...ADDRESS, line2: null, country: 'IN' },
          canCancel: true,
          canRequestReturn: false,
          reservedUntil: null,
          invoice: null,
          quoteNumber: null,
        }),
      );
      expect(detail.body.items).toEqual([
        expect.objectContaining({
          variantId: v.shirtM.id,
          productSlug: 'combat-shirt',
          sku: 'KTX-CS-M',
          quantity: 2,
          lineTotal: 259800,
          discount: 0,
          netTotal: 259800,
          gstRate: 5,
        }),
      ]);
      expect((detail.body.timeline as { type: string }[]).map((e) => e.type)).toEqual([
        'PLACED',
        'PAID',
      ]);
      // saveAddress stored the shipping address.
      expect(await prisma.address.count({ where: { userId: customer.user.id } })).toBe(1);
    });

    it('cancelling a paid order restocks and refunds; shipped orders are not cancellable', async () => {
      const o = await order(2);
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 3, reserved: 0 }),
      );
      const res = await asCustomer('post', `/me/orders/${o.number}/cancel`)
        .send({ reason: 'changed my mind' })
        .expect(200);
      expect(res.body.status).toBe('CANCELLED');
      expect(res.body.paymentStatus).toBe('REFUNDED');
      expect(res.body.canCancel).toBe(false);
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 0 }),
      );
      expect(await prisma.refund.findFirstOrThrow()).toEqual(
        expect.objectContaining({ amount: 259800, status: 'PROCESSED' }),
      );
      expect(emitted).toContain('order.cancelled');

      const again = await asCustomer('post', `/me/orders/${o.number}/cancel`).send({}).expect(409);
      expect(again.body.error.code).toBe('ORDER_NOT_CANCELLABLE');

      const shipped = await order(1);
      await asStaff('post', `/admin/orders/${shipped.id}/ship`)
        .send({ carrier: 'Delhivery' })
        .expect(200);
      expect(emitted).toContain('order.shipped');
      const no = await asCustomer('post', `/me/orders/${shipped.number}/cancel`)
        .send({})
        .expect(409);
      expect(no.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    });

    it('cancelling an unpaid order releases the reservation', async () => {
      const o = await order(1, false);
      expect(await variant(v.shirtM.id)).toEqual(expect.objectContaining({ reserved: 1 }));
      await asCustomer('post', `/me/orders/${o.number}/cancel`).send({}).expect(200);
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 0 }),
      );
    });

    it('POST /me/orders/:number/pay creates a new gateway order for an unpaid order', async () => {
      const o = await order(1, false);
      const res = await asCustomer('post', `/me/orders/${o.number}/pay`).expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          orderNumber: o.number,
          status: 'PENDING_PAYMENT',
          razorpay: expect.objectContaining({ keyId: 'rzp_fake', amount: o.placed.totals.total }),
        }),
      );
      expect(res.body.razorpay.orderId).not.toBe(o.placed.razorpay.orderId);
      expect(await prisma.payment.count({ where: { orderId: o.id } })).toBe(2);

      const paid = await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: res.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_retry',
          razorpay_signature: 'fake',
        })
        .expect(200);
      expect(paid.body.paid).toBe(true);
      const no = await asCustomer('post', `/me/orders/${o.number}/pay`).expect(409);
      expect(no.body.error.code).toBe('ORDER_NOT_PAYABLE');
    });

    it('return request only after delivery, within the window', async () => {
      const o = await order(2);
      const early = await asCustomer('post', `/me/orders/${o.number}/return`)
        .send({
          type: 'EXCHANGE',
          reason: 'SIZE_ISSUE',
          items: [{ orderItemId: 'x', quantity: 1 }],
        })
        .expect(409);
      expect(early.body.error.code).toBe('RETURN_NOT_ALLOWED');

      await asStaff('post', `/admin/orders/${o.id}/ship`)
        .send({ carrier: 'Delhivery', awb: 'AWB1' })
        .expect(200);
      await asStaff('post', `/admin/orders/${o.id}/status`)
        .send({ status: 'DELIVERED' })
        .expect(200);
      const detail = await asCustomer('get', `/me/orders/${o.number}`).expect(200);
      expect(detail.body.canRequestReturn).toBe(true);
      expect(detail.body.shipments).toEqual([
        expect.objectContaining({ carrier: 'Delhivery', awb: 'AWB1', status: 'DELIVERED' }),
      ]);
      const itemId = detail.body.items[0].id;

      const tooMany = await asCustomer('post', `/me/orders/${o.number}/return`)
        .send({
          type: 'RETURN',
          reason: 'DEFECTIVE',
          items: [{ orderItemId: itemId, quantity: 3 }],
        })
        .expect(422);
      expect(tooMany.body.error.code).toBe('INVALID_RETURN_ITEMS');

      const res = await asCustomer('post', `/me/orders/${o.number}/return`)
        .send({
          type: 'EXCHANGE',
          reason: 'SIZE_ISSUE',
          items: [{ orderItemId: itemId, quantity: 1, exchangeVariantId: v.shirtL.id }],
          notes: 'Need L',
        })
        .expect(200);
      expect(res.body.status).toBe('RETURN_REQUESTED');
      expect((res.body.timeline as unknown[]).at(-1)).toEqual(
        expect.objectContaining({ type: 'RETURN_REQUESTED', message: 'Exchange requested' }),
      );
    });
  });

  describe('admin', () => {
    it('lists with filters, shows detail with events/actors/allowedTransitions, moves status', async () => {
      const paid = await order(1);
      const unpaid = await order(1, false);

      const all = await asStaff('get', '/admin/orders').expect(200);
      expect(all.body.total).toBe(2);
      expect(all.body.items[0]).toEqual(
        expect.objectContaining({
          id: unpaid.id,
          customerName: 'Asha',
          isGuest: false,
          isB2B: false,
          itemCount: 1,
          paymentStatus: 'CREATED',
        }),
      );
      const filtered = await asStaff('get', '/admin/orders?status=PAID').expect(200);
      expect(ids(filtered)).toEqual([paid.id]);
      const byQ = await asStaff('get', `/admin/orders?q=${paid.number.toLowerCase()}`).expect(200);
      expect(ids(byQ)).toEqual([paid.id]);
      const byPayment = await asStaff('get', '/admin/orders?paymentStatus=CAPTURED').expect(200);
      expect(ids(byPayment)).toEqual([paid.id]);
      const byUser = await asStaff('get', `/admin/orders?userId=${customer.user.id}`).expect(200);
      expect(byUser.body.total).toBe(2);
      expect((await asStaff('get', '/admin/orders?userId=nobody').expect(200)).body.total).toBe(0);
      const byName = await asStaff('get', '/admin/orders?q=asha&sort=oldest').expect(200);
      expect(ids(byName)).toEqual([paid.id, unpaid.id]);

      await asStaff('post', `/admin/orders/${paid.id}/note`)
        .send({ message: 'Gift wrap', internal: true })
        .expect(200);
      const moved = await asStaff('post', `/admin/orders/${paid.id}/status`)
        .send({ status: 'PROCESSING', note: 'Packing' })
        .expect(200);
      expect(moved.body).toEqual(
        expect.objectContaining({
          id: paid.id,
          userId: customer.user.id,
          status: 'PROCESSING',
          allowedTransitions: ['SHIPPED', 'CANCELLED'],
          payments: [expect.objectContaining({ provider: 'RAZORPAY', status: 'CAPTURED' })],
          refunds: [],
        }),
      );
      expect(moved.body.events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'NOTE',
            message: 'Gift wrap',
            internal: true,
            actor: { id: staff.user.id, name: 'Staff Sam' },
          }),
          expect.objectContaining({ type: 'PROCESSING', internal: false }),
        ]),
      );
      const timeline = (await asCustomer('get', `/me/orders/${paid.number}`).expect(200)).body
        .timeline as { type: string }[];
      expect(timeline.map((e) => e.type)).toEqual(['PLACED', 'PAID', 'PROCESSING']);

      const invalid = await asStaff('post', `/admin/orders/${paid.id}/status`)
        .send({ status: 'PAID' })
        .expect(409);
      expect(invalid.body.error.code).toBe('INVALID_TRANSITION');
      await asStaff('get', '/admin/orders/clx0000000000000000000000').expect(404);

      // Customers can't reach admin routes.
      await asCustomer('get', '/admin/orders').expect(403);
    });

    it('partial and full refunds through the gateway', async () => {
      const o = await order(2);
      const partial = await asStaff('post', `/admin/orders/${o.id}/refund`)
        .send({ amount: 50000, reason: 'Late delivery' })
        .expect(200);
      expect(partial.body.status).toBe('PAID');
      expect(partial.body.refundableAmount).toBe(209800);
      expect(partial.body.refunds).toEqual([
        expect.objectContaining({
          amount: 50000,
          status: 'PROCESSED',
          providerRefundId: expect.stringMatching(/^rfnd_fake_/),
        }),
      ]);
      const tooMuch = await asStaff('post', `/admin/orders/${o.id}/refund`)
        .send({ amount: 999999, reason: 'x' })
        .expect(409);
      expect(tooMuch.body.error).toEqual(
        expect.objectContaining({
          code: 'REFUND_EXCEEDS_CAPTURED',
          details: { refundable: 209800 },
        }),
      );
      const itemId = partial.body.items[0].id;
      const full = await asStaff('post', `/admin/orders/${o.id}/refund`)
        .send({
          amount: 209800,
          reason: 'Defective',
          restockItems: [{ orderItemId: itemId, quantity: 1 }],
        })
        .expect(200);
      expect(full.body.status).toBe('REFUNDED');
      expect(full.body.paymentStatus).toBe('REFUNDED');
      expect(full.body.refundableAmount).toBe(0);
      expect(await variant(v.shirtM.id)).toEqual(expect.objectContaining({ stock: 4 }));
      const none = await asStaff('post', `/admin/orders/${o.id}/refund`)
        .send({ amount: 1, reason: 'x' })
        .expect(409);
      expect(none.body.error.code).toBe('NOT_REFUNDABLE');
    });

    it('admin cancel without restock/refund; mark-paid for a bank-transfer order', async () => {
      const o = await order(1);
      const cancelled = await asStaff('post', `/admin/orders/${o.id}/cancel`)
        .send({ reason: 'Fraud check', restock: false, refund: false })
        .expect(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(cancelled.body.refunds).toEqual([]);
      expect(await variant(v.shirtM.id)).toEqual(expect.objectContaining({ stock: 4 }));

      // Bank transfer orders are AWAITING_PAYMENT with stock reserved (created directly here:
      // BANK_TRANSFER_* env is unset in tests, so checkout doesn't offer it).
      await prisma.variant.update({ where: { id: v.kit.id }, data: { reserved: 2 } });
      const bank = await prisma.order.create({
        data: {
          number: 'KTX-900001',
          userId: customer.user.id,
          email: customer.user.email,
          phone: '9876543210',
          status: 'AWAITING_PAYMENT',
          paymentMethod: 'BANK_TRANSFER',
          shippingAddress: { ...ADDRESS, line2: null, country: 'IN' },
          billingAddress: { ...ADDRESS, line2: null, country: 'IN' },
          subtotal: 1999800,
          total: 1999800,
          items: {
            create: [
              {
                variantId: v.kit.id,
                productName: 'Field Kit',
                variantTitle: 'Default',
                sku: 'KTX-FK',
                unitPrice: 999900,
                quantity: 2,
                gstRate: 18,
                taxAmount: 305054,
                lineTotal: 1999800,
                netTotal: 1999800,
              },
            ],
          },
        },
      });
      const wrong = await asStaff('post', `/admin/orders/${o.id}/mark-paid`)
        .send({ reference: 'UTR1' })
        .expect(409);
      expect(wrong.body.error.code).toBe('INVALID_TRANSITION');
      const paid = await asStaff('post', `/admin/orders/${bank.id}/mark-paid`)
        .send({ reference: 'UTR123', note: 'HDFC' })
        .expect(200);
      expect(paid.body.status).toBe('PAID');
      expect(paid.body.payments).toEqual([
        expect.objectContaining({
          provider: 'BANK_TRANSFER',
          reference: 'UTR123',
          amount: 1999800,
          status: 'CAPTURED',
        }),
      ]);
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 8, reserved: 0 }));
    });

    it('CSV export: one row per item, filters, injection-safe', async () => {
      const o = await order(2);
      await prisma.order.update({ where: { id: o.id }, data: { businessName: '=HYPERLINK("x")' } });
      const res = await asStaff('get', '/admin/orders/export.csv?status=PAID').expect(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('orders.csv');
      const lines = res.text.trim().split('\r\n');
      expect(lines).toHaveLength(2);
      expect(lines[0].split(',').slice(0, 3)).toEqual(['order_number', 'created_at', 'status']);
      expect(lines[1]).toContain(`${o.number},`);
      expect(lines[1]).toContain('KTX-CS-M');
      expect(lines[1]).toContain(`"'=HYPERLINK(""x"")"`);
      const none = await asStaff('get', '/admin/orders/export.csv?status=SHIPPED').expect(200);
      expect(none.text.trim().split('\r\n')).toHaveLength(1);
    });

    it('dashboard: revenue windows, counts by status, low stock', async () => {
      await order(2); // paid 259800
      await order(1, false); // pending
      const res = await asStaff('get', '/admin/dashboard').expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          revenue: { today: 259800, last7Days: 259800, last30Days: 259800 },
          pendingQuotes: 0,
          newEnquiries: 0,
          pendingBusinessProfiles: 0,
          awaitingPaymentOrders: 0,
        }),
      );
      expect(res.body.orders).toEqual(
        expect.objectContaining({ today: 1, last7Days: 1, last30Days: 1 }),
      );
      expect(res.body.orders.byStatus).toHaveLength(10);
      expect(res.body.orders.byStatus).toEqual(
        expect.arrayContaining([
          { status: 'PAID', count: 1 },
          { status: 'PENDING_PAYMENT', count: 1 },
          { status: 'SHIPPED', count: 0 },
        ]),
      );
      // shirt M: 5 - 2 sold - 1 reserved = 2; shirt L: 1; helmet: 3 (all <= 5). Kit: 10.
      expect(
        (res.body.lowStock as { sku: string; available: number }[]).map((l) => [
          l.sku,
          l.available,
        ]),
      ).toEqual([
        ['KTX-CS-L', 1],
        ['KTX-CS-M', 2],
        ['KTX-TH', 3],
      ]);
      const strict = await asStaff('get', '/admin/dashboard?threshold=1').expect(200);
      expect((strict.body.lowStock as { sku: string }[]).map((l) => l.sku)).toEqual(['KTX-CS-L']);
      await asStaff('get', '/admin/dashboard?threshold=21').expect(400);
    });
  });
});
