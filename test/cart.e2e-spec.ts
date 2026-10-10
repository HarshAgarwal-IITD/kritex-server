import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { CartCleanupService } from '../src/cart/cart-cleanup.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { cookieHeader, createSignedInUser, TEST_ORIGIN } from './auth';
import { seedCatalog } from './catalog-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

/**
 * Cart (COM-1/2/5): guest cookie flow, signed-in flow, merge on sign-in, line issues, coupons, IDOR.
 * Fixture (test/catalog-fixtures.ts): Combat Shirt RETAIL 129900 (M/Olive: stock 5; L/Black: 159900,
 * stock 0; XL/Black inactive), Tactical Helmet ENQUIRY_ONLY, Jungle Boots B2B_ONLY (all reserved).
 */
describe('Cart (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let v: Record<'shirtM' | 'shirtL' | 'shirtXL' | 'helmet' | 'boots', string>;

  const http = () => request(app.getHttpServer());

  /** `kritex_cart=<token>` from a response, or undefined. */
  const guestCookie = (res: request.Response): string | undefined => {
    const all = res.headers['set-cookie'] as unknown as string[] | undefined;
    const raw = all?.find((c) => c.startsWith('kritex_cart='));
    return raw ? cookieHeader(raw) : undefined;
  };

  const add = (cookie: string | undefined, variantId: string, quantity?: number) => {
    const req = http().post('/api/v1/cart/items').set('Origin', TEST_ORIGIN);
    if (cookie) void req.set('Cookie', cookie);
    return req.send(quantity === undefined ? { variantId } : { variantId, quantity });
  };

  const getCart = (cookie?: string) => {
    const req = http().get('/api/v1/cart');
    if (cookie) void req.set('Cookie', cookie);
    return req;
  };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    resetThrottler(app);
    await resetDatabase(prisma);
    await seedCatalog(prisma);
    const sku = async (s: string) =>
      (await prisma.variant.findUniqueOrThrow({ where: { sku: s } })).id;
    v = {
      shirtM: await sku('KTX-CS-M-OLIVEGREEN'),
      shirtL: await sku('KTX-CS-L-BLACK'),
      shirtXL: await sku('KTX-CS-XL-BLACK'),
      helmet: await sku('KTX-TH'),
      boots: await sku('KTX-JB-9'),
    };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('guest', () => {
    it('GET without a cart returns an empty cart and sets no cookie', async () => {
      const res = await getCart().expect(200);
      expect(res.body).toEqual({
        id: '',
        items: [],
        itemCount: 0,
        coupon: null,
        totals: {
          subtotal: 0,
          discount: 0,
          shipping: 0,
          taxTotal: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          total: 0,
          currency: 'INR',
        },
        hasIssues: false,
        updatedAt: expect.any(String),
      });
      expect(guestCookie(res)).toBeUndefined();
    });

    it('first add creates a guest cart with an httpOnly SameSite=Lax cookie; later calls use it', async () => {
      const res = await add(undefined, v.shirtM, 2).expect(200);
      const setCookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('kritex_cart='),
      );
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);
      expect(setCookie).toMatch(/Path=\//);
      expect(setCookie).not.toMatch(/Secure/i); // only in production
      const cookie = guestCookie(res)!;
      expect(cookie).toMatch(/^kritex_cart=[A-Za-z0-9_-]{43}$/);

      expect(res.body).toMatchObject({
        id: expect.any(String),
        itemCount: 2,
        hasIssues: false,
        coupon: null,
        items: [
          {
            variantId: v.shirtM,
            productSlug: 'combat-shirt',
            productName: 'Combat Shirt',
            variantTitle: 'M / Olive Green',
            sku: 'KTX-CS-M-OLIVEGREEN',
            options: { Size: 'M', Colour: 'Olive Green' },
            image: { url: '/assets/shirt-1.jpg', alt: 'Front' }, // colour-linked image
            saleChannel: 'RETAIL',
            unitPrice: 129900,
            quantity: 2,
            lineTotal: 259800,
            inStock: true,
            issue: null,
          },
        ],
      });
      // 259800 >= free-shipping threshold (99900): no shipping; intra-state preview.
      expect(res.body.totals).toMatchObject({
        subtotal: 259800,
        discount: 0,
        shipping: 0,
        total: 259800,
        igst: 0,
      });
      expect(res.body.totals.cgst + res.body.totals.sgst).toBe(res.body.totals.taxTotal);

      // POST adds to the existing quantity.
      const again = await add(cookie, v.shirtM, 1).expect(200);
      expect(again.body.items[0].quantity).toBe(3);
      expect(again.body.id).toBe(res.body.id);

      // PATCH sets the quantity; 0 removes the line.
      const patched = await http()
        .patch(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', cookie)
        .send({ quantity: 1 })
        .expect(200);
      expect(patched.body).toMatchObject({ itemCount: 1, items: [{ quantity: 1 }] });
      expect(patched.body.totals).toMatchObject({ subtotal: 129900, shipping: 0 }); // >= free threshold

      const removed = await http()
        .patch(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', cookie)
        .send({ quantity: 0 })
        .expect(200);
      expect(removed.body).toMatchObject({ items: [], itemCount: 0 });

      await http().delete(`/api/v1/cart/items/${v.shirtM}`).set('Cookie', cookie).expect(404);
      await add(cookie, v.shirtM, 1).expect(200);
      const deleted = await http()
        .delete(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', cookie)
        .expect(200);
      expect(deleted.body.items).toEqual([]);
    });

    it('a forged or unknown guest token is never adopted: a new token is issued', async () => {
      const forged = `kritex_cart=${'a'.repeat(43)}`;
      const get = await getCart(forged).expect(200);
      expect(get.body.items).toEqual([]);
      expect((get.headers['set-cookie'] as unknown as string[])[0]).toMatch(/^kritex_cart=;/);

      const res = await add(forged, v.shirtM).expect(200);
      const cookie = guestCookie(res)!;
      expect(cookie).not.toBe(forged);
      expect(await prisma.cart.count({ where: { guestToken: 'a'.repeat(43) } })).toBe(0);
    });

    it('rejects add for unknown/inactive variants, non-purchasable products, stock and limits', async () => {
      const notFound = await add(undefined, 'clx0000000000000000000000').expect(404);
      expect(notFound.body.error.code).toBe('NOT_FOUND');
      await add(undefined, v.shirtXL).expect(404); // inactive variant

      const enquiry = await add(undefined, v.helmet).expect(422);
      expect(enquiry.body.error.code).toBe('NOT_PURCHASABLE');
      const b2b = await add(undefined, v.boots).expect(422);
      expect(b2b.body.error.code).toBe('NOT_PURCHASABLE');

      const out = await add(undefined, v.shirtL).expect(409);
      expect(out.body.error).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { available: 0, requested: 1 },
      });
      const tooMany = await add(undefined, v.shirtM, 6).expect(409);
      expect(tooMany.body.error.details).toMatchObject({ available: 5 });

      const invalid = await add(undefined, v.shirtM, 1000).expect(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

      // RL-2: retail customers may have at most 10 of an item (B2B: 999).
      await prisma.variant.update({ where: { id: v.shirtM }, data: { stock: 2000 } });
      const res = await add(undefined, v.shirtM, 10).expect(200);
      const limit = await add(guestCookie(res), v.shirtM, 1).expect(422);
      expect(limit.body.error).toEqual(
        expect.objectContaining({
          code: 'QUANTITY_LIMIT_EXCEEDED',
          details: { variantId: v.shirtM, max: 10 },
        }),
      );
      expect(await prisma.cartItem.count()).toBe(1); // no cart rows from failed adds
    });

    it('refuses guest-cookie writes from a foreign Origin (403 INVALID_ORIGIN)', async () => {
      const cookie = guestCookie(await add(undefined, v.shirtM).expect(200))!;
      const res = await http()
        .post('/api/v1/cart/items')
        .set('Cookie', cookie)
        .set('Origin', 'https://evil.example')
        .send({ variantId: v.shirtM })
        .expect(403);
      expect(res.body.error.code).toBe('INVALID_ORIGIN');
    });
  });

  describe('line issues (computed on every read)', () => {
    it('flags stock, availability and sale-channel changes; issue lines leave the totals', async () => {
      const res = await add(undefined, v.shirtM, 3).expect(200);
      const cookie = guestCookie(res)!;
      // A second, healthy line so totals stay non-zero.
      await prisma.variant.update({ where: { id: v.shirtL }, data: { stock: 10 } });
      await add(cookie, v.shirtL, 1).expect(200);

      const line = async () => {
        const cart = (await getCart(cookie).expect(200)).body as {
          items: { variantId: string; issue: string | null }[];
          totals: { subtotal: number };
          hasIssues: boolean;
          itemCount: number;
        };
        return { cart, m: cart.items.find((i) => i.variantId === v.shirtM)! };
      };

      await prisma.variant.update({ where: { id: v.shirtM }, data: { stock: 2 } });
      let { cart, m } = await line();
      expect(m).toMatchObject({ issue: 'INSUFFICIENT_STOCK', inStock: true, quantity: 3 });
      expect(cart.hasIssues).toBe(true);
      expect(cart.totals.subtotal).toBe(159900); // only the L line
      expect(cart.itemCount).toBe(4);

      await prisma.variant.update({ where: { id: v.shirtM }, data: { stock: 3, reserved: 3 } });
      ({ m } = await line());
      expect(m).toMatchObject({ issue: 'OUT_OF_STOCK', inStock: false });

      await prisma.variant.update({
        where: { id: v.shirtM },
        data: { stock: 5, reserved: 0, isActive: false },
      });
      ({ m } = await line());
      expect(m.issue).toBe('UNAVAILABLE');

      await prisma.variant.update({ where: { id: v.shirtM }, data: { isActive: true } });
      const shirt = await prisma.variant.findUniqueOrThrow({ where: { id: v.shirtM } });
      await prisma.product.update({
        where: { id: shirt.productId },
        data: { saleChannel: 'ENQUIRY_ONLY' },
      });
      ({ cart, m } = await line());
      expect(m).toMatchObject({ issue: 'NOT_PURCHASABLE', unitPrice: 0, lineTotal: 0 });
      expect(cart.totals.subtotal).toBe(0);

      await prisma.product.update({
        where: { id: shirt.productId },
        data: { saleChannel: 'RETAIL' },
      });
      await prisma.variant.update({ where: { id: v.shirtM }, data: { stock: 2 } });
      // Lowering a quantity always works and clears the issue.
      const fixed = await http()
        .patch(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', cookie)
        .send({ quantity: 2 })
        .expect(200);
      expect(fixed.body.hasIssues).toBe(false);
      // Raising beyond stock is refused.
      await http()
        .patch(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', cookie)
        .send({ quantity: 3 })
        .expect(409);
    });
  });

  describe('coupons', () => {
    const coupon = (data: Partial<Parameters<PrismaService['coupon']['create']>[0]['data']>) =>
      prisma.coupon.create({
        data: { code: 'SAVE10', type: 'PERCENT', value: 10, ...data },
      });

    it('applies (case-insensitive), previews the discount, and removes', async () => {
      await coupon({});
      const cookie = guestCookie(await add(undefined, v.shirtM, 1).expect(200))!;
      const applied = await http()
        .post('/api/v1/cart/coupon')
        .set('Cookie', cookie)
        .set('Origin', TEST_ORIGIN)
        .send({ code: ' save10 ' })
        .expect(200);
      expect(applied.body.coupon).toEqual({
        code: 'SAVE10',
        type: 'PERCENT',
        valid: true,
        invalidReason: null,
        message: null,
      });
      expect(applied.body.totals).toMatchObject({ subtotal: 129900, discount: 12990 });

      const removed = await http().delete('/api/v1/cart/coupon').set('Cookie', cookie).expect(200);
      expect(removed.body.coupon).toBeNull();
      expect(removed.body.totals.discount).toBe(0);
    });

    it('422 with the COUPON_* code when the coupon does not apply', async () => {
      await coupon({ code: 'BIG', minSubtotal: 500000 });
      await coupon({ code: 'ONCE', perUserLimit: 1 });
      await coupon({ code: 'OFF', isActive: false });
      await coupon({ code: 'OLD', endsAt: new Date('2020-01-01T00:00:00Z') });
      const cookie = guestCookie(await add(undefined, v.shirtM, 1).expect(200))!;
      const apply = (code: string) =>
        http().post('/api/v1/cart/coupon').set('Cookie', cookie).send({ code }).expect(422);

      expect((await apply('NOPE')).body.error.code).toBe('COUPON_NOT_FOUND');
      expect((await apply('BIG')).body.error).toMatchObject({
        code: 'COUPON_MIN_SUBTOTAL_NOT_MET',
        details: { minSubtotal: 500000, shortBy: 500000 - 129900 },
      });
      expect((await apply('ONCE')).body.error.code).toBe('COUPON_LOGIN_REQUIRED');
      expect((await apply('OFF')).body.error.code).toBe('COUPON_INACTIVE');
      expect((await apply('OLD')).body.error.code).toBe('COUPON_EXPIRED');
      expect((await getCart(cookie).expect(200)).body.coupon).toBeNull();
    });

    it('a stored coupon that stops applying is reported as invalid, without a discount', async () => {
      await coupon({ code: 'MIN2', minSubtotal: 200000 });
      const cookie = guestCookie(await add(undefined, v.shirtM, 2).expect(200))!;
      await http()
        .post('/api/v1/cart/coupon')
        .set('Cookie', cookie)
        .send({ code: 'MIN2' })
        .expect(200);
      const res = await http()
        .patch(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', cookie)
        .send({ quantity: 1 })
        .expect(200);
      expect(res.body.coupon).toMatchObject({
        code: 'MIN2',
        valid: false,
        invalidReason: 'COUPON_MIN_SUBTOTAL_NOT_MET',
        message: expect.any(String),
      });
      expect(res.body.totals.discount).toBe(0);

      // Deleted by an admin: dropped from the cart.
      await prisma.coupon.deleteMany({ where: { code: 'MIN2' } });
      expect((await getCart(cookie).expect(200)).body.coupon).toBeNull();
    });

    it("per-customer limits count the signed-in user's previous orders", async () => {
      await coupon({ code: 'ONCE', perUserLimit: 1 });
      const { user, cookie } = await createSignedInUser(app);
      await add(cookie, v.shirtM, 1).expect(200);
      await http()
        .post('/api/v1/cart/coupon')
        .set('Cookie', cookie)
        .send({ code: 'ONCE' })
        .expect(200);

      await prisma.order.create({
        data: {
          number: 'KTX-100001',
          userId: user.id,
          email: user.email,
          phone: '9876543210',
          paymentMethod: 'RAZORPAY',
          status: 'PAID',
          shippingAddress: {},
          billingAddress: {},
          subtotal: 1000,
          total: 1000,
          couponCode: 'ONCE',
        },
      });
      const res = await getCart(cookie).expect(200);
      expect(res.body.coupon).toMatchObject({
        valid: false,
        invalidReason: 'COUPON_PER_CUSTOMER_LIMIT_REACHED',
      });
    });
  });

  describe('signed-in', () => {
    it('uses the account cart (no guest cookie) and keeps carts private (IDOR)', async () => {
      const a = await createSignedInUser(app);
      const b = await createSignedInUser(app);

      const res = await add(a.cookie, v.shirtM, 2).expect(200);
      expect(guestCookie(res)).toBeUndefined();
      expect(await prisma.cart.findUnique({ where: { userId: a.user.id } })).not.toBeNull();
      expect((await getCart(a.cookie).expect(200)).body.itemCount).toBe(2);

      // B sees an empty cart and cannot touch A's lines.
      expect((await getCart(b.cookie).expect(200)).body.items).toEqual([]);
      await http()
        .patch(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', b.cookie)
        .set('Origin', TEST_ORIGIN)
        .send({ quantity: 5 })
        .expect(404);
      await http()
        .delete(`/api/v1/cart/items/${v.shirtM}`)
        .set('Cookie', b.cookie)
        .set('Origin', TEST_ORIGIN)
        .expect(404);
      // A guest with no cookie cannot either.
      await http().delete(`/api/v1/cart/items/${v.shirtM}`).expect(404);
      expect((await getCart(a.cookie).expect(200)).body.items[0].quantity).toBe(2);
    });

    it('session cookie writes from a foreign Origin are refused by the AuthGuard', async () => {
      const a = await createSignedInUser(app);
      await http()
        .post('/api/v1/cart/items')
        .set('Cookie', a.cookie)
        .set('Origin', 'https://evil.example')
        .send({ variantId: v.shirtM })
        .expect(403);
    });

    it('approved B2B customers can buy B2B_ONLY products', async () => {
      await prisma.variant.update({ where: { id: v.boots }, data: { stock: 10, reserved: 0 } });
      const retail = await createSignedInUser(app);
      await add(retail.cookie, v.boots).expect(422);

      const b2b = await createSignedInUser(app, { role: 'B2B_CUSTOMER' });
      await prisma.businessProfile.create({
        data: {
          userId: b2b.user.id,
          legalName: 'Acme Pvt Ltd',
          gstin: '27AAPFU0939F1ZV',
          status: 'APPROVED',
        },
      });
      const res = await add(b2b.cookie, v.boots, 2).expect(200);
      expect(res.body.items[0]).toMatchObject({
        saleChannel: 'B2B_ONLY',
        unitPrice: 450000,
        issue: null,
      });
    });
  });

  describe('merge guest cart on sign-in (COM-2)', () => {
    it('sums quantities (capped by stock), adopts a valid guest coupon, deletes the guest cart, clears the cookie', async () => {
      await prisma.coupon.create({ data: { code: 'SAVE10', type: 'PERCENT', value: 10 } });
      const guest = guestCookie(await add(undefined, v.shirtM, 3).expect(200))!;
      await http()
        .post('/api/v1/cart/coupon')
        .set('Cookie', guest)
        .send({ code: 'SAVE10' })
        .expect(200);
      const guestCartId = (await getCart(guest)).body.id;

      const { user, cookie } = await createSignedInUser(app);
      await add(cookie, v.shirtM, 4).expect(200);

      const res = await getCart(`${cookie}; ${guest}`).expect(200);
      expect(res.body.items).toEqual([
        expect.objectContaining({ variantId: v.shirtM, quantity: 5 }),
      ]);
      expect(res.body.coupon).toMatchObject({ code: 'SAVE10', valid: true });
      expect(res.body.id).not.toBe(guestCartId);
      const cleared = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('kritex_cart='),
      );
      expect(cleared).toMatch(/^kritex_cart=;/);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);

      expect(await prisma.cart.findUnique({ where: { id: guestCartId } })).toBeNull();
      expect(await prisma.cart.count({ where: { userId: user.id } })).toBe(1);

      // Replaying the old cookie is harmless.
      const replay = await getCart(`${cookie}; ${guest}`).expect(200);
      expect(replay.body.items[0].quantity).toBe(5);
    });

    it('creates the account cart from the guest cart and merges on a write too', async () => {
      const guest = guestCookie(await add(undefined, v.shirtM, 2).expect(200))!;
      const { user, cookie } = await createSignedInUser(app);
      const res = await add(`${cookie}; ${guest}`, v.shirtM, 1).expect(200);
      expect(res.body.items[0].quantity).toBe(3);
      expect(await prisma.cart.count()).toBe(1);
      expect((await prisma.cart.findFirstOrThrow()).userId).toBe(user.id);
    });

    it("keeps the user's coupon; drops a guest coupon that is not valid for the user", async () => {
      await prisma.coupon.create({
        data: { code: 'ONCE', type: 'FLAT', value: 1000, perUserLimit: 1 },
      });
      await prisma.coupon.create({ data: { code: 'MINE', type: 'FLAT', value: 500 } });
      await prisma.coupon.create({ data: { code: 'GUEST', type: 'FLAT', value: 700 } });

      // User already has a coupon: keep it.
      const guest1 = guestCookie(await add(undefined, v.shirtM, 1).expect(200))!;
      await http()
        .post('/api/v1/cart/coupon')
        .set('Cookie', guest1)
        .send({ code: 'GUEST' })
        .expect(200);
      const u1 = await createSignedInUser(app);
      await add(u1.cookie, v.shirtM, 1).expect(200);
      await http()
        .post('/api/v1/cart/coupon')
        .set('Cookie', u1.cookie)
        .send({ code: 'MINE' })
        .expect(200);
      expect((await getCart(`${u1.cookie}; ${guest1}`)).body.coupon.code).toBe('MINE');

      // Guest coupon the user has already used up: dropped.
      const u2 = await createSignedInUser(app);
      await prisma.order.create({
        data: {
          number: 'KTX-100002',
          userId: u2.user.id,
          email: u2.user.email,
          phone: '9876543210',
          paymentMethod: 'RAZORPAY',
          status: 'DELIVERED',
          shippingAddress: {},
          billingAddress: {},
          subtotal: 1000,
          total: 1000,
          couponCode: 'ONCE',
        },
      });
      const guest2 = guestCookie(await add(undefined, v.shirtM, 1).expect(200))!;
      // Per-user coupons need a sign-in: apply it straight in the DB for the guest cart.
      await prisma.cart.updateMany({ where: { userId: null }, data: { couponCode: 'ONCE' } });
      const merged = await getCart(`${u2.cookie}; ${guest2}`).expect(200);
      expect(merged.body.coupon).toBeNull();
      expect(merged.body.items[0].quantity).toBe(1);
    });
  });

  it('removes guest carts older than the TTL (cleanup job)', async () => {
    await add(undefined, v.shirtM).expect(200);
    const { user } = await createSignedInUser(app);
    await prisma.cart.create({ data: { userId: user.id } });
    const cleanup = app.get(CartCleanupService);
    expect(await cleanup.purgeStaleGuestCarts(new Date())).toBe(0);
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await cleanup.purgeStaleGuestCarts(later)).toBe(1);
    expect(await prisma.cart.count()).toBe(1); // the user cart stays
  });
});
