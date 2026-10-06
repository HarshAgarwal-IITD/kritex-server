import { z } from 'zod';
import type { SaleChannel } from '../common/dto/enums';

/** Shared mapping helpers for catalog rows → DTOs (public and admin). */

const specsSchema = z.array(z.object({ label: z.string(), value: z.string() }));
const swatchesSchema = z.record(z.string(), z.string());
const variantOptionsSchema = z.record(z.string(), z.string());

/** `Product.specs` JSON → `[{label, value}]`; anything malformed is dropped. */
export function parseSpecs(raw: unknown): { label: string; value: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = specsSchema.element.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

/** `ProductOption.swatches` JSON → `{ value: url }` or null. */
export function parseSwatches(raw: unknown): Record<string, string> | null {
  if (raw === null || raw === undefined) return null;
  const parsed = swatchesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** `Variant.options` JSON → `{ name: value }` ({} if malformed). */
export function parseVariantOptions(raw: unknown): Record<string, string> {
  const parsed = variantOptionsSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

/** Variant price override, else the product base price (paise). Null = unpriced. */
export function effectivePrice(
  variantPrice: number | null,
  basePrice: number | null,
): number | null {
  return variantPrice ?? basePrice ?? null;
}

/** Public price: ENQUIRY_ONLY products never show a price (ADR-011). */
export function publicPrice(
  saleChannel: SaleChannel,
  variantPrice: number | null,
  basePrice: number | null,
): number | null {
  if (saleChannel === 'ENQUIRY_ONLY') return null;
  return effectivePrice(variantPrice, basePrice);
}

/** `{min, max}` of the non-null prices, or null when none are priced. */
export function priceRange(prices: (number | null)[]): { min: number; max: number } | null {
  const priced = prices.filter((price): price is number => price !== null);
  if (priced.length === 0) return null;
  return { min: Math.min(...priced), max: Math.max(...priced) };
}

/** Prisma `Decimal | null` → number | null. */
export function decimalToNumber(value: { toString(): string } | null): number | null {
  return value === null ? null : Number(value.toString());
}

/** Escapes `%`, `_` and `\` for a SQL LIKE pattern (default escape char `\`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
