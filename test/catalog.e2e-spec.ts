import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import { signInAsStaff } from './auth';
import { seedCatalog } from './catalog-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

/** Public catalog: CAT-1..4. */
describe('Catalog (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let fixture: Awaited<ReturnType<typeof seedCatalog>>;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    fixture = await seedCatalog(prisma);
  });

  beforeEach(() => resetThrottler(app));

  afterAll(async () => {
    await app.close();
  });

  const get = (path: string, query: Record<string, string | number> = {}) =>
    request(app.getHttpServer()).get(`/api/v1${path}`).query(query);
  const slugs = (body: { items: { slug: string }[] }) => body.items.map((item) => item.slug);

  describe('GET /categories', () => {
    it('lists active categories by sortOrder with ACTIVE product counts', async () => {
      const res = await get('/categories').expect(200);
      expect(res.body).toEqual({
        items: [
          {
            id: fixture.apparel.id,
            slug: 'apparel',
            name: 'Apparel',
            description: 'Uniforms',
            image: null,
            sortOrder: 1,
            productCount: 2, // shirt + helmet (draft excluded)
          },
          {
            id: fixture.footwear.id,
            slug: 'footwear',
            name: 'Footwear',
            description: null,
            image: '/assets/boots.jpg',
            sortOrder: 2,
            productCount: 1,
          },
        ],
      });
    });
  });

  describe('GET /products', () => {
    it('returns visible product cards, newest first, with the paginated envelope', async () => {
      const res = await get('/products').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 20, total: 3 });
      expect(slugs(res.body)).toEqual(['jungle-boots', 'tactical-helmet', 'combat-shirt']);

      const [boots, helmet, shirt] = res.body.items;
      expect(shirt).toEqual({
        id: fixture.shirt.id,
        slug: 'combat-shirt',
        name: 'Combat Shirt',
        subCategory: 'Shirts',
        category: { id: fixture.apparel.id, slug: 'apparel', name: 'Apparel' },
        image: { url: '/assets/shirt-1.jpg', alt: 'Front' },
        saleChannel: 'RETAIL',
        price: { min: 129900, max: 159900 }, // the inactive 99-paise variant is ignored
        compareAtPrice: 149900,
        inStock: true,
      });
      expect(helmet).toMatchObject({
        price: null,
        compareAtPrice: null,
        inStock: true,
        image: null,
      });
      expect(boots).toMatchObject({
        saleChannel: 'B2B_ONLY',
        price: { min: 450000, max: 450000 },
        inStock: false, // stock 2, reserved 2
      });
    });

    it.each([
      [{ category: 'footwear' }, ['jungle-boots']],
      [{ category: 'hidden' }, []],
      [{ q: 'shirt' }, ['combat-shirt']],
      [{ q: 'SHIRTS' }, ['combat-shirt']], // subCategory, case-insensitive
      [{ q: 'appar' }, ['tactical-helmet', 'combat-shirt']], // category name
      [{ q: '%' }, []], // LIKE wildcards are escaped
      [{ size: 'm' }, ['combat-shirt']],
      [{ colour: 'black' }, ['combat-shirt']],
      [{ size: 'L', colour: 'Olive Green' }, []], // must be the same variant
      [{ size: 'XL' }, []], // only on an inactive variant
      [{ saleChannel: 'B2B_ONLY' }, ['jungle-boots']],
      [{ inStock: 'true' }, ['tactical-helmet', 'combat-shirt']],
      [{ inStock: 'false' }, ['jungle-boots', 'tactical-helmet', 'combat-shirt']],
      [{ minPrice: 150000 }, ['jungle-boots', 'combat-shirt']],
      [{ maxPrice: 130000 }, ['combat-shirt']],
      [{ minPrice: 200000, maxPrice: 500000 }, ['jungle-boots']],
      [{ maxPrice: 100 }, []], // the 99-paise variant is inactive; ENQUIRY_ONLY has no price
    ])('filters %j → %j', async (query, expected) => {
      const res = await get('/products', query).expect(200);
      expect(slugs(res.body)).toEqual(expected);
      expect(res.body.total).toBe(expected.length);
    });

    it('accepts a category id as well as a slug', async () => {
      const res = await get('/products', { category: fixture.footwear.id }).expect(200);
      expect(slugs(res.body)).toEqual(['jungle-boots']);
      const { cookie } = await signInAsStaff(app);
      const admin = await request(app.getHttpServer())
        .get('/api/v1/admin/products')
        .set('Cookie', cookie)
        .query({ category: fixture.footwear.id })
        .expect(200);
      expect(slugs(admin.body)).toEqual(['jungle-boots']);
    });

    it('sorts by price (unpriced last)', async () => {
      const asc = await get('/products', { sort: 'price_asc' }).expect(200);
      expect(slugs(asc.body)).toEqual(['combat-shirt', 'jungle-boots', 'tactical-helmet']);
      const desc = await get('/products', { sort: 'price_desc' }).expect(200);
      expect(slugs(desc.body)).toEqual(['jungle-boots', 'combat-shirt', 'tactical-helmet']);
    });

    it('paginates with a stable total', async () => {
      const page2 = await get('/products', { limit: 2, page: 2 }).expect(200);
      expect(page2.body).toMatchObject({ page: 2, limit: 2, total: 3 });
      expect(slugs(page2.body)).toEqual(['combat-shirt']);
      const beyond = await get('/products', { limit: 2, page: 9 }).expect(200);
      expect(beyond.body).toEqual({ items: [], page: 9, limit: 2, total: 3 });
    });

    it.each<Record<string, string | number>>([
      { limit: 101 },
      { sort: 'cheapest' },
      { inStock: 'yes' },
      { minPrice: -1 },
    ])('rejects %j → 400 VALIDATION_ERROR', async (query) => {
      const res = await get('/products', query).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /products/:slug', () => {
    it('returns the PDP without raw stock counts or price tiers (anonymous)', async () => {
      const res = await get('/products/combat-shirt').expect(200);
      expect(res.body).toEqual({
        id: fixture.shirt.id,
        slug: 'combat-shirt',
        name: 'Combat Shirt',
        description: 'Ripstop combat shirt',
        subCategory: 'Shirts',
        category: { id: fixture.apparel.id, slug: 'apparel', name: 'Apparel' },
        saleChannel: 'RETAIL',
        price: { min: 129900, max: 159900 },
        compareAtPrice: 149900,
        inStock: true,
        purchasable: true,
        images: [
          {
            id: expect.any(String),
            url: '/assets/shirt-1.jpg',
            alt: 'Front',
            sortOrder: 0,
            variantOptionValue: 'Olive Green',
          },
          {
            id: expect.any(String),
            url: '/assets/shirt-2.jpg',
            alt: 'Back',
            sortOrder: 1,
            variantOptionValue: null,
          },
        ],
        options: [
          { name: 'Size', values: ['M', 'L'], swatches: null },
          {
            name: 'Colour',
            values: ['Olive Green', 'Black'],
            swatches: { 'Olive Green': '#556b2f', Black: '#000' },
          },
        ],
        variants: [
          {
            id: expect.any(String),
            sku: 'KTX-CS-M-OLIVEGREEN',
            title: 'M / Olive Green',
            options: { Size: 'M', Colour: 'Olive Green' },
            price: 129900,
            inStock: true,
          },
          {
            id: expect.any(String),
            sku: 'KTX-CS-L-BLACK',
            title: 'L / Black',
            options: { Size: 'L', Colour: 'Black' },
            price: 159900,
            inStock: false,
          },
        ],
        specs: [{ label: 'Fabric', value: 'Ripstop' }],
        specSheets: [{ id: expect.any(String), title: 'Size chart', url: '/docs/size-chart.pdf' }],
        seo: { title: 'Combat Shirt | Kritex', description: null },
      });
      expect(res.body).not.toHaveProperty('priceTiers');
    });

    it('B2B_ONLY is visible with a price but not purchasable for anonymous viewers', async () => {
      const res = await get('/products/jungle-boots').expect(200);
      expect(res.body).toMatchObject({
        saleChannel: 'B2B_ONLY',
        price: { min: 450000, max: 450000 },
        purchasable: false,
        inStock: false,
      });
    });

    it('ENQUIRY_ONLY shows no price', async () => {
      const res = await get('/products/tactical-helmet').expect(200);
      expect(res.body).toMatchObject({ price: null, compareAtPrice: null, purchasable: false });
      expect(res.body.variants).toEqual([expect.objectContaining({ price: null, inStock: true })]);
    });

    it.each(['draft-jacket', 'hidden-cap', 'no-such-product'])(
      '%s → 404 NOT_FOUND',
      async (slug) => {
        const res = await get(`/products/${slug}`).expect(404);
        expect(res.body).toEqual({
          error: { code: 'NOT_FOUND', message: 'Product not found', details: { slug } },
        });
      },
    );

    it('rejects a malformed slug → 400', async () => {
      await get('/products/Not_A_Slug!').expect(400);
    });
  });

  describe('GET /search/suggest', () => {
    it('suggests products by substring with image and category slug', async () => {
      const res = await get('/search/suggest', { q: 'shirt' }).expect(200);
      expect(res.body).toEqual({
        items: [
          {
            type: 'product',
            slug: 'combat-shirt',
            name: 'Combat Shirt',
            image: '/assets/shirt-1.jpg',
            categorySlug: 'apparel',
          },
        ],
      });
    });

    it('puts matching categories first', async () => {
      const res = await get('/search/suggest', { q: 'foot' }).expect(200);
      expect(res.body.items[0]).toEqual({
        type: 'category',
        slug: 'footwear',
        name: 'Footwear',
        image: '/assets/boots.jpg',
        categorySlug: null,
      });
    });

    it('tolerates typos via pg_trgm similarity', async () => {
      const res = await get('/search/suggest', { q: 'comabt' }).expect(200);
      expect(slugs(res.body)).toEqual(['combat-shirt']);
      const helmet = await get('/search/suggest', { q: 'helmt' }).expect(200);
      expect(slugs(helmet.body)).toEqual(['tactical-helmet']);
    });

    it('never suggests hidden products or categories, and honours limit', async () => {
      for (const q of ['draft', 'hidden', 'cap']) {
        const res = await get('/search/suggest', { q }).expect(200);
        expect(res.body.items).toEqual([]);
      }
      const limited = await get('/search/suggest', { q: 'a', limit: 1 }).expect(200);
      expect(limited.body.items.length).toBeLessThanOrEqual(1);
    });

    it('requires q → 400', async () => {
      await get('/search/suggest').expect(400);
      await get('/search/suggest', { q: 'x', limit: 21 }).expect(400);
    });
  });
});
