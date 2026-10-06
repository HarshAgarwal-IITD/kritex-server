/**
 * Applies the product-data CSV (prices, HSN, GST, stock, weights, sale channel) to the database.
 *
 *   npm run import:products -- <file.csv> [--dry-run]
 *
 * Every row is validated first (all errors are reported with line numbers); then everything is
 * applied in a single transaction, or nothing is. Stock changes write InventoryMovement(ADJUST).
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  ImportError,
  applyProductData,
  formatErrors,
  paiseToRupees,
  parseProductData,
  planProductData,
} from '../prisma/seed/lib/product-data';

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: npm run import:products -- <file.csv> [--dry-run]');
    return 2;
  }

  const { rows, errors } = parseProductData(readFileSync(resolve(file), 'utf8'));
  if (errors.length) {
    console.error(`${file}: ${errors.length} error(s), nothing imported:\n${formatErrors(errors)}`);
    return 1;
  }

  const prisma = new PrismaClient();
  try {
    const plan = await planProductData(prisma, rows);
    if (plan.errors.length) {
      console.error(
        `${file}: ${plan.errors.length} error(s), nothing imported:\n${formatErrors(plan.errors)}`,
      );
      return 1;
    }
    console.log(`${file}: ${rows.length} row(s) valid.`);
    for (const v of plan.variants) {
      const parts = [];
      if (v.price !== undefined) parts.push(`price -> Rs ${paiseToRupees(v.price)}`);
      if (v.stock) parts.push(`stock ${v.stock.from} -> ${v.stock.to}`);
      console.log(`  ${v.sku}: ${parts.join(', ')}`);
    }
    for (const p of plan.products) {
      const fields = Object.keys(p.data).concat(p.repriced ? ['basePrice'] : []);
      console.log(`  product ${p.slug}: ${fields.join(', ')}`);
    }
    console.log(
      `Plan: ${plan.variants.length} variant(s), ${plan.products.length} product(s) to update.`,
    );
    if (dryRun) {
      console.log('Dry run: no changes written.');
      return 0;
    }
    const result = await applyProductData(prisma, rows, {
      refId: `import:${basename(file)}:${new Date().toISOString()}`,
    });
    console.log(
      `Imported: ${result.variantsUpdated} variant(s), ${result.productsUpdated} product(s), ${result.stockMovements} stock movement(s).`,
    );
    return 0;
  } catch (err) {
    if (err instanceof ImportError) {
      console.error(`${file}: nothing imported:\n${formatErrors(err.errors)}`);
      return 1;
    }
    throw err;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
