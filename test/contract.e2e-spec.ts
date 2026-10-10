import { type INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types';
import { buildOpenApiDocument } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser } from './auth';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

/**
 * Stage 1 contract (ARCHITECTURE.md §4): every v1 operation exists with a stable operationId,
 * the right auth requirement, and a stub that answers 501 (or 400 for invalid input), never 404.
 */

type Method = 'get' | 'post' | 'patch' | 'delete';
type Access = 'public' | 'session';

// [operationId, method, path, access]
const OPERATIONS: [string, Method, string, Access][] = [
  // existing (Stage 0)
  ['getHealth', 'get', '/health', 'public'],
  ['getAuthOptions', 'get', '/auth-options', 'public'],
  ['createQuery', 'post', '/queries', 'session'],
  ['listQueries', 'get', '/queries', 'session'],
  // catalog
  ['listCategories', 'get', '/categories', 'public'],
  ['listProducts', 'get', '/products', 'public'],
  ['getProductBySlug', 'get', '/products/{slug}', 'public'],
  ['searchSuggest', 'get', '/search/suggest', 'public'],
  // account
  ['getMe', 'get', '/me', 'session'],
  ['updateMe', 'patch', '/me', 'session'],
  ['listMyAddresses', 'get', '/me/addresses', 'session'],
  ['createMyAddress', 'post', '/me/addresses', 'session'],
  ['updateMyAddress', 'patch', '/me/addresses/{id}', 'session'],
  ['deleteMyAddress', 'delete', '/me/addresses/{id}', 'session'],
  ['applyBusinessProfile', 'post', '/me/business-profile', 'session'],
  ['listMyOrders', 'get', '/me/orders', 'session'],
  ['getMyOrder', 'get', '/me/orders/{number}', 'session'],
  ['cancelMyOrder', 'post', '/me/orders/{number}/cancel', 'session'],
  ['requestOrderReturn', 'post', '/me/orders/{number}/return', 'session'],
  ['payMyOrder', 'post', '/me/orders/{number}/pay', 'session'],
  ['getOrderInvoice', 'get', '/orders/{number}/invoice', 'session'],
  ['downloadInvoiceFile', 'get', '/invoices/files/{file}', 'public'],
  // cart
  ['getCart', 'get', '/cart', 'public'],
  ['addCartItem', 'post', '/cart/items', 'public'],
  ['updateCartItem', 'patch', '/cart/items/{variantId}', 'public'],
  ['removeCartItem', 'delete', '/cart/items/{variantId}', 'public'],
  ['applyCartCoupon', 'post', '/cart/coupon', 'public'],
  ['removeCartCoupon', 'delete', '/cart/coupon', 'public'],
  // checkout & payments
  ['getCheckoutQuote', 'post', '/checkout/quote', 'session'],
  ['placeOrder', 'post', '/checkout', 'session'],
  ['verifyPayment', 'post', '/checkout/verify', 'public'],
  ['handleRazorpayWebhook', 'post', '/webhooks/razorpay', 'public'],
  ['handleShiprocketWebhook', 'post', '/webhooks/shiprocket', 'public'],
  ['getOrderTracking', 'get', '/orders/{number}/tracking', 'public'],
  // quotes
  ['createQuote', 'post', '/quotes', 'session'],
  ['listMyQuotes', 'get', '/me/quotes', 'session'],
  ['getMyQuote', 'get', '/me/quotes/{number}', 'session'],
  ['acceptMyQuote', 'post', '/me/quotes/{number}/accept', 'session'],
  // admin: dashboard
  ['adminGetDashboard', 'get', '/admin/dashboard', 'session'],
  // admin: catalog
  ['adminListProducts', 'get', '/admin/products', 'session'],
  ['adminCreateProduct', 'post', '/admin/products', 'session'],
  ['adminImportProducts', 'post', '/admin/products/import', 'session'],
  ['adminGetProduct', 'get', '/admin/products/{id}', 'session'],
  ['adminUpdateProduct', 'patch', '/admin/products/{id}', 'session'],
  ['adminDeleteProduct', 'delete', '/admin/products/{id}', 'session'],
  ['adminListVariants', 'get', '/admin/products/{id}/variants', 'session'],
  ['adminGenerateVariants', 'post', '/admin/products/{id}/variants', 'session'],
  ['adminUpdateVariant', 'patch', '/admin/variants/{id}', 'session'],
  ['adminAdjustStock', 'patch', '/admin/variants/{id}/stock', 'session'],
  ['adminListInventory', 'get', '/admin/inventory', 'session'],
  ['adminListCategories', 'get', '/admin/categories', 'session'],
  ['adminCreateCategory', 'post', '/admin/categories', 'session'],
  ['adminUpdateCategory', 'patch', '/admin/categories/{id}', 'session'],
  ['adminDeleteCategory', 'delete', '/admin/categories/{id}', 'session'],
  ['adminCreateUpload', 'post', '/admin/uploads', 'session'],
  // admin: orders & shipping
  ['adminListOrders', 'get', '/admin/orders', 'session'],
  ['adminExportOrders', 'get', '/admin/orders/export.csv', 'session'],
  ['adminGetOrder', 'get', '/admin/orders/{id}', 'session'],
  ['adminUpdateOrderStatus', 'post', '/admin/orders/{id}/status', 'session'],
  ['adminShipOrder', 'post', '/admin/orders/{id}/ship', 'session'],
  ['adminCancelOrder', 'post', '/admin/orders/{id}/cancel', 'session'],
  ['adminRefundOrder', 'post', '/admin/orders/{id}/refund', 'session'],
  ['adminMarkOrderPaid', 'post', '/admin/orders/{id}/mark-paid', 'session'],
  ['adminAddOrderNote', 'post', '/admin/orders/{id}/note', 'session'],
  ['adminCreateShiprocketShipment', 'post', '/admin/orders/{id}/shiprocket', 'session'],
  ['adminGenerateShipmentLabel', 'post', '/admin/shipments/{id}/label', 'session'],
  ['adminRequestShipmentPickup', 'post', '/admin/shipments/{id}/pickup', 'session'],
  // admin: quotes
  ['adminListQuotes', 'get', '/admin/quotes', 'session'],
  ['adminGetQuote', 'get', '/admin/quotes/{id}', 'session'],
  ['adminRespondQuote', 'post', '/admin/quotes/{id}/respond', 'session'],
  ['adminRejectQuote', 'post', '/admin/quotes/{id}/reject', 'session'],
  // admin: customers & B2B
  ['adminListCustomers', 'get', '/admin/customers', 'session'],
  ['adminGetCustomer', 'get', '/admin/customers/{id}', 'session'],
  ['adminListBusinessProfiles', 'get', '/admin/business-profiles', 'session'],
  ['adminApproveBusinessProfile', 'post', '/admin/business-profiles/{id}/approve', 'session'],
  ['adminRejectBusinessProfile', 'post', '/admin/business-profiles/{id}/reject', 'session'],
  // admin: coupons
  ['adminListCoupons', 'get', '/admin/coupons', 'session'],
  ['adminCreateCoupon', 'post', '/admin/coupons', 'session'],
  ['adminGetCoupon', 'get', '/admin/coupons/{id}', 'session'],
  ['adminUpdateCoupon', 'patch', '/admin/coupons/{id}', 'session'],
  ['adminDeleteCoupon', 'delete', '/admin/coupons/{id}', 'session'],
  // admin: enquiries
  ['adminListQueries', 'get', '/admin/queries', 'session'],
  ['adminUpdateQuery', 'patch', '/admin/queries/{id}', 'session'],
  // admin: users (ADMIN only)
  ['adminListUsers', 'get', '/admin/users', 'session'],
  ['adminCreateStaffUser', 'post', '/admin/users', 'session'],
  ['adminUpdateUser', 'patch', '/admin/users/{id}', 'session'],
];

const EXISTING = new Set(['getHealth', 'createQuery', 'listQueries']);

/** Implemented since Stage 1 (no longer stubs); covered by their own e2e specs. */
const IMPLEMENTED = new Set([
  // ADR-019 (test/google-auth.e2e-spec.ts)
  'getAuthOptions',
  // Stage 4: server-b2b (test/quotes.e2e-spec.ts, test/b2b.e2e-spec.ts)
  'createQuote',
  'listMyQuotes',
  'getMyQuote',
  'acceptMyQuote',
  'adminListQuotes',
  'adminGetQuote',
  'adminRespondQuote',
  'adminRejectQuote',
  // Stage 4: server-ops (test/invoices.e2e-spec.ts, test/shipping.e2e-spec.ts)
  'getOrderInvoice',
  'downloadInvoiceFile',
  'getOrderTracking',
  'handleShiprocketWebhook',
  'adminCreateShiprocketShipment',
  'adminGenerateShipmentLabel',
  'adminRequestShipmentPickup',
  // Stage 3: server-checkout (test/checkout*.e2e-spec.ts, test/orders*.e2e-spec.ts)
  'getCheckoutQuote',
  'placeOrder',
  'verifyPayment',
  'handleRazorpayWebhook',
  'listMyOrders',
  'getMyOrder',
  'cancelMyOrder',
  'requestOrderReturn',
  'payMyOrder',
  'adminListOrders',
  'adminExportOrders',
  'adminGetOrder',
  'adminUpdateOrderStatus',
  'adminShipOrder',
  'adminCancelOrder',
  'adminRefundOrder',
  'adminMarkOrderPaid',
  'adminAddOrderNote',
  'adminGetDashboard',
  // CAT-1..6 (test/catalog*.e2e-spec.ts). adminImportProducts is still a stub.
  'listCategories',
  'listProducts',
  'getProductBySlug',
  'searchSuggest',
  'adminListProducts',
  'adminCreateProduct',
  'adminGetProduct',
  'adminUpdateProduct',
  'adminDeleteProduct',
  'adminListVariants',
  'adminGenerateVariants',
  'adminUpdateVariant',
  'adminAdjustStock',
  'adminListInventory',
  'adminListCategories',
  'adminCreateCategory',
  'adminUpdateCategory',
  'adminDeleteCategory',
  'adminCreateUpload',
  // Stage 2: server-auth
  'getMe',
  'updateMe',
  'listMyAddresses',
  'createMyAddress',
  'updateMyAddress',
  'deleteMyAddress',
  'applyBusinessProfile',
  'adminListCustomers',
  'adminGetCustomer',
  'adminListBusinessProfiles',
  'adminApproveBusinessProfile',
  'adminRejectBusinessProfile',
  'adminListUsers',
  'adminCreateStaffUser',
  'adminUpdateUser',
  'adminListQueries',
  'adminUpdateQuery',
  // Stage 3: server-cart (test/cart.e2e-spec.ts, test/coupons-admin.e2e-spec.ts)
  'getCart',
  'addCartItem',
  'updateCartItem',
  'removeCartItem',
  'applyCartCoupon',
  'removeCartCoupon',
  'adminListCoupons',
  'adminCreateCoupon',
  'adminGetCoupon',
  'adminUpdateCoupon',
  'adminDeleteCoupon',
]);

const PATH_PARAMS: Record<string, string> = {
  id: 'clx0000000000000000000000',
  slug: 'combat-shirt',
  number: 'KTX-100001',
  variantId: 'clx0000000000000000000001',
};

/** Query strings for routes whose required query params would otherwise 400. */
const REQUIRED_QUERY: Record<string, Record<string, string>> = {
  searchSuggest: { q: 'shirt' },
  getOrderTracking: { email: 'a@b.co' },
};

const toUrl = (path: string) =>
  `/api/v1${path.replace(/\{(\w+)\}/g, (_m, name: string) => PATH_PARAMS[name])}`;

describe('API contract (e2e)', () => {
  let app: INestApplication<App>;
  let doc: OpenAPIObject;
  /** Session cookie of an ADMIN (allowed on every route). */
  let admin: string;

  beforeAll(async () => {
    app = await createTestApp();
    doc = buildOpenApiDocument(app);
    await resetDatabase(app.get(PrismaService));
    admin = (await createSignedInUser(app, { role: 'ADMIN' })).cookie;
  });

  beforeEach(() => resetThrottler(app));

  afterAll(async () => {
    await app.close();
  });

  const operation = (method: Method, path: string) => doc.paths[`/api/v1${path}`]?.[method];

  it('documents exactly the expected operations', () => {
    const actual = Object.values(doc.paths).flatMap((item) =>
      (['get', 'post', 'patch', 'put', 'delete'] as const)
        .map((m) => item[m]?.operationId)
        .filter((id): id is string => Boolean(id)),
    );
    expect(new Set(actual).size).toBe(actual.length); // unique
    expect([...actual].sort()).toEqual(OPERATIONS.map(([id]) => id).sort());
  });

  it.each(OPERATIONS)(
    '%s: %s %s has its operationId, a success response and the %s security',
    (operationId, method, path, access) => {
      const op = operation(method, path);
      expect(op?.operationId).toBe(operationId);
      expect(Object.keys(op?.responses ?? {}).some((status) => Number(status) < 300)).toBe(true);
      const security = op?.security ?? [];
      if (access === 'public') expect(security).toEqual([]);
      if (access === 'session') expect(security).toEqual([{ session: [] }]);
    },
  );

  it('registers the session cookie security scheme', () => {
    expect(doc.components?.securitySchemes?.session).toEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'better-auth.session_token' }),
    );
  });

  it('admin routes document 401/403; customer routes document 401', () => {
    for (const [, method, path] of OPERATIONS.filter(([, , p]) => p.startsWith('/admin/'))) {
      expect(Object.keys(operation(method, path)?.responses ?? {})).toEqual(
        expect.arrayContaining(['401', '403']),
      );
    }
    for (const [, method, path] of OPERATIONS.filter(([, , p]) => p.startsWith('/me'))) {
      expect(Object.keys(operation(method, path)?.responses ?? {})).toContain('401');
    }
  });

  it('POST /checkout and quote accept require an Idempotency-Key header', () => {
    for (const path of ['/checkout', '/me/quotes/{number}/accept']) {
      expect(operation('post', path)?.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ in: 'header', name: 'Idempotency-Key', required: true }),
        ]),
      );
    }
  });

  it('lists the Better Auth endpoints in the API description', () => {
    expect(doc.info.description).toContain('/auth/sign-in/email');
    expect(doc.info.description).toContain('/auth/email-otp/');
  });

  it.each(OPERATIONS.filter(([, , , access]) => access === 'session'))(
    '%s: %s %s requires a session (401 UNAUTHORIZED without one)',
    async (operationId, method, path) => {
      const res = await request(app.getHttpServer())
        [method](toUrl(path))
        .query(REQUIRED_QUERY[operationId] ?? {})
        .send(method === 'get' || method === 'delete' ? undefined : {});
      expect(res.status).toBe(401);
      expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: expect.any(String) } });
    },
  );

  it.each(OPERATIONS.filter(([id]) => !EXISTING.has(id) && !IMPLEMENTED.has(id)))(
    '%s stub responds (501 NOT_IMPLEMENTED or 400 for an empty body), never 404',
    async (operationId, method, path, access) => {
      const req = request(app.getHttpServer())[method](toUrl(path));
      if (access === 'session') void req.set('Cookie', admin);
      const res = await req
        .query(REQUIRED_QUERY[operationId] ?? {})
        .send(method === 'get' || method === 'delete' ? undefined : {});

      expect([400, 501]).toContain(res.status);
      if (res.status === 501) {
        expect(res.body).toEqual({
          error: { code: 'NOT_IMPLEMENTED', message: `${operationId} not implemented yet` },
        });
      } else {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    },
  );

  it('validates input before reaching a stub (400 VALIDATION_ERROR)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/products')
      .query({ limit: 101 })
      .expect(400);
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'limit' })]);

    await request(app.getHttpServer())
      .post('/api/v1/me/business-profile')
      .set('Cookie', admin)
      .send({ legalName: 'Kritex', gstin: 'NOT-A-GSTIN' })
      .expect(400);
  });

  it('keeps existing routes working: health, POST /queries, GET /queries (now session-based)', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200, { status: 'ok' });
    const body = { name: 'A', email: 'a@b.co', requirements: 'r' };
    // Enquiries need a verified account since ADR-018.
    await request(app.getHttpServer()).post('/api/v1/queries').send(body).expect(401);
    const created = await request(app.getHttpServer())
      .post('/api/v1/queries')
      .set('Cookie', admin)
      .send(body)
      .expect(201);
    await request(app.getHttpServer()).get('/api/v1/queries').expect(401);
    const list = await request(app.getHttpServer())
      .get('/api/v1/queries')
      .set('Cookie', admin)
      .expect(200);
    expect(list.body).toEqual([expect.objectContaining({ id: created.body.id })]);
  });
});
