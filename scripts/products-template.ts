/**
 * Writes the product-data CSV for every SKU in the database, pre-filled with current values
 * (blank where unknown). Regenerate after the catalog changes:
 *
 *   npm run products:template [-- <out.csv>]     default: prisma/seed/product-data-template.csv
 *
 * The committed template is generated from a freshly seeded DB without placeholder prices.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { toCsv } from '../prisma/seed/lib/csv';
import { PRODUCT_DATA_COLUMNS, paiseToRupees } from '../prisma/seed/lib/product-data';

const DEFAULT_OUT = resolve(__dirname, '..', 'prisma', 'seed', 'product-data-template.csv');

async function main(): Promise<void> {
  const out = resolve(process.argv[2] ?? DEFAULT_OUT);
  const prisma = new PrismaClient();
  try {
    const variants = await prisma.variant.findMany({
      where: { isActive: true },
      include: { product: { include: { category: true } } },
      orderBy: [
        { product: { category: { sortOrder: 'asc' } } },
        { product: { sortOrder: 'asc' } },
        { product: { slug: 'asc' } },
        { sortOrder: 'asc' },
      ],
    });
    const num = (n: number | null) => (n === null ? '' : String(n));
    const rows = variants.map((v) => {
      const p = v.product;
      const values: Record<(typeof PRODUCT_DATA_COLUMNS)[number], string> = {
        sku: v.sku,
        productSlug: p.slug,
        variantTitle: v.title,
        price_inr: paiseToRupees(v.price ?? p.basePrice),
        compare_at_inr: paiseToRupees(p.compareAtPrice),
        hsn: p.hsnCode ?? '',
        gst_rate: p.gstRate === null ? '' : p.gstRate.toString(),
        stock: String(v.stock),
        weight_grams: num(p.weightGrams),
        length_cm: num(p.lengthCm),
        width_cm: num(p.widthCm),
        height_cm: num(p.heightCm),
        sale_channel: p.saleChannel,
      };
      return PRODUCT_DATA_COLUMNS.map((c) => values[c]);
    });
    writeFileSync(out, toCsv([[...PRODUCT_DATA_COLUMNS], ...rows]));
    console.log(`Wrote ${out}: ${rows.length} SKU row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
