import { Prisma, type PrismaClient, ProductStatus, Role, SaleChannel } from '@prisma/client';
import { type Catalog, type CatalogProduct } from './catalog';
import { PLACEHOLDER_STOCK_PER_VARIANT, placeholderFor } from './placeholders';
import {
  COLOUR_OPTION,
  SIZE_OPTION,
  assignProductCodes,
  buildSku,
  buildVariants,
  productCodeFromSku,
} from './variants';

export interface SeedOptions {
  catalog: Catalog;
  /** SEED_PLACEHOLDER_PRICES=true: fill missing prices/HSN/GST/weights and give new variants stock. */
  placeholderPrices: boolean;
  /**
   * SEED_ADMIN_EMAIL / SEED_ADMIN_NAME. `passwordHash` (from SEED_ADMIN_PASSWORD, hashed with
   * Better Auth's `hashPassword`) creates an email+password login if the admin has none yet.
   */
  admin?: { email: string; name: string; passwordHash?: string } | null;
  log?: (message: string) => void;
}

export interface SeedCounts {
  categories: number;
  products: number;
  options: number;
  variants: number;
  images: number;
  specSheets: number;
  adminUsers: number;
}

/** Inventory movement refId for stock created by the seed. */
export const SEED_REF_ID = 'seed';

/**
 * Idempotent catalog seed. Upserts by natural keys (Category.slug, Product.slug, option name,
 * variant title) so re-running changes nothing. Existing variants keep their SKU, price and stock;
 * existing products keep their price / tax / channel / status (those are owned by the CSV import
 * and the admin UI after the first run).
 */
export async function runSeed(prisma: PrismaClient, opts: SeedOptions): Promise<SeedCounts> {
  const log = opts.log ?? (() => undefined);
  const { catalog } = opts;

  // ---- categories ----
  const categoryIds = new Map<string, string>();
  for (const c of catalog.categories) {
    const data = {
      name: c.title,
      description: c.description,
      image: c.image,
      sortOrder: c.sortOrder,
      isActive: c.available,
    };
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, ...data },
      update: data,
      select: { id: true },
    });
    categoryIds.set(c.slug, row.id);
  }

  // ---- product codes for SKUs (existing codes are kept, new ones avoid collisions) ----
  const existing = await prisma.product.findMany({
    select: {
      slug: true,
      variants: { select: { sku: true }, take: 1, orderBy: { sortOrder: 'asc' } },
    },
  });
  const existingCodes = new Map<string, string>();
  for (const p of existing) {
    const code = p.variants[0] ? productCodeFromSku(p.variants[0].sku) : null;
    if (code) existingCodes.set(p.slug, code);
  }
  const newCodes = assignProductCodes(
    catalog.products.map((p) => p.slug).filter((slug) => !existingCodes.has(slug)),
    existingCodes.values(),
  );
  const codeFor = (slug: string) => existingCodes.get(slug) ?? newCodes.get(slug)!;

  for (const p of catalog.products) {
    await prisma.$transaction((tx) =>
      seedProduct(tx, p, categoryIds.get(p.categorySlug)!, codeFor(p.slug), opts.placeholderPrices),
    );
  }

  // ---- admin user ----
  if (opts.admin) {
    const email = opts.admin.email.trim().toLowerCase();
    const admin = await prisma.user.upsert({
      where: { email },
      create: { email, name: opts.admin.name, role: Role.ADMIN, emailVerified: true },
      update: { role: Role.ADMIN, emailVerified: true, banned: false },
    });
    log(`Admin user ensured: ${email}`);
    // Better Auth credential account. Never overwrites an existing password (it may have been
    // changed since); without one, sign in via email OTP or "forgot password".
    if (opts.admin.passwordHash) {
      const existing = await prisma.account.findFirst({
        where: { userId: admin.id, providerId: 'credential' },
      });
      if (existing?.password) {
        log('Admin already has a password: left unchanged.');
      } else {
        await prisma.account.upsert({
          where: { id: existing?.id ?? `seed-credential-${admin.id}` },
          create: {
            id: `seed-credential-${admin.id}`,
            userId: admin.id,
            accountId: admin.id,
            providerId: 'credential',
            password: opts.admin.passwordHash,
          },
          update: { password: opts.admin.passwordHash },
        });
        log('Admin password set from SEED_ADMIN_PASSWORD.');
      }
    }
  } else {
    log('SEED_ADMIN_EMAIL not set: skipping admin user.');
  }

  const counts: SeedCounts = {
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    options: await prisma.productOption.count(),
    variants: await prisma.variant.count(),
    images: await prisma.productImage.count(),
    specSheets: await prisma.specSheet.count(),
    adminUsers: await prisma.user.count({ where: { role: Role.ADMIN } }),
  };
  log(`Seed complete: ${JSON.stringify(counts)}`);
  return counts;
}

async function seedProduct(
  tx: Prisma.TransactionClient,
  p: CatalogProduct,
  categoryId: string,
  productCode: string,
  placeholderPrices: boolean,
): Promise<void> {
  const placeholder = placeholderPrices ? placeholderFor(p.categorySlug, p.subCategory) : null;
  const descriptive = {
    name: p.name,
    description: p.description,
    subCategory: p.subCategory,
    categoryId,
    specs: p.specs,
    sortOrder: p.sortOrder,
  };

  const current = await tx.product.findUnique({ where: { slug: p.slug } });
  let productId: string;
  if (!current) {
    const created = await tx.product.create({
      data: {
        slug: p.slug,
        ...descriptive,
        status: ProductStatus.ACTIVE,
        saleChannel: SaleChannel.ENQUIRY_ONLY,
        ...(placeholder ?? {}),
      },
      select: { id: true },
    });
    productId = created.id;
  } else {
    productId = current.id;
    // Placeholders only fill gaps; never overwrite real data.
    const fill: Prisma.ProductUncheckedUpdateInput = {};
    if (placeholder) {
      if (current.basePrice === null) fill.basePrice = placeholder.basePrice;
      if (current.hsnCode === null) fill.hsnCode = placeholder.hsnCode;
      if (current.gstRate === null) fill.gstRate = placeholder.gstRate;
      if (current.weightGrams === null) fill.weightGrams = placeholder.weightGrams;
      if (current.lengthCm === null) fill.lengthCm = placeholder.lengthCm;
      if (current.widthCm === null) fill.widthCm = placeholder.widthCm;
      if (current.heightCm === null) fill.heightCm = placeholder.heightCm;
    }
    await tx.product.update({ where: { id: productId }, data: { ...descriptive, ...fill } });
  }

  // ---- options ----
  const colours = p.colorVariants.map((c) => c.label);
  const desiredOptions: {
    name: string;
    values: string[];
    swatches: Prisma.InputJsonValue | null;
  }[] = [];
  if (p.sizes.length) desiredOptions.push({ name: SIZE_OPTION, values: p.sizes, swatches: null });
  if (colours.length) {
    const swatches = Object.fromEntries(
      p.colorVariants.filter((c) => c.swatch).map((c) => [c.label, c.swatch]),
    );
    desiredOptions.push({
      name: COLOUR_OPTION,
      values: colours,
      swatches: Object.keys(swatches).length ? swatches : null,
    });
  }
  await tx.productOption.deleteMany({
    where: { productId, name: { notIn: desiredOptions.map((o) => o.name) } },
  });
  for (const [sortOrder, o] of desiredOptions.entries()) {
    const data = {
      values: o.values,
      swatches: o.swatches ?? Prisma.DbNull,
      sortOrder,
    };
    await tx.productOption.upsert({
      where: { productId_name: { productId, name: o.name } },
      create: { productId, name: o.name, ...data },
      update: data,
    });
  }

  // ---- variants (matched by title; existing ones keep sku/price/stock) ----
  const existingVariants = await tx.variant.findMany({
    where: { productId },
    select: { id: true, title: true },
  });
  const byTitle = new Map(existingVariants.map((v) => [v.title, v.id]));
  const desiredVariants = buildVariants(p.sizes, colours);
  const desiredTitles = new Set(desiredVariants.map((v) => v.title));
  // Variants no longer in the catalog are deactivated, not deleted (orders/carts may reference them).
  await tx.variant.updateMany({
    where: { productId, title: { notIn: [...desiredTitles] } },
    data: { isActive: false },
  });
  for (const v of desiredVariants) {
    const id = byTitle.get(v.title);
    if (id) {
      await tx.variant.update({
        where: { id },
        data: { options: v.options, sortOrder: v.sortOrder, isActive: true },
      });
      continue;
    }
    const stock = placeholder ? PLACEHOLDER_STOCK_PER_VARIANT : 0;
    await tx.variant.create({
      data: {
        productId,
        sku: buildSku(productCode, v.options),
        title: v.title,
        options: v.options,
        sortOrder: v.sortOrder,
        stock,
        ...(stock > 0 && {
          movements: {
            create: {
              delta: stock,
              reason: 'RESTOCK',
              refId: SEED_REF_ID,
              note: 'placeholder stock',
            },
          },
        }),
      },
    });
  }

  // ---- images: general images, then colour-linked images ----
  const desiredImages = [
    ...p.images.map((url) => ({ url, alt: p.name, variantOptionValue: null as string | null })),
    ...p.colorVariants
      .filter((c) => c.image)
      .map((c) => ({ url: c.image!, alt: `${p.name} - ${c.label}`, variantOptionValue: c.label })),
  ].map((img, sortOrder) => ({ ...img, sortOrder }));
  const currentImages = await tx.productImage.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
    select: { url: true, alt: true, variantOptionValue: true, sortOrder: true },
  });
  if (!sameRows(currentImages, desiredImages)) {
    await tx.productImage.deleteMany({ where: { productId } });
    await tx.productImage.createMany({ data: desiredImages.map((img) => ({ productId, ...img })) });
  }

  // ---- spec sheets ----
  const desiredSheets = p.specSheets.map((s, sortOrder) => ({
    title: s.title,
    url: s.url,
    sortOrder,
  }));
  const currentSheets = await tx.specSheet.findMany({
    where: { productId },
    orderBy: { sortOrder: 'asc' },
    select: { title: true, url: true, sortOrder: true },
  });
  if (!sameRows(currentSheets, desiredSheets)) {
    await tx.specSheet.deleteMany({ where: { productId } });
    await tx.specSheet.createMany({ data: desiredSheets.map((s) => ({ productId, ...s })) });
  }
}

function sameRows<T extends Record<string, unknown>>(a: T[], b: T[]): boolean {
  return (
    a.length === b.length &&
    a.every((row, i) => Object.keys(b[i]).every((key) => row[key] === b[i][key]))
  );
}
