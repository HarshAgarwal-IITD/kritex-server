import { randomBytes } from 'node:crypto';
import { BANK } from './b2b-env';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ReservationExpiryJob } from '../src/orders/reservation-expiry.job';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { createB2BUser } from './b2b-fixtures';
import { ADDRESS, createCart, seedCheckoutCatalog } from './checkout-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const DAY = 86_400_000;

/**
 * B2B-3 (tier pricing end to end) and B2B-4 (bank transfer) through the real HTTP stack.
 * Field kit: list ₹9,999; tiers 5+ → ₹9,000, 10+ → ₹8,500 (approved B2B only).
 */
describe('B2B (e2e): tier pricing in cart/checkout/orders, bank transfer + hold', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let keyN = 0;
  const key = () => `b2b-key-${Date.now()}-${++keyN}`;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
    v = await seedCheckoutCatalog(prisma);
    const kit = await prisma.variant.findUniqueOrThrow({ where: { id: v.kit.id } });
    await prisma.priceTier.createMany({
      data: [
        { productId: kit.productId, minQty: 5, unitPrice: 900000 },
        { productId: kit.productId, minQty: 10, unitPrice: 850000 },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());
  const variant = (id: string) => prisma.variant.findUniqueOrThrow({ where: { id } });
  const withCookie = (req: request.Test, cookie: string) =>
    cookie ? req.set('Cookie', cookie).set('Origin', TEST_ORIGIN) : req;

  /** cart → checkout quote → placed order, all for 5 × field kit. */
  async function flow(sessionCookie: string, userId?: string, paymentMethod = 'RAZORPAY') {
    const cart = await createCart(prisma, [{ variantId: v.kit.id, quantity: 5 }], { userId });
    let guestCookie = '';
    if (!userId) {
      // The cart API only accepts server-minted (43-char) guest tokens.
      const token = randomBytes(32).toString('base64url');
      await prisma.cart.update({ where: { id: cart.cartId }, data: { guestToken: token } });
      guestCookie = `kritex_cart=${token}`;
    }
    const cookie = [sessionCookie, guestCookie].filter(Boolean).join('; ');
    const cartRes = await withCookie(http().get('/api/v1/cart'), cookie).expect(200);
    const quote = await withCookie(http().post('/api/v1/checkout/quote'), cookie)
      .send({ shippingAddress: ADDRESS })
      .expect(200);
    const placed = await withCookie(http().post('/api/v1/checkout'), cookie)
      .set('Idempotency-Key', key())
      .send({
        email: 'buyer@example.com',
        phone: '9876543210',
        shippingAddress: ADDRESS,
        paymentMethod,
      })
      .expect(201);
    const order = await prisma.order.findUniqueOrThrow({
      where: { number: placed.body.orderNumber },
      include: { items: true },
    });
    return { cart: cartRes.body, quote: quote.body, placed: placed.body, order };
  }

  describe('B2B-3 tier pricing', () => {
    it('approved B2B: tier price in cart, checkout quote and the placed order', async () => {
      const b2b = await createB2BUser(app);
      const { cart, quote, placed, order } = await flow(b2b.cookie, b2b.user.id);
      expect(cart.items[0]).toEqual(
        expect.objectContaining({ unitPrice: 900000, lineTotal: 4500000 }),
      );
      expect(cart.totals.subtotal).toBe(4500000);
      expect(quote.items[0]).toEqual(
        expect.objectContaining({ unitPrice: 900000, lineTotal: 4500000 }),
      );
      expect(quote.totals).toEqual(expect.objectContaining({ subtotal: 4500000, total: 4500000 }));
      expect(quote.paymentMethods).toEqual(['RAZORPAY', 'BANK_TRANSFER']);
      expect(placed.totals.total).toBe(4500000);
      expect(placed.razorpay.amount).toBe(4500000);
      expect(order.items[0]).toEqual(expect.objectContaining({ unitPrice: 900000, quantity: 5 }));
    });

    it('higher tier at 10+ units (quantities summed per product)', async () => {
      const b2b = await createB2BUser(app);
      await createCart(prisma, [{ variantId: v.kit.id, quantity: 10 }], { userId: b2b.user.id });
      const quote = await withCookie(http().post('/api/v1/checkout/quote'), b2b.cookie)
        .send({ shippingAddress: ADDRESS })
        .expect(200);
      expect(quote.body.items[0].unitPrice).toBe(850000);
      expect(quote.body.totals.subtotal).toBe(8500000);
    });

    it.each([
      ['pending B2B profile', 'PENDING' as const],
      ['rejected B2B profile', 'REJECTED' as const],
    ])('%s pays list price and gets no bank transfer', async (_label, status) => {
      const b2b = await createB2BUser(app, status);
      const { cart, quote, order } = await flow(b2b.cookie, b2b.user.id);
      expect(cart.items[0].unitPrice).toBe(999900);
      expect(quote.totals.subtotal).toBe(4999500);
      expect(quote.paymentMethods).toEqual(['RAZORPAY']);
      expect(order.items[0].unitPrice).toBe(999900);
    });

    it('a retail customer pays list price (guests cannot check out, ADR-020)', async () => {
      const customer = await createSignedInUser(app);
      const signedIn = await flow(customer.cookie, customer.user.id);
      expect(signedIn.order.items[0].unitPrice).toBe(999900);
      expect(signedIn.order.total).toBe(4999500);
      expect(signedIn.quote.paymentMethods).toEqual(['RAZORPAY']);
    });
  });

  describe('B2B-4 bank transfer', () => {
    it('approved B2B only; AWAITING_PAYMENT with instructions; admin mark-paid → PAID', async () => {
      const customer = await createSignedInUser(app);
      await createCart(prisma, [{ variantId: v.kit.id, quantity: 1 }], {
        userId: customer.user.id,
      });
      const denied = await withCookie(http().post('/api/v1/checkout'), customer.cookie)
        .set('Idempotency-Key', key())
        .send({
          email: 'x@example.com',
          phone: '9876543210',
          shippingAddress: ADDRESS,
          paymentMethod: 'BANK_TRANSFER',
        })
        .expect(403);
      expect(denied.body.error.code).toBe('PAYMENT_METHOD_NOT_ALLOWED');

      const b2b = await createB2BUser(app);
      const before = Date.now();
      const { placed, order } = await flow(b2b.cookie, b2b.user.id, 'BANK_TRANSFER');
      expect(placed).toEqual(
        expect.objectContaining({
          status: 'AWAITING_PAYMENT',
          paymentMethod: 'BANK_TRANSFER',
          razorpay: null,
          bankTransfer: { ...BANK, reference: placed.orderNumber, amount: 4500000 },
        }),
      );
      const held = new Date(placed.reservedUntil).getTime() - before;
      expect(held).toBeGreaterThan(7 * DAY - 60_000);
      expect(held).toBeLessThan(7 * DAY + 60_000);
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 10, reserved: 5 }));
      expect(await prisma.payment.count()).toBe(0); // no gateway order

      const mine = await withCookie(
        http().get(`/api/v1/me/orders/${order.number}`),
        b2b.cookie,
      ).expect(200);
      expect(mine.body.status).toBe('AWAITING_PAYMENT');

      const staff = await signInAsStaff(app);
      const paid = await http()
        .post(`/api/v1/admin/orders/${order.id}/mark-paid`)
        .set('Cookie', staff.cookie)
        .set('Origin', TEST_ORIGIN)
        .send({ reference: 'UTR4455' })
        .expect(200);
      expect(paid.body.status).toBe('PAID');
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 5, reserved: 0 }));
      const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(after.reservedUntil).toBeNull();
      // The ordered lines left the cart.
      expect(await prisma.cartItem.count({ where: { cartId: order.cartId ?? '' } })).toBe(0);
      // Paid orders are never expired.
      expect(await app.get(ReservationExpiryJob).run(new Date(Date.now() + 30 * DAY))).toBe(0);
    });

    it('unpaid bank-transfer orders are cancelled after BANK_TRANSFER_HOLD_DAYS, releasing stock', async () => {
      const b2b = await createB2BUser(app);
      const { order } = await flow(b2b.cookie, b2b.user.id, 'BANK_TRANSFER');
      const job = app.get(ReservationExpiryJob);
      expect(await job.run(new Date(Date.now() + 6 * DAY))).toBe(0);
      expect(await job.run(new Date(Date.now() + 7 * DAY + 60_000))).toBe(1);
      const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(cancelled.status).toBe('CANCELLED');
      expect(await variant(v.kit.id)).toEqual(expect.objectContaining({ stock: 10, reserved: 0 }));

      const staff = await signInAsStaff(app);
      const late = await http()
        .post(`/api/v1/admin/orders/${order.id}/mark-paid`)
        .set('Cookie', staff.cookie)
        .set('Origin', TEST_ORIGIN)
        .send({ reference: 'UTR-late' })
        .expect(409);
      expect(late.body.error.code).toBe('INVALID_TRANSITION');
    });
  });
});
