import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ReservationExpiryJob } from '../src/orders/reservation-expiry.job';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  ADDRESS,
  createCart,
  KARNATAKA,
  paymentCapturedEvent,
  refundProcessedEvent,
  seedCheckoutCatalog,
  signedWebhook,
} from './checkout-fixtures';
import { createSignedInUser } from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

describe('Checkout (e2e): quote, place order, fake gateway verify, webhooks, expiry, race', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let keyN = 0;
  const key = () => `test-key-${Date.now()}-${++keyN}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
    v = await seedCheckoutCatalog(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  /** Checkout needs a verified account (ADR-020): a fresh customer with a cart, and their cookie. */
  const buyerCart = async (
    lines: { variantId: string; quantity: number }[],
    options: { couponCode?: string } = {},
  ) => {
    const buyer = await createSignedInUser(app);
    const cart = await createCart(prisma, lines, { ...options, userId: buyer.user.id });
    return { ...cart, cookie: buyer.cookie, buyer };
  };
  const placeBody = (extra: Record<string, unknown> = {}) => ({
    email: 'Guest@Example.com',
    phone: '9876543210',
    shippingAddress: ADDRESS,
    ...extra,
  });
  const place = (cookie: string, idemKey: string, body = placeBody()) =>
    http()
      .post('/api/v1/checkout')
      .set('Cookie', cookie)
      .set('Idempotency-Key', idemKey)
      .send(body);
  const variant = (id: string) => prisma.variant.findUniqueOrThrow({ where: { id } });
  const webhook = (body: unknown) => {
    const { raw, signature } = signedWebhook(body);
    return http()
      .post('/api/v1/webhooks/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .send(raw);
  };

  describe('POST /checkout/quote', () => {
    it('prices the guest cart with the tax split; lines carry discount and netTotal', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 2 }]);
      const res = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(200);
      // 2 × ₹1,299 (HSN 6205, per-unit taxable value under the slab → 5%), free shipping.
      expect(res.body).toEqual({
        items: [
          {
            variantId: v.shirtM.id,
            productName: 'Combat Shirt',
            variantTitle: 'M',
            sku: 'KTX-CS-M',
            image: '/assets/shirt.jpg',
            unitPrice: 129900,
            quantity: 2,
            gstRate: 5,
            taxAmount: 12371,
            lineTotal: 259800,
            discount: 0,
            netTotal: 259800,
          },
        ],
        couponCode: null,
        totals: {
          subtotal: 259800,
          discount: 0,
          shipping: 0,
          taxTotal: 12371,
          cgst: 6186,
          sgst: 6185,
          igst: 0,
          total: 259800,
          currency: 'INR',
        },
        interState: false,
        paymentMethods: ['RAZORPAY'],
      });

      const inter = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: KARNATAKA })
        .expect(200);
      expect(inter.body.interState).toBe(true);
      expect(inter.body.totals).toEqual(expect.objectContaining({ cgst: 0, sgst: 0, igst: 12371 }));
    });

    it('spreads a coupon over lines: tax is computed on netTotal', async () => {
      await prisma.coupon.create({ data: { code: 'TEN', type: 'PERCENT', value: 10 } });
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }], {
        couponCode: 'TEN',
      });
      const res = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(200);
      const [line] = res.body.items;
      expect(line).toEqual(
        expect.objectContaining({ lineTotal: 129900, discount: 12990, netTotal: 116910 }),
      );
      expect(line.taxAmount).toBe(Math.round((116910 * 5) / 105));
      expect(res.body.couponCode).toBe('TEN');
      expect(res.body.totals.discount).toBe(12990);
    });

    it('needs a session (401) with a verified email (403); no guest checkout (ADR-020)', async () => {
      const { cookie: guestCookie } = await createCart(prisma, [
        { variantId: v.shirtM.id, quantity: 1 },
      ]);
      for (const path of ['/api/v1/checkout/quote', '/api/v1/checkout']) {
        const res = await http()
          .post(path)
          .set('Cookie', guestCookie)
          .set('Idempotency-Key', key())
          .send(placeBody())
          .expect(401);
        expect(res.body.error.code).toBe('UNAUTHORIZED');
      }
      const unverified = await createSignedInUser(app);
      await prisma.user.update({
        where: { id: unverified.user.id },
        data: { emailVerified: false },
      });
      const res = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', unverified.cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(403);
      expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED');
      expect(await prisma.order.count()).toBe(0);
    });

    it('422 CART_EMPTY without a cart; 422 CART_HAS_ISSUES for an enquiry-only line', async () => {
      const nobody = await createSignedInUser(app);
      const empty = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', nobody.cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(422);
      expect(empty.body.error.code).toBe('CART_EMPTY');

      const { cookie } = await buyerCart([
        { variantId: v.shirtM.id, quantity: 1 },
        { variantId: v.helmet.id, quantity: 1 },
      ]);
      const res = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(422);
      expect(res.body.error).toEqual({
        code: 'CART_HAS_ISSUES',
        message: expect.any(String),
        details: { lines: [{ variantId: v.helmet.id, issue: 'NOT_PURCHASABLE' }] },
      });
    });

    it('rejects an invalid stored coupon with its COUPON_* code', async () => {
      await prisma.coupon.create({
        data: { code: 'OLD', type: 'FLAT', value: 1000, endsAt: new Date('2020-01-01') },
      });
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }], {
        couponCode: 'OLD',
      });
      const res = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(422);
      expect(res.body.error.code).toBe('COUPON_EXPIRED');
    });

    it('422 GSTIN_STATE_MISMATCH when the GSTIN is from another state than billing', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const res = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: KARNATAKA, gstin: '27AAPFU0939F1ZV', businessName: 'Acme' })
        .expect(422);
      expect(res.body.error.code).toBe('GSTIN_STATE_MISMATCH');
    });
  });

  describe('POST /checkout + /checkout/verify (fake gateway)', () => {
    it('checkout → fake pay → PAID; stock decremented, cart cleared, coupon counted', async () => {
      await prisma.coupon.create({ data: { code: 'FLAT100', type: 'FLAT', value: 10000 } });
      const { cookie, cartId, buyer } = await buyerCart(
        [
          { variantId: v.shirtM.id, quantity: 2 },
          { variantId: v.kit.id, quantity: 1 },
        ],
        { couponCode: 'FLAT100' },
      );
      const quote = await http()
        .post('/api/v1/checkout/quote')
        .set('Cookie', cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(200);

      const placed = await place(
        cookie,
        key(),
        placeBody({ expectedTotal: quote.body.totals.total, notes: 'Leave at gate' }),
      ).expect(201);
      expect(placed.body).toEqual({
        orderNumber: expect.stringMatching(/^KTX-\d{6,}$/),
        status: 'PENDING_PAYMENT',
        paymentMethod: 'RAZORPAY',
        totals: quote.body.totals,
        reservedUntil: expect.any(String),
        razorpay: {
          keyId: 'rzp_fake',
          orderId: expect.stringMatching(/^order_fake_/),
          amount: quote.body.totals.total,
          currency: 'INR',
          name: 'Kritex',
          description: `Order ${placed.body.orderNumber}`,
          prefill: { name: ADDRESS.name, email: buyer.user.email, contact: '9876543210' },
        },
        bankTransfer: null,
      });
      const minutes = (new Date(placed.body.reservedUntil).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThanOrEqual(30);

      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 2 }),
      );
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 10, reserved: 1 }));
      const order = await prisma.order.findUniqueOrThrow({
        where: { number: placed.body.orderNumber },
        include: { items: { orderBy: { sku: 'asc' } } },
      });
      expect(order.items.map((i) => [i.sku, i.lineTotal, i.discount, i.netTotal])).toEqual([
        ['KTX-CS-M', 259800, expect.any(Number), expect.any(Number)],
        ['KTX-FK', 999900, expect.any(Number), expect.any(Number)],
      ]);
      expect(order.items.reduce((s, i) => s + i.discount, 0)).toBe(10000);
      for (const i of order.items) expect(i.netTotal).toBe(i.lineTotal - i.discount);
      expect(order.couponCode).toBe('FLAT100');
      expect(
        (await prisma.coupon.findUniqueOrThrow({ where: { code: 'FLAT100' } })).usedCount,
      ).toBe(1);

      const verified = await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_abc123',
          razorpay_signature: 'fake',
        })
        .expect(200);
      expect(verified.body).toEqual({
        orderNumber: placed.body.orderNumber,
        status: 'PAID',
        paid: true,
      });

      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 3, reserved: 0 }),
      );
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 9, reserved: 0 }));
      const movements = await prisma.inventoryMovement.findMany({
        where: { refId: order.id },
        orderBy: { delta: 'asc' },
      });
      expect(movements.map((m) => [m.reason, m.delta])).toEqual([
        ['ORDER', -2],
        ['ORDER', -1],
      ]);
      expect(await prisma.cartItem.count({ where: { cartId } })).toBe(0);
      expect(
        (await prisma.cart.findUniqueOrThrow({ where: { id: cartId } })).couponCode,
      ).toBeNull();
      const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment).toEqual(
        expect.objectContaining({ providerPaymentId: 'pay_fake_abc123', status: 'CAPTURED' }),
      );

      // Verify is idempotent (safe to poll).
      await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_abc123',
          razorpay_signature: 'fake',
        })
        .expect(200, verified.body);
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 3, reserved: 0 }),
      );
      const events = await prisma.orderEvent.findMany({
        where: { orderId: order.id, internal: false },
      });
      expect(events.map((e) => e.type).sort()).toEqual(['PAID', 'PLACED']);
    });

    it('Idempotency-Key: required; same key + body replays; a different body is 409', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const missing = await http()
        .post('/api/v1/checkout')
        .set('Cookie', cookie)
        .send(placeBody())
        .expect(400);
      expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const bad = await place(cookie, 'bad key!').expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_ERROR');

      const k = key();
      const first = await place(cookie, k).expect(201);
      const again = await place(cookie, k).expect(201);
      expect(again.body).toEqual(first.body);
      expect(await prisma.order.count()).toBe(1);
      expect(await prisma.payment.count()).toBe(1);
      expect(await variant(v.shirtM.id)).toEqual(expect.objectContaining({ reserved: 1 }));

      const reused = await place(cookie, k, placeBody({ phone: '9123456789' })).expect(409);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('409 PRICE_CHANGED when expectedTotal differs; nothing is reserved', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const res = await place(cookie, key(), placeBody({ expectedTotal: 1 })).expect(409);
      expect(res.body.error).toEqual(
        expect.objectContaining({
          code: 'PRICE_CHANGED',
          details: { expectedTotal: 1, total: 129900 },
        }),
      );
      expect(await variant(v.shirtM.id)).toEqual(expect.objectContaining({ reserved: 0 }));
      expect(await prisma.order.count()).toBe(0);
    });

    it('guest checkout needs email + phone; bank transfer is B2B only', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const res = await place(cookie, key(), { shippingAddress: ADDRESS } as never).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const bank = await place(cookie, key(), placeBody({ paymentMethod: 'BANK_TRANSFER' })).expect(
        403,
      );
      expect(bank.body.error.code).toBe('PAYMENT_METHOD_NOT_ALLOWED');
    });

    it('verify: 400 SIGNATURE_INVALID for a bad signature, 404 for an unknown order', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const placed = await place(cookie, key()).expect(201);
      const bad = await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_x',
          razorpay_signature: 'nope',
        })
        .expect(400);
      expect(bad.body.error.code).toBe('SIGNATURE_INVALID');
      await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: 'order_x',
          razorpay_payment_id: 'pay_fake_x',
          razorpay_signature: 'fake',
        })
        .expect(404);
    });

    it('pay_fake_fail… marks the payment FAILED; the order stays payable', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const placed = await place(cookie, key()).expect(201);
      const res = await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_fail_1',
          razorpay_signature: 'fake',
        })
        .expect(200);
      expect(res.body).toEqual({
        orderNumber: placed.body.orderNumber,
        status: 'PENDING_PAYMENT',
        paid: false,
      });
      expect(await prisma.payment.findFirstOrThrow()).toEqual(
        expect.objectContaining({ status: 'FAILED', providerPaymentId: 'pay_fake_fail_1' }),
      );
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 1 }),
      );

      // A later successful attempt on the same gateway order still pays it.
      const ok = await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_ok_2',
          razorpay_signature: 'fake',
        })
        .expect(200);
      expect(ok.body.status).toBe('PAID');
    });
  });

  describe('POST /webhooks/razorpay', () => {
    it('rejects a bad signature', async () => {
      const res = await http()
        .post('/api/v1/webhooks/razorpay')
        .set('Content-Type', 'application/json')
        .set('x-razorpay-signature', 'deadbeef')
        .send(JSON.stringify({ event: 'payment.captured' }))
        .expect(400);
      expect(res.body.error.code).toBe('SIGNATURE_INVALID');
    });

    it('payment.captured and refund.processed are idempotent under replay', async () => {
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 1 }]);
      const placed = await place(cookie, key()).expect(201);
      const captured = paymentCapturedEvent(placed.body.razorpay.orderId, 'pay_wh_1', 129900);

      await webhook(captured).expect(200, { received: true });
      await webhook(captured).expect(200, { received: true });
      await webhook({ event: 'order.paid', payload: {} }).expect(200, { received: true });

      const order = await prisma.order.findUniqueOrThrow({
        where: { number: placed.body.orderNumber },
      });
      expect(order.status).toBe('PAID');
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 4, reserved: 0 }),
      );
      expect(await prisma.inventoryMovement.count({ where: { refId: order.id } })).toBe(1);
      expect(await prisma.orderEvent.count({ where: { orderId: order.id, type: 'PAID' } })).toBe(1);

      // Verify after the webhook: same result, no double effects.
      await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: placed.body.razorpay.orderId,
          razorpay_payment_id: 'pay_wh_1',
          razorpay_signature: 'fake',
        })
        .expect(400); // the fake gateway only signs pay_fake_* ids
      expect(await prisma.payment.count()).toBe(1);

      // Refund issued on the Razorpay dashboard, delivered twice.
      const refund = refundProcessedEvent('rfnd_wh_1', 'pay_wh_1', 129900);
      await webhook(refund).expect(200);
      await webhook(refund).expect(200);
      expect(await prisma.refund.count()).toBe(1);
      expect(await prisma.refund.findFirstOrThrow()).toEqual(
        expect.objectContaining({
          status: 'PROCESSED',
          amount: 129900,
          providerRefundId: 'rfnd_wh_1',
        }),
      );
      expect((await prisma.payment.findFirstOrThrow()).status).toBe('REFUNDED');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
        'REFUNDED',
      );
    });
  });

  describe('reservation expiry (COM-11)', () => {
    it('cancels unpaid orders past reservedUntil, releasing stock and the coupon use', async () => {
      await prisma.coupon.create({ data: { code: 'SHIPFREE', type: 'FREE_SHIPPING' } });
      const { cookie } = await buyerCart([{ variantId: v.shirtM.id, quantity: 2 }], {
        couponCode: 'SHIPFREE',
      });
      const placed = await place(cookie, key()).expect(201);
      expect(
        (await prisma.coupon.findUniqueOrThrow({ where: { code: 'SHIPFREE' } })).usedCount,
      ).toBe(1);
      const job = app.get(ReservationExpiryJob);

      expect(await job.run(new Date())).toBe(0); // not expired yet
      expect(await job.run(new Date(Date.now() + 31 * 60_000))).toBe(1);

      const order = await prisma.order.findUniqueOrThrow({
        where: { number: placed.body.orderNumber },
        include: { events: true },
      });
      expect(order.status).toBe('CANCELLED');
      expect(order.reservedUntil).toBeNull();
      expect(order.events.map((e) => e.type)).toContain('CANCELLED');
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 0 }),
      );
      expect(
        (await prisma.coupon.findUniqueOrThrow({ where: { code: 'SHIPFREE' } })).usedCount,
      ).toBe(0);
      expect(await job.run(new Date(Date.now() + 60 * 60_000))).toBe(0);

      // A payment captured after expiry is recorded and refunded automatically.
      await webhook(
        paymentCapturedEvent(placed.body.razorpay.orderId, 'pay_late_1', order.total),
      ).expect(200);
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.status).toBe('CANCELLED');
      expect(await prisma.refund.findFirstOrThrow()).toEqual(
        expect.objectContaining({ status: 'PROCESSED', amount: order.total }),
      );
      expect((await prisma.payment.findFirstOrThrow()).status).toBe('REFUNDED');
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 0 }),
      );
    });
  });

  describe('concurrency (COM-15)', () => {
    it('two buyers race for the last unit: exactly one order succeeds', async () => {
      const a = await buyerCart([{ variantId: v.shirtL.id, quantity: 1 }]);
      const b = await buyerCart([{ variantId: v.shirtL.id, quantity: 1 }]);

      const results = await Promise.all([place(a.cookie, key()), place(b.cookie, key())]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.error).toEqual(
        expect.objectContaining({ code: 'OUT_OF_STOCK', details: { variantIds: [v.shirtL.id] } }),
      );
      expect(await variant(v.shirtL.id)).toEqual(
        expect.objectContaining({ stock: 1, reserved: 1 }),
      );
      expect(await prisma.order.count()).toBe(1);
    });

    it('many concurrent buyers never oversell', async () => {
      const carts = await Promise.all(
        Array.from({ length: 8 }, () => buyerCart([{ variantId: v.shirtM.id, quantity: 2 }])),
      );
      const results = await Promise.all(carts.map((c) => place(c.cookie, key())));
      const ok = results.filter((r) => r.status === 201).length;
      expect(ok).toBe(2); // stock 5 → two orders of 2
      expect(results.filter((r) => r.status === 409)).toHaveLength(6);
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 5, reserved: 4 }),
      );
    });
  });
});
