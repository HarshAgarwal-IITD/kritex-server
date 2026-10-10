import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { idSchema, imageSchema } from '../../common/dto/common';
import { couponTypeSchema, saleChannelSchema } from '../../common/dto/enums';
import { moneySchema, totalsSchema } from '../../common/dto/money';
import { COUPON_ERROR_CODES } from '../../pricing/coupon-validation.service';

export const MAX_LINE_QUANTITY = 999;

/**
 * Why a cart line can't be checked out as-is. The cart keeps the line; checkout rejects it with
 * 409/422 until the customer fixes it.
 */
export const CART_LINE_ISSUES = [
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
  'UNAVAILABLE',
  'NOT_PURCHASABLE',
  'QUANTITY_LIMIT',
] as const;
export const cartLineIssueSchema = z.enum(CART_LINE_ISSUES).meta({
  description:
    'OUT_OF_STOCK: nothing available · INSUFFICIENT_STOCK: fewer available than requested · ' +
    'UNAVAILABLE: variant/product inactive or archived · NOT_PURCHASABLE: sale channel does not allow this viewer to buy · ' +
    'QUANTITY_LIMIT: more than the per-item limit for retail customers (RL-2; request a quote for more)',
});

export const cartLineSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  variantTitle: z.string(),
  sku: z.string(),
  options: z.record(z.string(), z.string()),
  image: imageSchema.nullable(),
  saleChannel: saleChannelSchema,
  unitPrice: moneySchema.meta({
    description:
      'Live GST-inclusive unit price (B2B tiers applied). 0 when the product has no public price (ENQUIRY_ONLY / unpriced)',
  }),
  quantity: z.number().int().min(1),
  lineTotal: moneySchema,
  inStock: z.boolean(),
  issue: cartLineIssueSchema.nullable(),
});

/** Why a stored coupon is not applied right now (COUPON_NOT_FOUND never appears here). */
export const couponInvalidReasonSchema = z.enum(
  COUPON_ERROR_CODES.filter((code) => code !== 'COUPON_NOT_FOUND') as [
    Exclude<(typeof COUPON_ERROR_CODES)[number], 'COUPON_NOT_FOUND'>,
    ...Exclude<(typeof COUPON_ERROR_CODES)[number], 'COUPON_NOT_FOUND'>[],
  ],
);

export const appliedCouponSchema = z.object({
  code: z.string(),
  type: couponTypeSchema,
  valid: z.boolean().meta({
    description:
      'false when the coupon no longer applies (e.g. the subtotal dropped below its minimum); totals then carry no discount',
  }),
  invalidReason: couponInvalidReasonSchema.nullable(),
  message: z.string().nullable().meta({ description: 'Customer-facing reason when not valid' }),
});

export const cartSchema = z.object({
  id: z.string(),
  items: z.array(cartLineSchema),
  itemCount: z.number().int().nonnegative().meta({ description: 'Sum of quantities' }),
  coupon: appliedCouponSchema.nullable(),
  totals: totalsSchema.meta({
    description:
      'Preview. Shipping is the flat-rate estimate; the tax split assumes intra-state (CGST+SGST) until an address is given at checkout. ' +
      'Only lines without an `issue` are included.',
  }),
  hasIssues: z.boolean().meta({ description: 'Any line has an issue' }),
  updatedAt: z.iso.datetime(),
});
export type Cart = z.infer<typeof cartSchema>;
export class CartDto extends createZodDto(cartSchema) {}

export const addCartItemSchema = z.object({
  variantId: idSchema,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
});
export class AddCartItemDto extends createZodDto(addCartItemSchema) {}

export const updateCartItemSchema = z.object({
  quantity: z
    .number()
    .int()
    .min(0)
    .max(MAX_LINE_QUANTITY)
    .meta({ description: '0 removes the line' }),
});
export class UpdateCartItemDto extends createZodDto(updateCartItemSchema) {}

export const cartVariantParamSchema = z.object({ variantId: idSchema });
export class CartVariantParamDto extends createZodDto(cartVariantParamSchema) {}

export const applyCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(32),
});
export class ApplyCouponDto extends createZodDto(applyCouponSchema) {}

/** Cookie that identifies a guest cart (httpOnly, SameSite=Lax, CART_GUEST_TTL_DAYS, default 30). */
export const GUEST_CART_COOKIE = 'kritex_cart';
