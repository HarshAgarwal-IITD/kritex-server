import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../src/prisma/prisma.service';
import { loadCatalog } from '../prisma/seed/lib/catalog';
import { toCsv } from '../prisma/seed/lib/csv';
import {
  ImportError,
  PRODUCT_DATA_COLUMNS,
  applyProductData,
  parseProductData,
  planProductData,
} from '../prisma/seed/lib/product-data';
import { runSeed } from '../prisma/seed/lib/seed';
import { resetDatabase } from './utils';

const catalog = loadCatalog();
const ADMIN = { email: 'Admin@Kritex.test', name: 'Seed Admin' };

describe('Seed + product-data import (e2e, test DB)', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.$connect();
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await prisma.$disconnect();
  });

  describe('runSeed', () => {
    it('creates every category, product, variant, image and spec sheet from catalog.json', async () => {
      const counts = await runSeed(prisma, { catalog, placeholderPrices: false, admin: ADMIN });

      const expectedVariants = catalog.products.reduce(
        (sum, p) => sum + Math.max(p.sizes.length, 1) * Math.max(p.colorVariants.length, 1),
        0,
      );
      const expectedImages = catalog.products.reduce(
        (sum, p) => sum + p.images.length + p.colorVariants.filter((c) => c.image).length,
        0,
      );
      expect(counts).toEqual({
        categories: catalog.categories.length,
        products: catalog.products.length,
        options: catalog.products.reduce(
          (sum, p) => sum + (p.sizes.length ? 1 : 0) + (p.colorVariants.length ? 1 : 0),
          0,
        ),
        variants: expectedVariants,
        images: expectedImages,
        specSheets: catalog.products.reduce((sum, p) => sum + p.specSheets.length, 0),
        adminUsers: 1,
      });

      const products = await prisma.product.findMany({
        include: { variants: true, category: true },
      });
      const bySlug = new Map(products.map((p) => [p.slug, p]));
      for (const p of catalog.products) {
        const row = bySlug.get(p.slug);
        expect(row).toBeDefined();
        expect(row!.category.slug).toBe(p.categorySlug);
        expect(row!.status).toBe('ACTIVE');
        expect(row!.saleChannel).toBe('ENQUIRY_ONLY');
        expect(row!.basePrice).toBeNull();
        expect(row!.variants).toHaveLength(
          Math.max(p.sizes.length, 1) * Math.max(p.colorVariants.length, 1),
        );
        for (const v of row!.variants) {
          expect(v.sku).toMatch(/^KTX-[A-Z0-9]+(-[A-Z0-9]+)*$/);
          expect(v.stock).toBe(0);
        }
      }
      const skus = products.flatMap((p) => p.variants.map((v) => v.sku));
      expect(new Set(skus).size).toBe(skus.length);
    });

    it('stores colour options with swatches and colour-linked images', async () => {
      const tee = catalog.products.find((p) => p.colorVariants.length)!;
      const product = await prisma.product.findUniqueOrThrow({
        where: { slug: tee.slug },
        include: { options: { orderBy: { sortOrder: 'asc' } }, images: true, variants: true },
      });
      expect(product.options.map((o) => [o.name, o.values])).toEqual([
        ['Size', tee.sizes],
        ['Colour', tee.colorVariants.map((c) => c.label)],
      ]);
      const colour = tee.colorVariants[0];
      expect(product.options[1].swatches).toMatchObject({ [colour.label]: colour.swatch });
      expect(product.images).toContainEqual(
        expect.objectContaining({ url: colour.image, variantOptionValue: colour.label }),
      );
      const variant = product.variants.find((v) => v.title === `${tee.sizes[0]} / ${colour.label}`);
      expect(variant?.options).toEqual({ Size: tee.sizes[0], Colour: colour.label });
    });

    it('creates the admin user with a verified email and no credentials', async () => {
      const admin = await prisma.user.findUniqueOrThrow({
        where: { email: 'admin@kritex.test' },
        include: { accounts: true },
      });
      expect(admin).toMatchObject({ role: 'ADMIN', emailVerified: true, name: 'Seed Admin' });
      expect(admin.accounts).toEqual([]);
    });

    it('is idempotent: a second run changes no counts, ids or SKUs', async () => {
      const before = await prisma.variant.findMany({
        select: { id: true, sku: true },
        orderBy: { sku: 'asc' },
      });
      const images = await prisma.productImage.findMany({ select: { id: true } });
      const counts = await runSeed(prisma, { catalog, placeholderPrices: false, admin: ADMIN });
      expect(counts.products).toBe(catalog.products.length);
      expect(
        await prisma.variant.findMany({ select: { id: true, sku: true }, orderBy: { sku: 'asc' } }),
      ).toEqual(before);
      expect(await prisma.productImage.findMany({ select: { id: true } })).toEqual(
        expect.arrayContaining(images),
      );
      expect(await prisma.productImage.count()).toBe(images.length);
    });

    it('placeholder mode fills missing prices / HSN / GST and stocks new variants only', async () => {
      await runSeed(prisma, { catalog, placeholderPrices: true });
      const boot = await prisma.product.findFirstOrThrow({
        where: { category: { slug: 'tactical-footwear' } },
        include: { variants: true },
      });
      expect(boot.basePrice).toBe(249900);
      expect(boot.hsnCode).toBe('6403');
      expect(boot.gstRate?.toString()).toBe('5');
      // Existing variants keep their stock (0); placeholders never overwrite.
      expect(boot.variants.every((v) => v.stock === 0)).toBe(true);
      expect(await prisma.inventoryMovement.count()).toBe(0);
    });
  });

  describe('product-data import', () => {
    const template = readFileSync(
      join(__dirname, '..', 'prisma', 'seed', 'product-data-template.csv'),
      'utf8',
    );

    it('the committed template covers every seeded SKU and validates', async () => {
      const { rows, errors } = parseProductData(template);
      expect(errors).toEqual([]);
      expect(rows.map((r) => r.sku).sort()).toEqual(
        (await prisma.variant.findMany({ select: { sku: true } })).map((v) => v.sku).sort(),
      );
      const plan = await planProductData(prisma, rows);
      expect(plan.errors).toEqual([]);
    });

    const csvFor = (rows: Partial<Record<(typeof PRODUCT_DATA_COLUMNS)[number], string>>[]) =>
      toCsv([
        [...PRODUCT_DATA_COLUMNS],
        ...rows.map((r) => PRODUCT_DATA_COLUMNS.map((c) => r[c] ?? '')),
      ]);

    it('applies prices, product fields and stock (with ADJUST movements) in one go', async () => {
      const product = await prisma.product.findFirstOrThrow({
        where: { slug: 'combat-performance-tshirt' },
        include: { variants: { orderBy: { sortOrder: 'asc' }, take: 2 } },
      });
      const [a, b] = product.variants;
      const { rows, errors } = parseProductData(
        csvFor([
          {
            sku: a.sku,
            productSlug: product.slug,
            price_inr: '1199',
            stock: '40',
            hsn: '6109',
            gst_rate: '5',
            sale_channel: 'RETAIL',
            weight_grams: '250',
          },
          { sku: b.sku, productSlug: product.slug, price_inr: '1099.50', stock: '0' },
        ]),
      );
      expect(errors).toEqual([]);
      const result = await applyProductData(prisma, rows, { refId: 'test-import' });
      expect(result).toEqual({ variantsUpdated: 2, stockMovements: 1, productsUpdated: 1 });

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        include: { variants: { where: { id: { in: [a.id, b.id] } } } },
      });
      expect(after).toMatchObject({
        hsnCode: '6109',
        saleChannel: 'RETAIL',
        weightGrams: 250,
        basePrice: 109950,
      });
      expect(after.variants.find((v) => v.id === a.id)).toMatchObject({ price: 119900, stock: 40 });
      expect(after.variants.find((v) => v.id === b.id)).toMatchObject({ price: 109950, stock: 0 });
      expect(await prisma.inventoryMovement.findMany()).toEqual([
        expect.objectContaining({
          variantId: a.id,
          delta: 40,
          reason: 'ADJUST',
          refId: 'test-import',
        }),
      ]);
    });

    it('rejects the whole file (nothing written) if any row fails against the DB', async () => {
      const variant = await prisma.variant.findFirstOrThrow({ include: { product: true } });
      const { rows } = parseProductData(
        csvFor([
          { sku: variant.sku, productSlug: variant.product.slug, stock: '999' },
          { sku: 'KTX-NOPE-1', productSlug: 'nope' },
          {
            sku: variant.sku === 'KTX-SDB-6' ? 'KTX-SDB-7' : 'KTX-SDB-6',
            productSlug: 'wrong-slug',
          },
        ]),
      );
      const error = await applyProductData(prisma, rows, { refId: 'bad' }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ImportError);
      expect((error as ImportError).errors).toEqual([
        { line: 3, message: 'unknown sku KTX-NOPE-1' },
        expect.objectContaining({ line: 4, message: expect.stringMatching(/not wrong-slug$/) }),
      ]);
      const unchanged = await prisma.variant.findUniqueOrThrow({ where: { id: variant.id } });
      expect(unchanged.stock).toBe(variant.stock);
      expect(await prisma.inventoryMovement.count({ where: { refId: 'bad' } })).toBe(0);
    });
  });
});
