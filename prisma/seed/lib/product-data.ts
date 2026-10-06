/**
 * Product-data CSV (prisma/seed/product-data-template.csv): the spreadsheet the business fills in
 * with prices, HSN, GST, stock, weights and sale channel (Open question Q2).
 *
 * One row per SKU. Blank cell = leave unchanged. Product-level columns (compare_at_inr, hsn, gst_rate,
 * weight/dimensions, sale_channel) must agree across all rows of the same product.
 */
import { InventoryReason, type Prisma, type PrismaClient, SaleChannel } from '@prisma/client';
import { z } from 'zod';
import { parseCsv } from './csv';

export const PRODUCT_DATA_COLUMNS = [
  'sku',
  'productSlug',
  'variantTitle',
  'price_inr',
  'compare_at_inr',
  'hsn',
  'gst_rate',
  'stock',
  'weight_grams',
  'length_cm',
  'width_cm',
  'height_cm',
  'sale_channel',
] as const;
export type ProductDataColumn = (typeof PRODUCT_DATA_COLUMNS)[number];

/** GST rates (percent) currently defined in India. */
export const GST_RATES = ['0', '0.25', '1.5', '3', '5', '12', '18', '28', '40'] as const;

const blankToUndefined = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v;

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(blankToUndefined, schema.optional());

/** "2499", "2,499", "2499.5", "2499.50" -> paise (no floating point). */
const rupees = z
  .string()
  .transform((v) => v.replace(/,/g, ''))
  .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), 'must be an amount in rupees, e.g. 2499 or 2499.50')
  .transform((v) => {
    const [whole, fraction = ''] = v.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .refine((paise) => paise > 0 && paise <= 1_00_00_000_00, 'must be between 0.01 and 1,00,00,000');

const wholeNumber = (min: number) =>
  z
    .string()
    .regex(/^\d+$/, 'must be a whole number')
    .transform(Number)
    .refine((n) => n >= min && n <= 1_000_000, `must be between ${min} and 1000000`);

export const productDataRowSchema = z.object({
  sku: z.preprocess(blankToUndefined, z.string({ error: 'is required' }).max(64)),
  productSlug: z.preprocess(blankToUndefined, z.string({ error: 'is required' }).max(200)),
  variantTitle: optional(z.string().max(200)),
  price_inr: optional(rupees),
  compare_at_inr: optional(rupees),
  hsn: optional(z.string().regex(/^(\d{4}|\d{6}|\d{8})$/, 'must be a 4, 6 or 8 digit HSN code')),
  gst_rate: optional(
    z
      .string()
      .transform((v) => v.replace(/%$/, '').replace(/^(\d+)\.0+$/, '$1'))
      .refine((v) => (GST_RATES as readonly string[]).includes(v), {
        message: `must be one of ${GST_RATES.join(', ')}`,
      }),
  ),
  stock: optional(wholeNumber(0)),
  weight_grams: optional(wholeNumber(1)),
  length_cm: optional(wholeNumber(1)),
  width_cm: optional(wholeNumber(1)),
  height_cm: optional(wholeNumber(1)),
  sale_channel: optional(
    z
      .string()
      .transform((v) => v.toUpperCase())
      .pipe(
        z.enum(SaleChannel, { error: `must be one of ${Object.values(SaleChannel).join(', ')}` }),
      ),
  ),
});
export type ProductDataRow = z.infer<typeof productDataRowSchema> & { line: number };

export interface RowError {
  /** 1-based line number in the CSV file (the header is line 1). */
  line: number;
  message: string;
}

const PRODUCT_LEVEL = [
  'compare_at_inr',
  'hsn',
  'gst_rate',
  'weight_grams',
  'length_cm',
  'width_cm',
  'height_cm',
  'sale_channel',
] as const;

/** Parses + validates the CSV text. Returns every error found (never stops at the first). */
export function parseProductData(text: string): { rows: ProductDataRow[]; errors: RowError[] } {
  const errors: RowError[] = [];
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (err) {
    return { rows: [], errors: [{ line: 0, message: (err as Error).message }] };
  }
  if (!table.length) return { rows: [], errors: [{ line: 1, message: 'file is empty' }] };

  const header = table[0].map((h) => h.trim());
  const missing = PRODUCT_DATA_COLUMNS.filter((c) => !header.includes(c));
  const unknown = header.filter((h) => !(PRODUCT_DATA_COLUMNS as readonly string[]).includes(h));
  if (missing.length) errors.push({ line: 1, message: `missing column(s): ${missing.join(', ')}` });
  if (unknown.length) errors.push({ line: 1, message: `unknown column(s): ${unknown.join(', ')}` });
  if (errors.length) return { rows: [], errors };

  const rows: ProductDataRow[] = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    if (cells.length !== header.length) {
      errors.push({ line, message: `expected ${header.length} cells, found ${cells.length}` });
      return;
    }
    const raw = Object.fromEntries(header.map((h, j) => [h, cells[j]]));
    const parsed = productDataRowSchema.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({ line, message: `${issue.path.join('.')}: ${issue.message}` });
      }
      return;
    }
    rows.push({ ...parsed.data, line });
  });

  // ---- cross-row checks ----
  const skuLines = new Map<string, number>();
  for (const row of rows) {
    const first = skuLines.get(row.sku);
    if (first)
      errors.push({ line: row.line, message: `duplicate sku ${row.sku} (first on line ${first})` });
    else skuLines.set(row.sku, row.line);

    if (
      row.price_inr !== undefined &&
      row.compare_at_inr !== undefined &&
      row.compare_at_inr < row.price_inr
    ) {
      errors.push({ line: row.line, message: 'compare_at_inr must be >= price_inr' });
    }
  }
  const byProduct = groupBy(rows, (r) => r.productSlug);
  for (const [slug, productRows] of byProduct) {
    for (const column of PRODUCT_LEVEL) {
      const values = new Map<string, number>();
      for (const row of productRows) {
        const value = row[column];
        if (value !== undefined && !values.has(String(value))) values.set(String(value), row.line);
      }
      if (values.size > 1) {
        const detail = [...values].map(([v, line]) => `"${v}" (line ${line})`).join(' vs ');
        errors.push({
          line: productRows[0].line,
          message: `${column} must be the same on every row of product ${slug}: ${detail}`,
        });
      }
    }
  }
  return { rows, errors };
}

export interface VariantChange {
  variantId: string;
  sku: string;
  price?: number;
  stock?: { from: number; to: number };
}

export interface ProductChange {
  productId: string;
  slug: string;
  data: Prisma.ProductUpdateInput;
  /** Recompute basePrice from variant prices after applying. */
  repriced: boolean;
}

export interface ImportPlan {
  variants: VariantChange[];
  products: ProductChange[];
  errors: RowError[];
}

/** Checks rows against the database and works out what would change. Read-only. */
export async function planProductData(
  prisma: PrismaClient | Prisma.TransactionClient,
  rows: ProductDataRow[],
): Promise<ImportPlan> {
  const errors: RowError[] = [];
  const variants = await prisma.variant.findMany({
    where: { sku: { in: rows.map((r) => r.sku) } },
    select: {
      id: true,
      sku: true,
      price: true,
      stock: true,
      reserved: true,
      product: {
        select: {
          id: true,
          slug: true,
          compareAtPrice: true,
          hsnCode: true,
          gstRate: true,
          weightGrams: true,
          lengthCm: true,
          widthCm: true,
          heightCm: true,
          saleChannel: true,
        },
      },
    },
  });
  const bySku = new Map(variants.map((v) => [v.sku, v]));

  const variantChanges: VariantChange[] = [];
  const productChanges = new Map<string, ProductChange>();
  for (const row of rows) {
    const variant = bySku.get(row.sku);
    if (!variant) {
      errors.push({ line: row.line, message: `unknown sku ${row.sku}` });
      continue;
    }
    if (variant.product.slug !== row.productSlug) {
      errors.push({
        line: row.line,
        message: `sku ${row.sku} belongs to product ${variant.product.slug}, not ${row.productSlug}`,
      });
      continue;
    }
    if (row.stock !== undefined && row.stock < variant.reserved) {
      errors.push({
        line: row.line,
        message: `stock ${row.stock} is below the ${variant.reserved} unit(s) reserved by pending orders`,
      });
      continue;
    }

    const change: VariantChange = { variantId: variant.id, sku: variant.sku };
    if (row.price_inr !== undefined && row.price_inr !== variant.price)
      change.price = row.price_inr;
    if (row.stock !== undefined && row.stock !== variant.stock) {
      change.stock = { from: variant.stock, to: row.stock };
    }
    if (change.price !== undefined || change.stock) variantChanges.push(change);

    const p = variant.product;
    const product = productChanges.get(p.id) ?? {
      productId: p.id,
      slug: p.slug,
      data: {},
      repriced: false,
    };
    const d = product.data;
    if (row.compare_at_inr !== undefined && row.compare_at_inr !== p.compareAtPrice)
      d.compareAtPrice = row.compare_at_inr;
    if (row.hsn !== undefined && row.hsn !== p.hsnCode) d.hsnCode = row.hsn;
    if (row.gst_rate !== undefined && (p.gstRate === null || !p.gstRate.equals(row.gst_rate))) {
      d.gstRate = row.gst_rate;
    }
    if (row.weight_grams !== undefined && row.weight_grams !== p.weightGrams)
      d.weightGrams = row.weight_grams;
    if (row.length_cm !== undefined && row.length_cm !== p.lengthCm) d.lengthCm = row.length_cm;
    if (row.width_cm !== undefined && row.width_cm !== p.widthCm) d.widthCm = row.width_cm;
    if (row.height_cm !== undefined && row.height_cm !== p.heightCm) d.heightCm = row.height_cm;
    if (row.sale_channel !== undefined && row.sale_channel !== p.saleChannel)
      d.saleChannel = row.sale_channel;
    if (change.price !== undefined) product.repriced = true;
    productChanges.set(p.id, product);
  }

  return {
    variants: variantChanges,
    products: [...productChanges.values()].filter((p) => p.repriced || Object.keys(p.data).length),
    errors,
  };
}

export interface ImportResult {
  variantsUpdated: number;
  stockMovements: number;
  productsUpdated: number;
}

/**
 * Validates against the DB and applies everything in one transaction (variant rows locked with
 * FOR UPDATE). Stock changes are logged as InventoryMovement(ADJUST, refId). Throws ImportError
 * (nothing written) if any row fails.
 */
export async function applyProductData(
  prisma: PrismaClient,
  rows: ProductDataRow[],
  opts: { refId: string; actorId?: string | null },
): Promise<ImportResult> {
  return prisma.$transaction(
    async (tx) => {
      const ids = await tx.variant.findMany({
        where: { sku: { in: rows.map((r) => r.sku) } },
        select: { id: true },
      });
      if (ids.length) {
        await tx.$queryRaw`SELECT id FROM "Variant" WHERE id = ANY(${ids.map((v) => v.id)}::text[]) FOR UPDATE`;
      }
      const plan = await planProductData(tx, rows);
      if (plan.errors.length) throw new ImportError(plan.errors);

      let stockMovements = 0;
      for (const change of plan.variants) {
        await tx.variant.update({
          where: { id: change.variantId },
          data: {
            ...(change.price !== undefined && { price: change.price }),
            ...(change.stock && { stock: change.stock.to }),
          },
        });
        if (change.stock) {
          await tx.inventoryMovement.create({
            data: {
              variantId: change.variantId,
              delta: change.stock.to - change.stock.from,
              reason: InventoryReason.ADJUST,
              refId: opts.refId,
              actorId: opts.actorId ?? null,
              note: 'product-data CSV import',
            },
          });
          stockMovements++;
        }
      }
      for (const product of plan.products) {
        const data: Prisma.ProductUpdateInput = { ...product.data };
        if (product.repriced) {
          // basePrice = cheapest active variant ("from" price on listings).
          const cheapest = await tx.variant.aggregate({
            where: { productId: product.productId, isActive: true, price: { not: null } },
            _min: { price: true },
          });
          data.basePrice = cheapest._min.price;
        }
        await tx.product.update({ where: { id: product.productId }, data });
      }
      return {
        variantsUpdated: plan.variants.length,
        stockMovements,
        productsUpdated: plan.products.length,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export class ImportError extends Error {
  constructor(readonly errors: RowError[]) {
    super(`${errors.length} row error(s)`);
  }
}

export function formatErrors(errors: RowError[]): string {
  return [...errors]
    .sort((a, b) => a.line - b.line)
    .map((e) => (e.line ? `  line ${e.line}: ${e.message}` : `  ${e.message}`))
    .join('\n');
}

/** Paise -> rupees string for the CSV: 249900 -> "2499", 249950 -> "2499.50". */
export function paiseToRupees(paise: number | null): string {
  if (paise === null) return '';
  const whole = Math.floor(paise / 100);
  const fraction = paise % 100;
  return fraction ? `${whole}.${String(fraction).padStart(2, '0')}` : String(whole);
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) map.set(key(item), [...(map.get(key(item)) ?? []), item]);
  return map;
}
