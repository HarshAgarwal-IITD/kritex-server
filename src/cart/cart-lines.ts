import type { SaleChannel } from '../common/dto/enums';
import { MAX_LINE_QUANTITY } from './dto/cart.dto';

export type CartLineIssue =
  'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'UNAVAILABLE' | 'NOT_PURCHASABLE';

/** What the issue rules need about a variant (and its product / category). */
export interface LineFacts {
  variantActive: boolean;
  productStatus: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  categoryActive: boolean;
  saleChannel: SaleChannel;
  /** Variant.price ?? Product.basePrice (paise), null = unpriced. */
  price: number | null;
  stock: number;
  reserved: number;
}

/** Units that can still be sold (on hand minus held by unpaid orders), never negative. */
export function availableUnits(facts: Pick<LineFacts, 'stock' | 'reserved'>): number {
  return Math.max(0, facts.stock - facts.reserved);
}

/** Can this viewer buy the product at all (sale channel + a price)? ADR-011. */
export function isPurchasable(
  facts: Pick<LineFacts, 'saleChannel' | 'price'>,
  isB2BApproved: boolean,
): boolean {
  if (facts.price === null) return false;
  return facts.saleChannel === 'RETAIL' || (facts.saleChannel === 'B2B_ONLY' && isB2BApproved);
}

/** Variant, product and category are all live. */
export function isAvailable(
  facts: Pick<LineFacts, 'variantActive' | 'productStatus' | 'categoryActive'>,
): boolean {
  return facts.variantActive && facts.productStatus === 'ACTIVE' && facts.categoryActive;
}

/**
 * The single issue shown on a cart line, most severe first:
 * UNAVAILABLE > NOT_PURCHASABLE > OUT_OF_STOCK > INSUFFICIENT_STOCK.
 */
export function lineIssue(
  facts: LineFacts,
  quantity: number,
  isB2BApproved: boolean,
): CartLineIssue | null {
  if (!isAvailable(facts)) return 'UNAVAILABLE';
  if (!isPurchasable(facts, isB2BApproved)) return 'NOT_PURCHASABLE';
  const available = availableUnits(facts);
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available < quantity) return 'INSUFFICIENT_STOCK';
  return null;
}

/**
 * Quantity of a line after merging a guest cart into the user's cart (COM-2): the sum, capped at
 * 999 and at the available stock, but never below what either cart already had on its own (so a
 * merge never silently shrinks a line; the line shows an issue instead).
 */
export function mergedQuantity(userQty: number, guestQty: number, available: number): number {
  const sum = Math.min(MAX_LINE_QUANTITY, userQty + guestQty);
  const floor = Math.min(MAX_LINE_QUANTITY, Math.max(userQty, guestQty));
  return Math.max(floor, Math.min(sum, available));
}

/** First image linked to one of the variant's option values, else the first unlinked/any image. */
export function pickLineImage<T extends { variantOptionValue: string | null }>(
  images: readonly T[],
  options: Record<string, string>,
): T | null {
  const values = new Set(Object.values(options));
  return (
    images.find((image) => image.variantOptionValue && values.has(image.variantOptionValue)) ??
    images.find((image) => image.variantOptionValue === null) ??
    images[0] ??
    null
  );
}
