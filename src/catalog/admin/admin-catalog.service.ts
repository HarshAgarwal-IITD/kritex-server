import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { notImplemented } from '../../common/exceptions/not-implemented';
import { PrismaService } from '../../prisma/prisma.service';
import {
  decimalToNumber,
  effectivePrice,
  escapeLike,
  parseSpecs,
  parseSwatches,
  parseVariantOptions,
} from '../catalog.mappers';
import type {
  AdjustStockDto,
  AdminCategoryDto,
  AdminCategoryListDto,
  AdminProductDto,
  AdminProductListDto,
  AdminVariant,
  AdminVariantDto,
  AdminVariantListDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateUploadDto,
  GenerateVariantsDto,
  ImportResultDto,
  InventoryListDto,
  ListAdminProductsQueryDto,
  ListInventoryQueryDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
  UploadTicketDto,
} from '../dto/admin-catalog.dto';
import { STORAGE_DRIVER, type StorageDriver, UPLOAD_TTL_SECONDS } from '../storage/storage.driver';
import {
  MAX_GENERATED_VARIANTS,
  buildSku,
  cartesianVariants,
  countCombinations,
  optionsKey,
  productCodeFromSku,
  productCodeFromSlug,
} from '../variants.util';

type Tx = Prisma.TransactionClient;

const ADMIN_PRODUCT_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
  variants: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
  specSheets: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  priceTiers: { orderBy: { minQty: 'asc' } },
} satisfies Prisma.ProductInclude;

type AdminProductRow = Prisma.ProductGetPayload<{ include: typeof ADMIN_PRODUCT_INCLUDE }>;
type VariantRow = Prisma.VariantGetPayload<object>;

const UPLOAD_FOLDERS: Record<CreateUploadDto['purpose'], string> = {
  PRODUCT_IMAGE: 'products',
  SPEC_SHEET: 'spec-sheets',
  CATEGORY_IMAGE: 'categories',
};
const UPLOAD_EXTENSIONS: Record<CreateUploadDto['contentType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'application/pdf': 'pdf',
};

/** Admin catalog management (CAT-5, CAT-6). */
@Injectable()
export class AdminCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ---------- Products ----------

  async listProducts(query: ListAdminProductsQueryDto): Promise<AdminProductListDto> {
    const where: Prisma.ProductWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.saleChannel && { saleChannel: query.saleChannel }),
      // Slug (what the admin UI sends) or id.
      ...(query.category && {
        category: { OR: [{ slug: query.category }, { id: query.category }] },
      }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { slug: { contains: query.q, mode: 'insensitive' } },
          { variants: { some: { sku: { contains: query.q, mode: 'insensitive' } } } },
        ],
      }),
    };
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          category: { select: { id: true, slug: true, name: true } },
          images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1 },
          variants: { select: { stock: true, reserved: true, isActive: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return {
      items: products.map((product) => ({
        id: product.id,
        slug: product.slug,
        name: product.name,
        category: product.category,
        status: product.status,
        saleChannel: product.saleChannel,
        basePrice: product.basePrice,
        image: product.images[0]?.url ?? null,
        variantCount: product.variants.length,
        totalAvailable: product.variants
          .filter((variant) => variant.isActive)
          .reduce((sum, variant) => sum + (variant.stock - variant.reserved), 0),
        updatedAt: product.updatedAt.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async createProduct(input: CreateProductDto): Promise<AdminProductDto> {
    validateNested(input);
    await this.assertCategoryExists(input.categoryId);
    await this.assertSlugFree('product', input.slug);
    const product = await this.prisma.product.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        subCategory: input.subCategory ?? null,
        categoryId: input.categoryId,
        saleChannel: input.saleChannel,
        status: input.status,
        basePrice: input.basePrice ?? null,
        compareAtPrice: input.compareAtPrice ?? null,
        hsnCode: input.hsnCode ?? null,
        gstRate: input.gstRate ?? null,
        specs: input.specs,
        weightGrams: input.weightGrams ?? null,
        lengthCm: input.lengthCm ?? null,
        widthCm: input.widthCm ?? null,
        heightCm: input.heightCm ?? null,
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        images: { create: imagesData(input.images) },
        options: { create: optionsData(input.options) },
        specSheets: { create: input.specSheets },
        priceTiers: { create: input.priceTiers },
      },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    return toAdminProduct(product);
  }

  async getProduct(id: string): Promise<AdminProductDto> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    if (!product) throw productNotFound(id);
    return toAdminProduct(product);
  }

  async updateProduct(id: string, input: UpdateProductDto): Promise<AdminProductDto> {
    validateNested(input);
    await this.assertProductExists(id);
    if (input.categoryId) await this.assertCategoryExists(input.categoryId);
    if (input.slug) await this.assertSlugFree('product', input.slug, id);

    // Nested arrays present in the body replace the existing rows wholesale.
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        subCategory: input.subCategory,
        categoryId: input.categoryId,
        saleChannel: input.saleChannel,
        status: input.status,
        basePrice: input.basePrice,
        compareAtPrice: input.compareAtPrice,
        hsnCode: input.hsnCode,
        gstRate: input.gstRate,
        specs: input.specs,
        weightGrams: input.weightGrams,
        lengthCm: input.lengthCm,
        widthCm: input.widthCm,
        heightCm: input.heightCm,
        seoTitle: input.seoTitle,
        seoDescription: input.seoDescription,
        ...(input.images && {
          images: { deleteMany: {}, create: imagesData(input.images) },
        }),
        ...(input.options && {
          options: { deleteMany: {}, create: optionsData(input.options) },
        }),
        ...(input.specSheets && { specSheets: { deleteMany: {}, create: input.specSheets } }),
        ...(input.priceTiers && { priceTiers: { deleteMany: {}, create: input.priceTiers } }),
      },
      include: ADMIN_PRODUCT_INCLUDE,
    });
    return toAdminProduct(product);
  }

  /** Deletes the product, or archives it when orders or quotes reference it. */
  async deleteProduct(id: string): Promise<void> {
    await this.assertProductExists(id);
    const [orderItems, quoteItems] = await Promise.all([
      this.prisma.orderItem.count({ where: { variant: { productId: id } } }),
      this.prisma.quoteItem.count({ where: { productId: id } }),
    ]);
    if (orderItems > 0 || quoteItems > 0) {
      await this.prisma.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
      return;
    }
    await this.prisma.product.delete({ where: { id } });
  }

  importProducts(_csv: Buffer | undefined, _dryRun: boolean): Promise<ImportResultDto> {
    return notImplemented('adminImportProducts');
  }

  // ---------- Variants ----------

  async listVariants(productId: string): Promise<AdminVariantListDto> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { basePrice: true },
    });
    if (!product) throw productNotFound(productId);
    const variants = await this.prisma.variant.findMany({
      where: { productId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: variants.map((variant) => toAdminVariant(variant, product.basePrice)) };
  }

  /**
   * Creates a variant for every option combination that has none (matched by options, not title),
   * re-orders existing ones, and deactivates variants whose combination is gone when
   * `deactivateMissing`. Initial stock is written as a RESTOCK InventoryMovement. Idempotent.
   */
  async generateVariants(
    productId: string,
    input: GenerateVariantsDto,
    actorId?: string,
  ): Promise<AdminVariantListDto> {
    await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        include: {
          options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
          variants: true,
        },
      });
      if (!product) throw productNotFound(productId);

      const axes = product.options.map(({ name, values }) => ({ name, values }));
      const count = countCombinations(axes);
      if (count > MAX_GENERATED_VARIANTS) {
        throw new AppException(
          'TOO_MANY_VARIANTS',
          HttpStatus.BAD_REQUEST,
          `Options produce ${count} combinations (max ${MAX_GENERATED_VARIANTS})`,
        );
      }
      const combos = cartesianVariants(axes);

      const existing = new Map<string, VariantRow>();
      for (const variant of product.variants) {
        const key = optionsKey(parseVariantOptions(variant.options));
        if (!existing.has(key)) existing.set(key, variant);
      }

      const prefix =
        input.skuPrefix ??
        (await this.defaultSkuPrefix(tx, product.id, product.slug, product.variants));
      const toCreate = combos
        .filter((combo) => !existing.has(optionsKey(combo.options)))
        .map((combo) => ({
          productId,
          sku: buildSku(prefix, axes, combo.options),
          title: combo.title,
          options: combo.options,
          price: input.defaultPrice ?? null,
          stock: input.defaultStock,
          sortOrder: combo.sortOrder,
        }));
      await assertSkusFree(
        tx,
        toCreate.map((variant) => variant.sku),
      );

      const created = toCreate.length
        ? await tx.variant.createManyAndReturn({
            data: toCreate,
            select: { id: true, stock: true },
          })
        : [];
      const restocked = created.filter((variant) => variant.stock > 0);
      if (restocked.length) {
        await tx.inventoryMovement.createMany({
          data: restocked.map((variant) => ({
            variantId: variant.id,
            delta: variant.stock,
            reason: 'RESTOCK' as const,
            actorId: actorId ?? null,
            note: 'Initial stock (variant generation)',
          })),
        });
      }

      const wanted = new Set(combos.map((combo) => optionsKey(combo.options)));
      for (const combo of combos) {
        const match = existing.get(optionsKey(combo.options));
        if (match && match.sortOrder !== combo.sortOrder) {
          await tx.variant.update({
            where: { id: match.id },
            data: { sortOrder: combo.sortOrder },
          });
        }
      }
      if (input.deactivateMissing) {
        const stale = product.variants
          .filter((variant) => variant.isActive)
          .filter((variant) => !wanted.has(optionsKey(parseVariantOptions(variant.options))))
          .map((variant) => variant.id);
        // Deactivated variants keep their rows (order history) and sort after the live ones.
        for (const [index, id] of stale.entries()) {
          await tx.variant.update({
            where: { id },
            data: { isActive: false, sortOrder: combos.length + index },
          });
        }
      }
    });
    return this.listVariants(productId);
  }

  async updateVariant(id: string, input: UpdateVariantDto): Promise<AdminVariantDto> {
    const variant = await this.prisma.variant.findUnique({ where: { id }, select: { id: true } });
    if (!variant) throw variantNotFound(id);
    if (input.sku) await assertSkusFree(this.prisma, [input.sku], id);
    const updated = await this.prisma.variant.update({
      where: { id },
      data: { sku: input.sku, title: input.title, price: input.price, isActive: input.isActive },
      include: { product: { select: { basePrice: true } } },
    });
    return toAdminVariant(updated, updated.product.basePrice);
  }

  /** Locks the variant row, applies the delta and writes the InventoryMovement atomically. */
  async adjustStock(id: string, input: AdjustStockDto, actorId?: string): Promise<AdminVariantDto> {
    const updated = await this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRaw<{ stock: number; reserved: number }[]>`
        SELECT stock, reserved FROM "Variant" WHERE id = ${id} FOR UPDATE`;
      if (!row) throw variantNotFound(id);
      const stock = row.stock + input.delta;
      if (stock < row.reserved) {
        throw new AppException(
          'INSUFFICIENT_STOCK',
          HttpStatus.CONFLICT,
          'Stock would drop below the units reserved by unpaid orders',
          { stock: row.stock, reserved: row.reserved, delta: input.delta },
        );
      }
      await tx.inventoryMovement.create({
        data: {
          variantId: id,
          delta: input.delta,
          reason: input.reason,
          actorId: actorId ?? null,
          note: input.note ?? null,
        },
      });
      return tx.variant.update({
        where: { id },
        data: { stock },
        include: { product: { select: { basePrice: true } } },
      });
    });
    return toAdminVariant(updated, updated.product.basePrice);
  }

  async listInventory(query: ListInventoryQueryDto): Promise<InventoryListDto> {
    const low = Prisma.sql`(v."isActive" AND v.stock - v.reserved <= ${query.threshold})`;
    const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (query.q) {
      const pattern = `%${escapeLike(query.q)}%`;
      where.push(Prisma.sql`(v.sku ILIKE ${pattern} OR p.name ILIKE ${pattern})`);
    }
    if (query.productId) where.push(Prisma.sql`v."productId" = ${query.productId}`);
    if (query.lowStock) where.push(low);
    const from = Prisma.sql`
      FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
      WHERE ${Prisma.join(where, ' AND ')}`;

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<
        {
          variantId: string;
          productId: string;
          productName: string;
          sku: string;
          title: string;
          stock: number;
          reserved: number;
          isActive: boolean;
          lowStock: boolean;
        }[]
      >`
        SELECT v.id AS "variantId", v."productId", p.name AS "productName", v.sku, v.title,
          v.stock, v.reserved, v."isActive", ${low} AS "lowStock"
        ${from}
        ORDER BY (v.stock - v.reserved) ASC, p.name ASC, v."sortOrder" ASC, v.sku ASC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from}`,
    ]);
    return {
      items: rows.map((row) => ({ ...row, available: row.stock - row.reserved })),
      page: query.page,
      limit: query.limit,
      total: counts[0]?.total ?? 0,
    };
  }

  // ---------- Categories ----------

  async listCategories(): Promise<AdminCategoryListDto> {
    const categories = await this.prisma.category.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
    return { items: categories.map(toAdminCategory) };
  }

  async createCategory(input: CreateCategoryDto): Promise<AdminCategoryDto> {
    await this.assertSlugFree('category', input.slug);
    const category = await this.prisma.category.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        image: input.image ?? null,
        sortOrder: input.sortOrder,
        isActive: input.isActive,
      },
      include: { _count: { select: { products: true } } },
    });
    return toAdminCategory(category);
  }

  async updateCategory(id: string, input: UpdateCategoryDto): Promise<AdminCategoryDto> {
    const existing = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw categoryNotFound(id);
    if (input.slug) await this.assertSlugFree('category', input.slug, id);
    const category = await this.prisma.category.update({
      where: { id },
      data: input,
      include: { _count: { select: { products: true } } },
    });
    return toAdminCategory(category);
  }

  async deleteCategory(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) throw categoryNotFound(id);
    if (category._count.products > 0) {
      throw new AppException(
        'CATEGORY_NOT_EMPTY',
        HttpStatus.CONFLICT,
        'Move or delete the products in this category first',
        { productCount: category._count.products },
      );
    }
    await this.prisma.category.delete({ where: { id } });
  }

  // ---------- Uploads ----------

  // eslint-disable-next-line @typescript-eslint/require-await -- async so validation errors reject
  async createUpload(input: CreateUploadDto): Promise<UploadTicketDto> {
    if (input.purpose !== 'SPEC_SHEET' && !input.contentType.startsWith('image/')) {
      throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'Validation failed', [
        {
          path: 'contentType',
          code: 'invalid_value',
          message: `${input.purpose} uploads must be images`,
        },
      ]);
    }
    const stem = input.filename
      .replace(/\.[^.]*$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const file = [randomUUID(), stem].filter(Boolean).join('-');
    const key = `${UPLOAD_FOLDERS[input.purpose]}/${file}.${UPLOAD_EXTENSIONS[input.contentType]}`;
    const expiresAt = new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000);
    const ticket = this.storage.presignUpload({
      key,
      contentType: input.contentType,
      size: input.size,
      expiresAt,
    });
    return {
      key,
      uploadUrl: ticket.uploadUrl,
      method: 'PUT' as const,
      headers: ticket.headers,
      publicUrl: ticket.publicUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ---------- helpers ----------

  private async assertProductExists(id: string): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { id: true } });
    if (!product) throw productNotFound(id);
  }

  private async assertCategoryExists(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({ where: { id }, select: { id: true } });
    if (!category) throw categoryNotFound(id);
  }

  private async assertSlugFree(
    model: 'product' | 'category',
    slug: string,
    exceptId?: string,
  ): Promise<void> {
    const where = { slug, ...(exceptId && { id: { not: exceptId } }) };
    const taken =
      model === 'product'
        ? await this.prisma.product.findFirst({ where, select: { id: true } })
        : await this.prisma.category.findFirst({ where, select: { id: true } });
    if (taken) {
      throw new AppException('CONFLICT', HttpStatus.CONFLICT, `Slug "${slug}" is already in use`, {
        field: 'slug',
      });
    }
  }

  /**
   * `KTX-<code>`: reuses the code of the product's existing (seeded) SKUs, else derives one from
   * the slug and adds a numeric suffix if another product already uses it.
   */
  private async defaultSkuPrefix(
    tx: Tx,
    productId: string,
    slug: string,
    variants: { sku: string }[],
  ): Promise<string> {
    for (const variant of variants) {
      const code = productCodeFromSku(variant.sku);
      if (code) return `KTX-${code}`;
    }
    const base = productCodeFromSlug(slug);
    for (let n = 1; ; n++) {
      const prefix = `KTX-${n === 1 ? base : `${base}${n}`}`;
      const clash = await tx.variant.findFirst({
        where: {
          productId: { not: productId },
          OR: [{ sku: prefix }, { sku: { startsWith: `${prefix}-` } }],
        },
        select: { id: true },
      });
      if (!clash) return prefix;
    }
  }
}

// ---------- module-level helpers ----------

const productNotFound = (id: string) =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Product not found', { id });
const variantNotFound = (id: string) =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Variant not found', { id });
const categoryNotFound = (id: string) =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Category not found', { id });

/** 409 if any SKU is duplicated in the batch or already used by another variant. */
async function assertSkusFree(
  db: Tx | PrismaService,
  skus: string[],
  exceptVariantId?: string,
): Promise<void> {
  if (skus.length === 0) return;
  const duplicates = skus.filter((sku, index) => skus.indexOf(sku) !== index);
  const taken = await db.variant.findMany({
    where: { sku: { in: skus }, ...(exceptVariantId && { id: { not: exceptVariantId } }) },
    select: { sku: true },
  });
  const conflicts = [...new Set([...duplicates, ...taken.map((variant) => variant.sku)])];
  if (conflicts.length) {
    throw new AppException('CONFLICT', HttpStatus.CONFLICT, 'SKU already in use', {
      field: 'sku',
      skus: conflicts,
    });
  }
}

/** Option names unique (case-insensitive), values unique per option, tier minQty unique. */
function validateNested(input: {
  options?: { name: string; values: string[] }[];
  priceTiers?: { minQty: number }[];
}): void {
  const issues: { path: string; code: string; message: string }[] = [];
  const names = new Set<string>();
  input.options?.forEach((option, index) => {
    const name = option.name.toLowerCase();
    if (names.has(name)) {
      issues.push({ path: `options.${index}.name`, code: 'custom', message: 'Duplicate option' });
    }
    names.add(name);
    if (new Set(option.values).size !== option.values.length) {
      issues.push({
        path: `options.${index}.values`,
        code: 'custom',
        message: 'Duplicate option value',
      });
    }
  });
  const tiers = new Set<number>();
  input.priceTiers?.forEach((tier, index) => {
    if (tiers.has(tier.minQty)) {
      issues.push({
        path: `priceTiers.${index}.minQty`,
        code: 'custom',
        message: 'Duplicate minQty',
      });
    }
    tiers.add(tier.minQty);
  });
  if (issues.length) {
    throw new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, 'Validation failed', issues);
  }
}

function imagesData(images: CreateProductDto['images']) {
  return images.map((image) => ({
    url: image.url,
    alt: image.alt ?? null,
    sortOrder: image.sortOrder,
    variantOptionValue: image.variantOptionValue ?? null,
  }));
}

function optionsData(options: CreateProductDto['options']) {
  return options.map((option, index) => ({
    name: option.name,
    values: option.values,
    swatches: option.swatches ?? Prisma.DbNull,
    sortOrder: index,
  }));
}

export function toAdminVariant(variant: VariantRow, basePrice: number | null): AdminVariant {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    title: variant.title,
    options: parseVariantOptions(variant.options),
    price: variant.price,
    effectivePrice: effectivePrice(variant.price, basePrice),
    stock: variant.stock,
    reserved: variant.reserved,
    available: variant.stock - variant.reserved,
    isActive: variant.isActive,
  };
}

function toAdminProduct(product: AdminProductRow): AdminProductDto {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    description: product.description,
    subCategory: product.subCategory,
    category: product.category,
    saleChannel: product.saleChannel,
    status: product.status,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    hsnCode: product.hsnCode,
    gstRate: decimalToNumber(product.gstRate),
    specs: parseSpecs(product.specs),
    weightGrams: product.weightGrams,
    lengthCm: product.lengthCm,
    widthCm: product.widthCm,
    heightCm: product.heightCm,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    images: product.images.map((image) => ({
      id: image.id,
      url: image.url,
      alt: image.alt,
      sortOrder: image.sortOrder,
      variantOptionValue: image.variantOptionValue,
    })),
    options: product.options.map((option) => ({
      name: option.name,
      values: option.values,
      swatches: parseSwatches(option.swatches),
    })),
    variants: product.variants.map((variant) => toAdminVariant(variant, product.basePrice)),
    specSheets: product.specSheets.map(({ id, title, url, sortOrder }) => ({
      id,
      title,
      url,
      sortOrder,
    })),
    priceTiers: product.priceTiers.map(({ minQty, unitPrice }) => ({ minQty, unitPrice })),
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

function toAdminCategory(
  category: Prisma.CategoryGetPayload<{ include: { _count: { select: { products: true } } } }>,
): AdminCategoryDto {
  return {
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    image: category.image,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    productCount: category._count.products,
  };
}
