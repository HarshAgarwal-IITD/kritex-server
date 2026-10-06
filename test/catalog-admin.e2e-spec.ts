// Must stay the first import (sets UPLOADS_DIR before AppModule loads its config).
import { TEST_UPLOADS_DIR } from './catalog-uploads-env';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { signInAsStaff, TEST_ORIGIN } from './auth';
import { seedCatalog } from './catalog-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

const items = <T>(body: unknown) => (body as { items: T[] }).items;

/**
 * Admin catalog: CAT-5 (products, variants, stock, inventory, categories) and CAT-6 (uploads).
 * Every admin request goes through `admin()`, which carries a fresh STAFF session.
 */
describe('Admin catalog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let uploadsDir: string;
  let fixture: Awaited<ReturnType<typeof seedCatalog>>;
  let staffCookie: string;

  beforeAll(async () => {
    uploadsDir = TEST_UPLOADS_DIR;
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    resetThrottler(app);
    fixture = await seedCatalog(prisma);
    ({ cookie: staffCookie } = await signInAsStaff(app));
  });

  afterAll(async () => {
    await app.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  const admin = () =>
    request.agent(app.getHttpServer()).set('Cookie', staffCookie).set('Origin', TEST_ORIGIN);
  const api = (path: string) => `/api/v1${path}`;

  // ---------------------------------------------------------------- categories

  describe('categories', () => {
    it('lists all categories (incl. inactive) with counts over every status', async () => {
      const res = await admin().get(api('/admin/categories')).expect(200);
      expect(items<{ slug: string }>(res.body).map((c) => c.slug)).toEqual([
        'hidden',
        'apparel',
        'footwear',
      ]);
      expect(res.body.items[1]).toEqual({
        id: fixture.apparel.id,
        slug: 'apparel',
        name: 'Apparel',
        description: 'Uniforms',
        image: null,
        sortOrder: 1,
        isActive: true,
        productCount: 3, // shirt, helmet, draft
      });
    });

    it('creates, updates and deletes a category', async () => {
      const created = await admin()
        .post(api('/admin/categories'))
        .send({ slug: 'Bags', name: '  Bags ' })
        .expect(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        slug: 'bags',
        name: 'Bags',
        description: null,
        image: null,
        sortOrder: 0,
        isActive: true,
        productCount: 0,
      });

      const updated = await admin()
        .patch(api(`/admin/categories/${created.body.id}`))
        .send({ isActive: false, description: 'Backpacks', sortOrder: 9 })
        .expect(200);
      expect(updated.body).toMatchObject({
        isActive: false,
        description: 'Backpacks',
        sortOrder: 9,
      });

      await admin()
        .delete(api(`/admin/categories/${created.body.id}`))
        .expect(204);
      expect(await prisma.category.count({ where: { slug: 'bags' } })).toBe(0);
    });

    it('409 CONFLICT on a taken slug (create and update)', async () => {
      const res = await admin()
        .post(api('/admin/categories'))
        .send({ slug: 'apparel', name: 'Again' })
        .expect(409);
      expect(res.body.error).toMatchObject({ code: 'CONFLICT', details: { field: 'slug' } });
      await admin()
        .patch(api(`/admin/categories/${fixture.footwear.id}`))
        .send({ slug: 'apparel' })
        .expect(409);
    });

    it('409 CATEGORY_NOT_EMPTY, 404 for unknown ids', async () => {
      const res = await admin()
        .delete(api(`/admin/categories/${fixture.apparel.id}`))
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CATEGORY_NOT_EMPTY',
        details: { productCount: 3 },
      });
      await admin().delete(api('/admin/categories/nope')).expect(404);
      await admin().patch(api('/admin/categories/nope')).send({ name: 'x' }).expect(404);
    });
  });

  // ---------------------------------------------------------------- products

  describe('products', () => {
    const newProduct = () => ({
      slug: 'rapid-20-tactical-backpack',
      name: 'Rapid 20 Tactical Backpack',
      categoryId: fixture.apparel.id,
      saleChannel: 'RETAIL',
      basePrice: 349900,
      hsnCode: '4202',
      gstRate: 18,
      specs: [{ label: 'Volume', value: '20 L' }],
      weightGrams: 900,
      images: [{ url: '/assets/bag.jpg', alt: 'Bag' }],
      options: [
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Colour', values: ['Black', 'Olive Green'], swatches: { Black: '#000' } },
      ],
      specSheets: [{ title: 'Spec', url: '/docs/bag.pdf' }],
      priceTiers: [{ minQty: 20, unitPrice: 299900 }],
    });

    it('creates a product with nested data → 201 full admin shape', async () => {
      const res = await admin().post(api('/admin/products')).send(newProduct()).expect(201);
      expect(res.body).toEqual({
        id: expect.any(String),
        slug: 'rapid-20-tactical-backpack',
        name: 'Rapid 20 Tactical Backpack',
        description: null,
        subCategory: null,
        category: { id: fixture.apparel.id, slug: 'apparel', name: 'Apparel' },
        saleChannel: 'RETAIL',
        status: 'DRAFT',
        basePrice: 349900,
        compareAtPrice: null,
        hsnCode: '4202',
        gstRate: 18,
        specs: [{ label: 'Volume', value: '20 L' }],
        weightGrams: 900,
        lengthCm: null,
        widthCm: null,
        heightCm: null,
        seoTitle: null,
        seoDescription: null,
        images: [
          {
            id: expect.any(String),
            url: '/assets/bag.jpg',
            alt: 'Bag',
            sortOrder: 0,
            variantOptionValue: null,
          },
        ],
        options: [
          { name: 'Size', values: ['S', 'M'], swatches: null },
          { name: 'Colour', values: ['Black', 'Olive Green'], swatches: { Black: '#000' } },
        ],
        variants: [],
        specSheets: [{ id: expect.any(String), title: 'Spec', url: '/docs/bag.pdf', sortOrder: 0 }],
        priceTiers: [{ minQty: 20, unitPrice: 299900 }],
        createdAt: expect.stringMatching(ISO_DATETIME),
        updatedAt: expect.stringMatching(ISO_DATETIME),
      });
    });

    it('rejects a taken slug (409), an unknown category (404) and bad input (400)', async () => {
      await admin()
        .post(api('/admin/products'))
        .send({ ...newProduct(), slug: 'combat-shirt' })
        .expect(409);
      const missing = await admin()
        .post(api('/admin/products'))
        .send({ ...newProduct(), categoryId: 'nope' })
        .expect(404);
      expect(missing.body.error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Category not found',
      });
      const bad = await admin()
        .post(api('/admin/products'))
        .send({ ...newProduct(), basePrice: 12.5, hsnCode: '12' })
        .expect(400);
      expect((bad.body.error.details as { path: string }[]).map((d) => d.path).sort()).toEqual([
        'basePrice',
        'hsnCode',
      ]);
    });

    it('lists products with filters and admin summary fields', async () => {
      const all = await admin().get(api('/admin/products')).expect(200);
      expect(all.body.total).toBe(5);

      const drafts = await admin()
        .get(api('/admin/products'))
        .query({ status: 'DRAFT' })
        .expect(200);
      expect(items<{ slug: string }>(drafts.body).map((p) => p.slug)).toEqual(['draft-jacket']);

      const bySku = await admin().get(api('/admin/products')).query({ q: 'cs-l-bl' }).expect(200);
      expect(bySku.body.items).toEqual([
        {
          id: fixture.shirt.id,
          slug: 'combat-shirt',
          name: 'Combat Shirt',
          category: { id: fixture.apparel.id, slug: 'apparel', name: 'Apparel' },
          status: 'ACTIVE',
          saleChannel: 'RETAIL',
          basePrice: 129900,
          image: '/assets/shirt-1.jpg',
          variantCount: 3,
          totalAvailable: 5, // active variants only
          updatedAt: expect.stringMatching(ISO_DATETIME),
        },
      ]);

      const footwear = await admin()
        .get(api('/admin/products'))
        .query({ category: 'footwear', limit: 1 })
        .expect(200);
      expect(footwear.body).toMatchObject({ total: 1, limit: 1, page: 1 });
    });

    it('gets a product with variants incl. stock; 404 for unknown ids', async () => {
      const res = await admin()
        .get(api(`/admin/products/${fixture.shirt.id}`))
        .expect(200);
      expect(res.body.gstRate).toBe(12);
      expect(res.body.variants).toHaveLength(3);
      expect(res.body.variants[1]).toEqual({
        id: expect.any(String),
        productId: fixture.shirt.id,
        sku: 'KTX-CS-L-BLACK',
        title: 'L / Black',
        options: { Size: 'L', Colour: 'Black' },
        price: 159900,
        effectivePrice: 159900,
        stock: 0,
        reserved: 0,
        available: 0,
        isActive: true,
      });
      expect(res.body.variants[0]).toMatchObject({ price: null, effectivePrice: 129900 });
      await admin().get(api('/admin/products/nope')).expect(404);
    });

    it('updates scalars partially and replaces nested arrays wholesale', async () => {
      const res = await admin()
        .patch(api(`/admin/products/${fixture.shirt.id}`))
        .send({
          name: 'Combat Shirt v2',
          compareAtPrice: null,
          images: [{ url: '/assets/new.jpg' }],
          priceTiers: [],
        })
        .expect(200);
      expect(res.body).toMatchObject({
        name: 'Combat Shirt v2',
        slug: 'combat-shirt',
        basePrice: 129900,
        compareAtPrice: null,
        priceTiers: [],
        images: [expect.objectContaining({ url: '/assets/new.jpg', alt: null })],
      });
      expect(res.body.options).toHaveLength(2); // untouched
      expect(await prisma.productImage.count({ where: { productId: fixture.shirt.id } })).toBe(1);

      await admin()
        .patch(api(`/admin/products/${fixture.shirt.id}`))
        .send({ slug: 'jungle-boots' })
        .expect(409);
      await admin().patch(api('/admin/products/nope')).send({ name: 'x' }).expect(404);
    });

    it('deletes an unreferenced product; archives one with quotes', async () => {
      await admin()
        .delete(api(`/admin/products/${fixture.helmet.id}`))
        .expect(204);
      expect(await prisma.product.findUnique({ where: { id: fixture.helmet.id } })).toBeNull();

      await prisma.quote.create({
        data: {
          number: 'KTQ-100001',
          contactName: 'A',
          email: 'a@b.co',
          phone: '9876543210',
          organization: 'Org',
          items: { create: [{ productId: fixture.boots.id, quantity: 10 }] },
        },
      });
      await admin()
        .delete(api(`/admin/products/${fixture.boots.id}`))
        .expect(204);
      const boots = await prisma.product.findUniqueOrThrow({ where: { id: fixture.boots.id } });
      expect(boots.status).toBe('ARCHIVED');

      await admin().delete(api('/admin/products/nope')).expect(404);
    });
  });

  // ---------------------------------------------------------------- variants & stock

  describe('variants', () => {
    async function createBag(options: { name: string; values: string[] }[]) {
      const res = await admin()
        .post(api('/admin/products'))
        .send({
          slug: 'rapid-20-tactical-backpack',
          name: 'Rapid 20',
          categoryId: fixture.apparel.id,
          basePrice: 1000,
          options,
        })
        .expect(201);
      return res.body.id as string;
    }

    it('generates the cartesian product with seed-style SKUs and initial stock movements', async () => {
      const id = await createBag([
        { name: 'Size', values: ['S', 'M'] },
        { name: 'Colour', values: ['Black', 'Olive Green'] },
      ]);
      const res = await admin()
        .post(api(`/admin/products/${id}/variants`))
        .send({ defaultStock: 3 })
        .expect(201);
      expect(items<{ sku: string; title: string }>(res.body).map((v) => [v.sku, v.title])).toEqual([
        ['KTX-R20TB-S-BLACK', 'S / Black'],
        ['KTX-R20TB-S-OLIVEGREEN', 'S / Olive Green'],
        ['KTX-R20TB-M-BLACK', 'M / Black'],
        ['KTX-R20TB-M-OLIVEGREEN', 'M / Olive Green'],
      ]);
      expect(res.body.items[0]).toMatchObject({
        options: { Size: 'S', Colour: 'Black' },
        price: null,
        effectivePrice: 1000,
        stock: 3,
        available: 3,
        isActive: true,
      });
      const movements = await prisma.inventoryMovement.findMany({
        where: { variant: { productId: id } },
      });
      expect(movements).toHaveLength(4);
      expect(movements.every((m) => m.reason === 'RESTOCK' && m.delta === 3)).toBe(true);

      // Idempotent: nothing new, no extra movements.
      const again = await admin()
        .post(api(`/admin/products/${id}/variants`))
        .send({ defaultStock: 3 })
        .expect(201);
      expect(again.body.items).toHaveLength(4);
      expect(await prisma.inventoryMovement.count()).toBe(4);
    });

    it('adds new combinations and deactivates removed ones after an options change', async () => {
      const id = await createBag([{ name: 'Size', values: ['S', 'M'] }]);
      await admin()
        .post(api(`/admin/products/${id}/variants`))
        .send({})
        .expect(201);
      await admin()
        .patch(api(`/admin/products/${id}`))
        .send({ options: [{ name: 'Size', values: ['M', 'L'] }] })
        .expect(200);

      const res = await admin()
        .post(api(`/admin/products/${id}/variants`))
        .send({ defaultPrice: 1200 })
        .expect(201);
      const bySku = Object.fromEntries(
        items<{ sku: string; isActive: boolean; price: number | null }>(res.body).map((v) => [
          v.sku,
          [v.isActive, v.price],
        ]),
      );
      expect(bySku).toEqual({
        'KTX-R20TB-S': [false, null],
        'KTX-R20TB-M': [true, null],
        'KTX-R20TB-L': [true, 1200],
      });
      // Order follows the options (M, L); deactivated variants go last.
      expect(items<{ sku: string }>(res.body).map((v) => v.sku)).toEqual([
        'KTX-R20TB-M',
        'KTX-R20TB-L',
        'KTX-R20TB-S',
      ]);
    });

    it('a product without options gets one Default variant; SKU prefix clashes → 409', async () => {
      const id = await createBag([]);
      const res = await admin()
        .post(api(`/admin/products/${id}/variants`))
        .send({ skuPrefix: 'ktx-cs-m-olivegreen' })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        details: { field: 'sku', skus: ['KTX-CS-M-OLIVEGREEN'] },
      });
      const ok = await admin()
        .post(api(`/admin/products/${id}/variants`))
        .send({})
        .expect(201);
      expect(ok.body.items).toEqual([
        expect.objectContaining({ sku: 'KTX-R20TB', title: 'Default', options: {} }),
      ]);
      await admin().post(api('/admin/products/nope/variants')).send({}).expect(404);
    });

    it('lists variants; updates SKU / price / active', async () => {
      const list = await admin()
        .get(api(`/admin/products/${fixture.shirt.id}/variants`))
        .expect(200);
      const variant = list.body.items[0];

      const res = await admin()
        .patch(api(`/admin/variants/${variant.id}`))
        .send({ sku: 'ktx-cs-m-og', price: 139900, isActive: false })
        .expect(200);
      expect(res.body).toMatchObject({
        sku: 'KTX-CS-M-OG',
        price: 139900,
        effectivePrice: 139900,
        isActive: false,
      });

      const clash = await admin()
        .patch(api(`/admin/variants/${variant.id}`))
        .send({ sku: 'KTX-CS-L-BLACK' })
        .expect(409);
      expect(clash.body.error.code).toBe('CONFLICT');
      await admin().patch(api('/admin/variants/nope')).send({ price: 1 }).expect(404);
      await admin().get(api('/admin/products/nope/variants')).expect(404);
    });

    it('adjusts stock with an InventoryMovement; never below reserved', async () => {
      const variant = await prisma.variant.findUniqueOrThrow({
        where: { sku: 'KTX-CS-M-OLIVEGREEN' },
      });
      const res = await admin()
        .patch(api(`/admin/variants/${variant.id}/stock`))
        .send({ delta: 7, reason: 'RESTOCK', note: 'PO 42' })
        .expect(200);
      expect(res.body).toMatchObject({ stock: 12, reserved: 0, available: 12 });
      expect(await prisma.inventoryMovement.findMany({ where: { variantId: variant.id } })).toEqual(
        [expect.objectContaining({ delta: 7, reason: 'RESTOCK', note: 'PO 42', actorId: null })],
      );

      await prisma.variant.update({ where: { id: variant.id }, data: { reserved: 10 } });
      const res409 = await admin()
        .patch(api(`/admin/variants/${variant.id}/stock`))
        .send({ delta: -3, reason: 'ADJUST' })
        .expect(409);
      expect(res409.body.error).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { stock: 12, reserved: 10, delta: -3 },
      });
      expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(1);
      expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(
        12,
      );

      await admin()
        .patch(api(`/admin/variants/${variant.id}/stock`))
        .send({ delta: 0, reason: 'ADJUST' })
        .expect(400);
      await admin()
        .patch(api(`/admin/variants/${variant.id}/stock`))
        .send({ delta: 1, reason: 'ORDER' })
        .expect(400);
      await admin()
        .patch(api('/admin/variants/nope/stock'))
        .send({ delta: 1, reason: 'RESTOCK' })
        .expect(404);
    });

    it('stock changes run concurrently without losing updates', async () => {
      const variant = await prisma.variant.findUniqueOrThrow({
        where: { sku: 'KTX-CS-M-OLIVEGREEN' },
      });
      await Promise.all(
        Array.from({ length: 5 }, () =>
          admin()
            .patch(api(`/admin/variants/${variant.id}/stock`))
            .send({ delta: 1, reason: 'RESTOCK' })
            .expect(200),
        ),
      );
      expect((await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(
        10,
      );
      expect(await prisma.inventoryMovement.count({ where: { variantId: variant.id } })).toBe(5);
    });
  });

  describe('inventory', () => {
    it('lists stock rows, lowest availability first, with filters', async () => {
      const all = await admin().get(api('/admin/inventory')).expect(200);
      expect(all.body.total).toBe(7);
      expect(all.body.items[0]).toMatchObject({ available: 0 });

      const low = await admin()
        .get(api('/admin/inventory'))
        .query({ lowStock: 'true', threshold: 1 })
        .expect(200);
      expect(
        items<{ sku: string }>(low.body)
          .map((row) => row.sku)
          .sort(),
      ).toEqual(['KTX-CS-L-BLACK', 'KTX-DJ', 'KTX-HC', 'KTX-JB-9']);
      expect(items<{ lowStock: boolean }>(low.body).every((row) => row.lowStock)).toBe(true);

      const byName = await admin().get(api('/admin/inventory')).query({ q: 'boots' }).expect(200);
      expect(byName.body.items).toEqual([
        {
          variantId: expect.any(String),
          productId: fixture.boots.id,
          productName: 'Jungle Boots',
          sku: 'KTX-JB-9',
          title: '9',
          stock: 2,
          reserved: 2,
          available: 0,
          isActive: true,
          lowStock: true,
        },
      ]);

      const byProduct = await admin()
        .get(api('/admin/inventory'))
        .query({ productId: fixture.shirt.id, limit: 2 })
        .expect(200);
      expect(byProduct.body).toMatchObject({ total: 3, limit: 2 });
      expect(byProduct.body.items).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------- uploads (local driver)

  describe('uploads', () => {
    const png = Buffer.from('89504e470d0a1a0a0000', 'hex');

    const ticket = async (size = png.length) => {
      const res = await admin()
        .post(api('/admin/uploads'))
        .send({
          purpose: 'PRODUCT_IMAGE',
          filename: 'Front View.png',
          contentType: 'image/png',
          size,
        })
        .expect(201);
      return res.body as {
        key: string;
        uploadUrl: string;
        method: string;
        headers: Record<string, string>;
        publicUrl: string;
        expiresAt: string;
      };
    };

    it('issues a ticket, accepts the PUT and serves the file back', async () => {
      const t = await ticket();
      expect(t).toEqual({
        key: expect.stringMatching(/^products\/[0-9a-f-]{36}-front-view\.png$/),
        uploadUrl: expect.stringMatching(
          /^\/api\/v1\/uploads\/local\/products\/.+\?expires=\d+&size=10&sig=[0-9a-f]{64}$/,
        ),
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        publicUrl: `/api/v1/uploads/local/${t.key}`,
        expiresAt: expect.stringMatching(ISO_DATETIME),
      });

      await admin().put(t.uploadUrl).set(t.headers).send(png).expect(200, { key: t.key, size: 10 });
      expect(existsSync(join(uploadsDir, t.key))).toBe(true);

      const file = await admin().get(t.publicUrl).buffer(true).expect(200);
      expect(file.headers['content-type']).toBe('image/png');
      expect(file.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect(Buffer.compare(file.body as Buffer, png)).toBe(0);
    });

    it('rejects a tampered ticket, the wrong content type and oversized bodies', async () => {
      const t = await ticket();
      const wrongType = await admin()
        .put(t.uploadUrl)
        .set('Content-Type', 'image/jpeg')
        .send(png)
        .expect(403);
      expect(wrongType.body.error.code).toBe('UPLOAD_TICKET_INVALID');
      await admin()
        .put(t.uploadUrl.replace('size=10', 'size=11'))
        .set(t.headers)
        .send(png)
        .expect(403);

      const small = await ticket(4);
      const tooBig = await admin().put(small.uploadUrl).set(small.headers).send(png).expect(413);
      expect(tooBig.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      await admin().get(small.publicUrl).expect(404);
    });

    it('validates the request', async () => {
      await admin()
        .post(api('/admin/uploads'))
        .send({ purpose: 'PRODUCT_IMAGE', filename: 'x.gif', contentType: 'image/gif', size: 1 })
        .expect(400);
      await admin()
        .post(api('/admin/uploads'))
        .send({
          purpose: 'PRODUCT_IMAGE',
          filename: 'x.pdf',
          contentType: 'application/pdf',
          size: 1,
        })
        .expect(400);
      await admin()
        .post(api('/admin/uploads'))
        .send({
          purpose: 'SPEC_SHEET',
          filename: 'x.pdf',
          contentType: 'application/pdf',
          size: 21 * 1024 * 1024,
        })
        .expect(400);
      await admin().get(api('/uploads/local/products/..%2F..%2Fetc')).expect(400);
      await admin().get(api('/uploads/local/products/missing.png')).expect(404);
    });
  });
});
