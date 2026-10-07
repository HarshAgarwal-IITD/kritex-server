import { HttpStatus } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { CartLineIssue } from './checkout.types';
import { AppException } from '../common/exceptions/app.exception';
import type { PricingLineInput } from '../pricing';

type Db = Prisma.TransactionClient;

/**
 * Reads the cart rows straight from Prisma for checkout. (The cart module's CartService is built in
 * parallel; this keeps checkout self-contained until the two are unified.)
 */
export const checkoutCartInclude = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      variant: {
        include: {
          product: {
            include: {
              priceTiers: { select: { minQty: true, unitPrice: true } },
              category: { select: { isActive: true } },
              images: {
                orderBy: { sortOrder: 'asc' },
                select: { url: true, variantOptionValue: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CheckoutCart = Prisma.CartGetPayload<{ include: typeof checkoutCartInclude }>;
export type CheckoutCartItem = CheckoutCart['items'][number];

export interface CheckoutOwner {
  userId?: string;
  /** Guest cart token from the `kritex_cart` cookie. Ignored for signed-in users. */
  guestToken?: string;
}

export function findCheckoutCart(db: Db, owner: CheckoutOwner): Promise<CheckoutCart | null> {
  if (owner.userId) {
    return db.cart.findUnique({ where: { userId: owner.userId }, include: checkoutCartInclude });
  }
  if (owner.guestToken) {
    return db.cart.findUnique({
      where: { guestToken: owner.guestToken },
      include: checkoutCartInclude,
    });
  }
  return Promise.resolve(null);
}

export const cartEmpty = () =>
  new AppException('CART_EMPTY', HttpStatus.UNPROCESSABLE_ENTITY, 'Your cart is empty');

/** Retail unit price (GST-inclusive paise) or null when the product has no price. */
export function listUnitPrice(item: CheckoutCartItem): number | null {
  return item.variant.price ?? item.variant.product.basePrice ?? null;
}

/**
 * Why a line can't be bought as-is. `available` (stock - reserved) is passed in so placeOrder can
 * use the values it read under `FOR UPDATE`.
 */
export function lineIssue(
  item: CheckoutCartItem,
  isB2BApproved: boolean,
  available: number,
): CartLineIssue | null {
  const { variant } = item;
  const { product } = variant;
  if (!variant.isActive || product.status !== 'ACTIVE' || !product.category.isActive) {
    return 'UNAVAILABLE';
  }
  if (
    product.saleChannel === 'ENQUIRY_ONLY' ||
    (product.saleChannel === 'B2B_ONLY' && !isB2BApproved) ||
    listUnitPrice(item) === null
  ) {
    return 'NOT_PURCHASABLE';
  }
  if (available <= 0) return 'OUT_OF_STOCK';
  if (available < item.quantity) return 'INSUFFICIENT_STOCK';
  return null;
}

export function toPricingLine(item: CheckoutCartItem): PricingLineInput {
  const { product } = item.variant;
  return {
    variantId: item.variantId,
    productId: product.id,
    quantity: item.quantity,
    unitPrice: listUnitPrice(item) ?? 0,
    hsnCode: product.hsnCode,
    gstRate: product.gstRate,
    priceTiers: product.priceTiers,
  };
}
