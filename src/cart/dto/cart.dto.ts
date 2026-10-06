import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { idSchema, imageSchema } from '../../common/dto/common';
import { couponTypeSchema, saleChannelSchema } from '../../common/dto/enums';
import { moneySchema, totalsSchema } from '../../common/dto/money';

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
] as const;
export const cartLineIssueSchema = z.enum(CART_LINE_ISSUES).meta({
  description:
    'OUT_OF_STOCK: nothing available · INSUFFICIENT_STOCK: fewer available than requested · ' +
    'UNAVAILABLE: variant/product inactive or archived · NOT_PURCHASABLE: sale channel does not allow this viewer to buy',
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
  unitPrice: moneySchema.meta({ description: 'Live GST-inclusive unit price (B2B tiers applied)' }),
  quantity: z.number().int().min(1),
  lineTotal: moneySchema,
  inStock: z.boolean(),
  issue: cartLineIssueSchema.nullable(),
});

export const appliedCouponSchema = z.object({
  code: z.string(),
  type: couponTypeSchema,
});

export const cartSchema = z.object({
  id: z.string(),
  items: z.array(cartLineSchema),
  itemCount: z.number().int().nonnegative().meta({ description: 'Sum of quantities' }),
  coupon: appliedCouponSchema.nullable(),
  totals: totalsSchema.meta({
    description:
      'Preview. Shipping is the flat-rate estimate; the tax split assumes intra-state (CGST+SGST) until an address is given at checkout.',
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

/** Cookie that identifies a guest cart (httpOnly, SameSite=Lax, 30 days). */
export const GUEST_CART_COOKIE = 'kritex_cart';
