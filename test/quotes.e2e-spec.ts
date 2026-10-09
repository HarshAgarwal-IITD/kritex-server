import { BANK } from './b2b-env';
import { type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ReservationExpiryJob } from '../src/orders/reservation-expiry.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { QuoteExpiryJob } from '../src/quotes/quote-expiry.job';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { createB2BUser, GSTIN_MH } from './b2b-fixtures';
import { ADDRESS, seedCheckoutCatalog } from './checkout-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const DAY = 86_400_000;

describe('Quotes (e2e): RFQ, admin respond/reject, accept → order, expiry, IDOR', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let staff: { cookie: string };
  let events: { name: string; payload: Record<string, unknown> }[];
  let keyN = 0;
  const key = () => `quote-key-${Date.now()}-${++keyN}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    const emitter = app.get(EventEmitter2);
    for (const name of ['quote.requested', 'quote.responded', 'quote.accepted']) {
      emitter.on(name, (payload: Record<string, unknown>) => {
        events.push({ name, payload });
      });
    }
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
    v = await seedCheckoutCatalog(prisma);
    staff = await signInAsStaff(app);
    events = [];
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const asStaff = (method: 'get' | 'post', url: string) =>
    http()[method](`/api/v1${url}`).set('Cookie', staff.cookie).set('Origin', TEST_ORIGIN);
  const as = (cookie: string, method: 'get' | 'post', url: string) =>
    http()[method](`/api/v1${url}`).set('Cookie', cookie).set('Origin', TEST_ORIGIN);
  const variant = (id: string) => prisma.variant.findUniqueOrThrow({ where: { id } });
  const productOf = async (variantId: string) => (await variant(variantId)).productId;

  /** RFQ: 3 × field kit, 2 × helmet (ENQUIRY_ONLY), shirt with no variant chosen. */
  async function rfqBody(extra: Record<string, unknown> = {}) {
    return {
      contactName: 'Major R. Singh',
      email: 'Procurement@Example.com',
      phone: '9876543210',
      organization: 'Acme Defence Supplies',
      gstin: GSTIN_MH,
      notes: 'Delivery to Pune depot',
      items: [
        { productId: await productOf(v.kit.id), variantId: v.kit.id, quantity: 3 },
        { productId: await productOf(v.helmet.id), variantId: v.helmet.id, quantity: 2 },
        { productId: await productOf(v.shirtM.id), quantity: 2, notes: 'Size M please' },
      ],
      ...extra,
    };
  }

  async function createRfq(cookie = '', extra: Record<string, unknown> = {}) {
    const req = http().post('/api/v1/quotes');
    if (cookie) void req.set('Cookie', cookie).set('Origin', TEST_ORIGIN);
    const res = await req.send(await rfqBody(extra)).expect(201);
    return prisma.quote.findUniqueOrThrow({
      where: { number: res.body.number },
      include: { items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
  }

  /** Staff prices all three lines (pins shirt M), valid for 7 days. */
  function respond(
    quote: { id: string; items: { id: string }[] },
    validUntil = new Date(Date.now() + 7 * DAY),
  ) {
    const [kit, helmet, shirt] = quote.items;
    return asStaff('post', `/admin/quotes/${quote.id}/respond`).send({
      items: [
        { itemId: kit.id, quotedUnitPrice: 800000 },
        { itemId: helmet.id, quotedUnitPrice: 400000 },
        { itemId: shirt.id, quotedUnitPrice: 100000, variantId: v.shirtM.id },
      ],
      validUntil: validUntil.toISOString(),
      message: 'Bulk pricing as discussed',
    });
  }

  const acceptBody = (extra: Record<string, unknown> = {}) => ({
    paymentMethod: 'RAZORPAY',
    shippingAddress: ADDRESS,
    ...extra,
  });
  const accept = (cookie: string, number: string, idemKey: string, body = acceptBody()) =>
    as(cookie, 'post', `/me/quotes/${number}/accept`).set('Idempotency-Key', idemKey).send(body);

  // ---------------------------------------------------------------- RFQ

  describe('POST /quotes', () => {
    it('guest RFQ (incl. ENQUIRY_ONLY and variant-less lines) → REQUESTED, KTQ number, event', async () => {
      const res = await http()
        .post('/api/v1/quotes')
        .send(await rfqBody())
        .expect(201);
      expect(res.body).toEqual({
        number: expect.stringMatching(/^KTQ-\d{6,}$/),
        status: 'REQUESTED',
        createdAt: expect.any(String),
      });
      const quote = await prisma.quote.findUniqueOrThrow({
        where: { number: res.body.number },
        include: { items: true },
      });
      expect(quote).toEqual(
        expect.objectContaining({
          userId: null,
          email: 'procurement@example.com',
          gstin: GSTIN_MH,
          status: 'REQUESTED',
        }),
      );
      expect(quote.items).toHaveLength(3);
      expect(quote.items.find((i) => i.variantId === null)?.requestedNotes).toBe('Size M please');
      expect(events).toEqual([
        {
          name: 'quote.requested',
          payload: expect.objectContaining({
            quoteId: quote.id,
            number: res.body.number,
            userId: null,
            email: 'procurement@example.com',
          }),
        },
      ]);
      // Numbers are sequential.
      const second = await http()
        .post('/api/v1/quotes')
        .send(await rfqBody())
        .expect(201);
      const seq = (n: string) => Number(n.slice(4));
      expect(seq(second.body.number)).toBe(seq(res.body.number) + 1);
    });

    it('signed-in RFQ is linked to the user', async () => {
      const { user, cookie } = await createSignedInUser(app);
      const quote = await createRfq(cookie);
      expect(quote.userId).toBe(user.id);
    });

    it('honeypot gets a fake 201 and stores nothing', async () => {
      const res = await http()
        .post('/api/v1/quotes')
        .send(await rfqBody({ website: 'http://spam' }))
        .expect(201);
      expect(res.body.status).toBe('REQUESTED');
      expect(await prisma.quote.count()).toBe(0);
      expect(events).toEqual([]);
    });

    it('404 for an unknown product or a variant of another product; 422 bad GSTIN checksum', async () => {
      const unknown = await http()
        .post('/api/v1/quotes')
        .send(await rfqBody({ items: [{ productId: 'nope', quantity: 1 }] }))
        .expect(404);
      expect(unknown.body.error.code).toBe('NOT_FOUND');
      await http()
        .post('/api/v1/quotes')
        .send(
          await rfqBody({
            items: [{ productId: await productOf(v.kit.id), variantId: v.shirtM.id, quantity: 1 }],
          }),
        )
        .expect(404);
      const gstin = await http()
        .post('/api/v1/quotes')
        .send(await rfqBody({ gstin: '27AAPFU0939F1ZA' }))
        .expect(422);
      expect(gstin.body.error.code).toBe('INVALID_GSTIN');
      const invalid = await http()
        .post('/api/v1/quotes')
        .send(await rfqBody({ items: [] }))
        .expect(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
      expect(await prisma.quote.count()).toBe(0);
    });
  });

  // ---------------------------------------------------------------- customer reads + IDOR

  describe('GET /me/quotes', () => {
    it('lists own quotes and verified-email matches; others are 404', async () => {
      const owner = await createSignedInUser(app);
      const own = await createRfq(owner.cookie);
      // A guest RFQ sent with the owner's (verified) email is theirs too.
      const byEmail = await createRfq('', { email: owner.user.email.toUpperCase() });
      const other = await createRfq();

      const list = await as(owner.cookie, 'get', '/me/quotes').expect(200);
      expect(list.body).toEqual({
        items: [
          expect.objectContaining({ number: byEmail.number, itemCount: 3, quotedTotal: null }),
          expect.objectContaining({ number: own.number, status: 'REQUESTED' }),
        ],
        page: 1,
        limit: 20,
        total: 2,
      });

      const detail = await as(owner.cookie, 'get', `/me/quotes/${own.number.toLowerCase()}`).expect(
        200,
      );
      expect(detail.body).toEqual(
        expect.objectContaining({
          number: own.number,
          status: 'REQUESTED',
          organization: 'Acme Defence Supplies',
          quotedTotal: null,
          responseMessage: null,
          orderNumber: null,
          items: expect.arrayContaining([
            expect.objectContaining({
              variantId: v.kit.id,
              productName: 'Field Kit',
              sku: 'KTX-FK',
              quantity: 3,
              quotedUnitPrice: null,
              lineTotal: null,
            }),
            expect.objectContaining({ variantId: null, variantTitle: null, sku: null }),
          ]),
        }),
      );

      const notMine = await as(owner.cookie, 'get', `/me/quotes/${other.number}`).expect(404);
      expect(notMine.body.error.code).toBe('NOT_FOUND');

      // Unverified email does not grant access.
      const unverified = await createSignedInUser(app);
      await prisma.user.update({
        where: { id: unverified.user.id },
        data: { emailVerified: false },
      });
      await createRfq('', { email: unverified.user.email });
      const none = await as(unverified.cookie, 'get', '/me/quotes').expect(200);
      expect(none.body.total).toBe(0);

      await http().get('/api/v1/me/quotes').expect(401);
    });
  });

  // ---------------------------------------------------------------- admin

  describe('admin', () => {
    it('lists/searches, responds (validation, re-respond), emits quote.responded', async () => {
      const quote = await createRfq();
      const customer = await createSignedInUser(app);
      await as(customer.cookie, 'get', '/admin/quotes').expect(403);

      const list = await asStaff('get', '/admin/quotes?q=acme&status=REQUESTED').expect(200);
      expect(list.body.items).toEqual([
        expect.objectContaining({
          id: quote.id,
          number: quote.number,
          email: 'procurement@example.com',
          contactName: 'Major R. Singh',
        }),
      ]);
      expect((await asStaff('get', '/admin/quotes?q=zzz').expect(200)).body.total).toBe(0);

      const [kit, helmet, shirt] = quote.items;
      const unpriced = await asStaff('post', `/admin/quotes/${quote.id}/respond`)
        .send({
          items: [
            { itemId: kit.id, quotedUnitPrice: 800000 },
            { itemId: helmet.id, quotedUnitPrice: 400000 },
            { itemId: shirt.id, quotedUnitPrice: 100000 }, // no variant pinned
          ],
          validUntil: new Date(Date.now() + DAY).toISOString(),
        })
        .expect(422);
      expect(unpriced.body.error).toEqual(
        expect.objectContaining({ code: 'QUOTE_ITEMS_UNPRICED', details: { itemIds: [shirt.id] } }),
      );
      const wrongVariant = await asStaff('post', `/admin/quotes/${quote.id}/respond`)
        .send({
          items: [
            { itemId: kit.id, quotedUnitPrice: 800000 },
            { itemId: helmet.id, quotedUnitPrice: 400000 },
            { itemId: shirt.id, quotedUnitPrice: 100000, variantId: v.kit.id },
          ],
          validUntil: new Date(Date.now() + DAY).toISOString(),
        })
        .expect(422);
      expect(wrongVariant.body.error.code).toBe('INVALID_VARIANT');
      const past = await respond(quote, new Date(Date.now() - 1000)).expect(400);
      expect(past.body.error.code).toBe('VALIDATION_ERROR');
      expect(events.filter((e) => e.name === 'quote.responded')).toEqual([]);

      const res = await respond(quote).expect(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          id: quote.id,
          status: 'QUOTED',
          quotedTotal: 3 * 800000 + 2 * 400000 + 2 * 100000,
          responseMessage: 'Bulk pricing as discussed',
          respondedAt: expect.any(String),
          validUntil: expect.any(String),
          orderId: null,
        }),
      );
      expect(res.body.items[2]).toEqual(
        expect.objectContaining({
          variantId: v.shirtM.id,
          variantTitle: 'M',
          quotedUnitPrice: 100000,
          lineTotal: 200000,
        }),
      );
      expect(events.at(-1)).toEqual({
        name: 'quote.responded',
        payload: expect.objectContaining({
          quoteId: quote.id,
          number: quote.number,
          quotedTotal: 3400000,
          validUntil: expect.any(String),
        }),
      });

      // Re-respond while QUOTED; message kept when omitted.
      const again = await asStaff('post', `/admin/quotes/${quote.id}/respond`)
        .send({
          items: [
            { itemId: kit.id, quotedUnitPrice: 750000 },
            { itemId: helmet.id, quotedUnitPrice: 400000 },
            { itemId: shirt.id, quotedUnitPrice: 100000 },
          ],
          validUntil: new Date(Date.now() + 3 * DAY).toISOString(),
        })
        .expect(200);
      expect(again.body.quotedTotal).toBe(3 * 750000 + 800000 + 200000);
      expect(again.body.responseMessage).toBe('Bulk pricing as discussed');

      const detail = await asStaff('get', `/admin/quotes/${quote.id}`).expect(200);
      expect(detail.body.status).toBe('QUOTED');
      await asStaff('get', '/admin/quotes/nope').expect(404);
    });

    it('reject: open quotes only; reason shown to the customer', async () => {
      const owner = await createSignedInUser(app);
      const quote = await createRfq(owner.cookie);
      const res = await asStaff('post', `/admin/quotes/${quote.id}/reject`)
        .send({ reason: 'Item not available for civilian sale' })
        .expect(200);
      expect(res.body.status).toBe('REJECTED');
      const mine = await as(owner.cookie, 'get', `/me/quotes/${quote.number}`).expect(200);
      expect(mine.body.responseMessage).toBe('Item not available for civilian sale');
      const again = await asStaff('post', `/admin/quotes/${quote.id}/reject`)
        .send({ reason: 'x' })
        .expect(409);
      expect(again.body.error.code).toBe('INVALID_STATUS');
      expect((await respond(quote).expect(409)).body.error.code).toBe('INVALID_STATUS');
    });
  });

  // ---------------------------------------------------------------- accept

  describe('POST /me/quotes/:number/accept', () => {
    it('Razorpay: order at the quoted prices, stock reserved, CONVERTED, idempotent, paid via fake gateway', async () => {
      const owner = await createSignedInUser(app);
      const quote = await createRfq(owner.cookie);
      await respond(quote).expect(200);

      const missingKey = await as(owner.cookie, 'post', `/me/quotes/${quote.number}/accept`)
        .send(acceptBody())
        .expect(400);
      expect(missingKey.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const k = key();
      const body = acceptBody({ poNumber: 'PO-7781' });
      const res = await accept(owner.cookie, quote.number, k, body).expect(201);
      expect(res.body).toEqual({
        orderNumber: expect.stringMatching(/^KTX-\d+$/),
        status: 'PENDING_PAYMENT',
        paymentMethod: 'RAZORPAY',
        totals: expect.objectContaining({
          subtotal: 3400000,
          discount: 0,
          shipping: 0, // over the free-shipping threshold
          total: 3400000,
          currency: 'INR',
        }),
        reservedUntil: expect.any(String),
        razorpay: expect.objectContaining({
          keyId: 'rzp_fake',
          orderId: expect.stringMatching(/^order_fake_/),
          amount: 3400000,
        }),
        bankTransfer: null,
      });

      const order = await prisma.order.findUniqueOrThrow({
        where: { number: res.body.orderNumber },
        include: { items: true, events: true },
      });
      expect(order).toEqual(
        expect.objectContaining({
          userId: owner.user.id,
          email: owner.user.email,
          quoteId: quote.id,
          gstin: GSTIN_MH, // from the RFQ
          businessName: 'Acme Defence Supplies',
          phone: '9876543210',
        }),
      );
      expect(order.items.map((i) => [i.sku, i.unitPrice, i.quantity])).toEqual([
        ['KTX-FK', 800000, 3],
        ['KTX-TH', 400000, 2],
        ['KTX-CS-M', 100000, 2],
      ]);
      expect(order.events.map((e) => e.message)).toEqual(
        expect.arrayContaining([`Order placed from quote ${quote.number}`, 'Customer PO: PO-7781']),
      );
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 10, reserved: 3 }));
      expect(await variant(v.helmet.id)).toEqual(
        expect.objectContaining({ stock: 3, reserved: 2 }),
      );
      expect(events.at(-1)).toEqual({
        name: 'quote.accepted',
        payload: expect.objectContaining({
          quoteId: quote.id,
          orderId: order.id,
          orderNumber: order.number,
          paymentMethod: 'RAZORPAY',
        }),
      });

      // Same key + body → same response (no second order, no second event).
      const replay = await accept(owner.cookie, quote.number, k, body).expect(201);
      expect(replay.body).toEqual(res.body);
      expect(await prisma.order.count()).toBe(1);
      expect(events.filter((e) => e.name === 'quote.accepted')).toHaveLength(1);
      // Same key, different body → 409; new key → the quote is already converted.
      const reused = await accept(owner.cookie, quote.number, k, acceptBody()).expect(409);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
      const twice = await accept(owner.cookie, quote.number, key()).expect(409);
      expect(twice.body.error).toEqual(
        expect.objectContaining({
          code: 'QUOTE_NOT_ACCEPTABLE',
          details: { status: 'CONVERTED', orderNumber: order.number },
        }),
      );

      const detail = await as(owner.cookie, 'get', `/me/quotes/${quote.number}`).expect(200);
      expect(detail.body).toEqual(
        expect.objectContaining({ status: 'CONVERTED', orderNumber: order.number }),
      );
      const myOrder = await as(owner.cookie, 'get', `/me/orders/${order.number}`).expect(200);
      expect(myOrder.body.quoteNumber).toBe(quote.number);

      // Pay through the fake gateway → PAID, reservation becomes a sale.
      const verified = await http()
        .post('/api/v1/checkout/verify')
        .send({
          razorpay_order_id: res.body.razorpay.orderId,
          razorpay_payment_id: 'pay_fake_quote_1',
          razorpay_signature: 'fake',
        })
        .expect(200);
      expect(verified.body).toEqual({ orderNumber: order.number, status: 'PAID', paid: true });
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 7, reserved: 0 }));
      expect(await variant(v.shirtM.id)).toEqual(
        expect.objectContaining({ stock: 3, reserved: 0 }),
      );
    });

    it('a guest RFQ is accepted after signing up with the same (verified) email', async () => {
      const quote = await createRfq('', { email: 'buyer@example.com' });
      await respond(quote).expect(200);
      const buyer = await createSignedInUser(app, { email: 'buyer@example.com' });
      const res = await accept(buyer.cookie, quote.number, key()).expect(201);
      expect(res.body.status).toBe('PENDING_PAYMENT');
    });

    it('IDOR: another customer gets 404 and nothing is reserved', async () => {
      const owner = await createSignedInUser(app);
      const quote = await createRfq(owner.cookie);
      await respond(quote).expect(200);
      const intruder = await createSignedInUser(app);
      const res = await accept(intruder.cookie, quote.number, key()).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      await as(intruder.cookie, 'get', `/me/quotes/${quote.number}`).expect(404);
      expect(await prisma.order.count()).toBe(0);
      expect((await variant(v.kit.id)).reserved).toBe(0);
      await http()
        .post(`/api/v1/me/quotes/${quote.number}/accept`)
        .set('Idempotency-Key', key())
        .send(acceptBody())
        .expect(401);
    });

    it('not yet quoted / expired quotes cannot be accepted; the expiry job marks EXPIRED', async () => {
      const owner = await createSignedInUser(app);
      const quote = await createRfq(owner.cookie);
      const requested = await accept(owner.cookie, quote.number, key()).expect(409);
      expect(requested.body.error).toEqual(
        expect.objectContaining({ code: 'QUOTE_NOT_ACCEPTABLE', details: { status: 'REQUESTED' } }),
      );

      await respond(quote).expect(200);
      await prisma.quote.update({
        where: { id: quote.id },
        data: { validUntil: new Date(Date.now() - 1000) },
      });
      const expired = await accept(owner.cookie, quote.number, key()).expect(409);
      expect(expired.body.error).toEqual(
        expect.objectContaining({ code: 'QUOTE_NOT_ACCEPTABLE', details: { status: 'EXPIRED' } }),
      );
      expect(await prisma.order.count()).toBe(0);

      const job = app.get(QuoteExpiryJob);
      expect(await job.run()).toBe(1);
      expect(await job.run()).toBe(0);
      const detail = await as(owner.cookie, 'get', `/me/quotes/${quote.number}`).expect(200);
      expect(detail.body.status).toBe('EXPIRED');
      const again = await accept(owner.cookie, quote.number, key()).expect(409);
      expect(again.body.error.details).toEqual({ status: 'EXPIRED' });
    });

    it('OUT_OF_STOCK when stock is short; can be accepted again after the order lapses', async () => {
      const owner = await createSignedInUser(app);
      const quote = await createRfq(owner.cookie);
      await respond(quote).expect(200);

      await prisma.variant.update({ where: { id: v.helmet.id }, data: { stock: 1 } });
      const short = await accept(owner.cookie, quote.number, key()).expect(409);
      expect(short.body.error).toEqual(
        expect.objectContaining({ code: 'OUT_OF_STOCK', details: { variantIds: [v.helmet.id] } }),
      );
      expect((await variant(v.kit.id)).reserved).toBe(0);

      await prisma.variant.update({ where: { id: v.helmet.id }, data: { stock: 3 } });
      const first = await accept(owner.cookie, quote.number, key()).expect(201);
      // Payment window lapses → order cancelled, stock released, quote acceptable again.
      expect(await app.get(ReservationExpiryJob).run(new Date(Date.now() + 31 * 60_000))).toBe(1);
      expect((await variant(v.kit.id)).reserved).toBe(0);
      const second = await accept(owner.cookie, quote.number, key()).expect(201);
      expect(second.body.orderNumber).not.toBe(first.body.orderNumber);
      const detail = await as(owner.cookie, 'get', `/me/quotes/${quote.number}`).expect(200);
      expect(detail.body.orderNumber).toBe(second.body.orderNumber);
    });

    it('bank transfer: approved B2B only → AWAITING_PAYMENT; admin mark-paid → PAID', async () => {
      // Plain customer: bank transfer not offered.
      const customer = await createSignedInUser(app);
      const q1 = await createRfq(customer.cookie);
      await respond(q1).expect(200);
      const denied = await accept(
        customer.cookie,
        q1.number,
        key(),
        acceptBody({ paymentMethod: 'BANK_TRANSFER' }),
      ).expect(403);
      expect(denied.body.error.code).toBe('PAYMENT_METHOD_NOT_ALLOWED');

      // Pending B2B profile: still not offered.
      const pending = await createB2BUser(app, 'PENDING');
      const q2 = await createRfq(pending.cookie);
      await respond(q2).expect(200);
      await accept(
        pending.cookie,
        q2.number,
        key(),
        acceptBody({ paymentMethod: 'BANK_TRANSFER' }),
      ).expect(403);

      const b2b = await createB2BUser(app);
      const quote = await createRfq(b2b.cookie);
      await respond(quote).expect(200);
      const before = Date.now();
      const res = await accept(
        b2b.cookie,
        quote.number,
        key(),
        acceptBody({ paymentMethod: 'BANK_TRANSFER', businessName: 'Acme Defence Pvt Ltd' }),
      ).expect(201);
      expect(res.body).toEqual(
        expect.objectContaining({
          status: 'AWAITING_PAYMENT',
          paymentMethod: 'BANK_TRANSFER',
          razorpay: null,
          bankTransfer: { ...BANK, reference: res.body.orderNumber, amount: 3400000 },
        }),
      );
      // Held for BANK_TRANSFER_HOLD_DAYS (default 7).
      const held = new Date(res.body.reservedUntil).getTime() - before;
      expect(held).toBeGreaterThan(7 * DAY - 60_000);
      expect(held).toBeLessThan(7 * DAY + 60_000);
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 10, reserved: 3 }));

      const order = await prisma.order.findUniqueOrThrow({
        where: { number: res.body.orderNumber },
      });
      expect(order.businessName).toBe('Acme Defence Pvt Ltd');
      const paid = await asStaff('post', `/admin/orders/${order.id}/mark-paid`)
        .send({ reference: 'UTR998877' })
        .expect(200);
      expect(paid.body.status).toBe('PAID');
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 7, reserved: 0 }));
      expect(await variant(v.helmet.id)).toEqual(
        expect.objectContaining({ stock: 1, reserved: 0 }),
      );
    });

    it('GSTIN must match the billing state (override with gstin)', async () => {
      const owner = await createSignedInUser(app);
      const quote = await createRfq(owner.cookie);
      await respond(quote).expect(200);
      const ka = { ...ADDRESS, state: 'Karnataka', stateCode: '29', pincode: '560001' };
      const mismatch = await accept(
        owner.cookie,
        quote.number,
        key(),
        acceptBody({ shippingAddress: ka }),
      ).expect(422);
      expect(mismatch.body.error.code).toBe('GSTIN_STATE_MISMATCH');
      // Ship to Karnataka, bill to Maharashtra (the GSTIN's state) → IGST.
      const ok = await accept(
        owner.cookie,
        quote.number,
        key(),
        acceptBody({ shippingAddress: ka, billingAddress: ADDRESS }),
      ).expect(201);
      expect(ok.body.totals.igst).toBeGreaterThan(0);
      expect(ok.body.totals.cgst).toBe(0);
    });
  });
});
