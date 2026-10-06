import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema, queryBooleanSchema } from '../../common/dto/common';
import { couponTypeSchema } from '../../common/dto/enums';
import { moneySchema } from '../../common/dto/money';
import { paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';

export const couponSchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  type: couponTypeSchema,
  value: z.number().int().nonnegative().meta({
    description: 'PERCENT: whole percent 1-100 · FLAT: paise · FREE_SHIPPING: 0',
  }),
  minSubtotal: moneySchema.nullable(),
  maxDiscount: moneySchema.nullable().meta({ description: 'Cap for PERCENT coupons, paise' }),
  startsAt: isoDateTimeSchema.nullable(),
  endsAt: isoDateTimeSchema.nullable(),
  usageLimit: z.number().int().positive().nullable(),
  perUserLimit: z.number().int().positive().nullable(),
  usedCount: z.number().int().nonnegative(),
  isActive: z.boolean(),
  createdAt: isoDateTimeSchema,
});
export class CouponDto extends createZodDto(couponSchema) {}
export class CouponListDto extends createZodDto(paginatedSchema(couponSchema)) {}

export const listCouponsQuerySchema = z.object({
  q: z.string().trim().min(1).max(32).optional(),
  isActive: queryBooleanSchema.optional(),
  ...paginationQueryShape,
});
export class ListCouponsQueryDto extends createZodDto(listCouponsQuerySchema) {}

const couponFields = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, 'Code: 3-32 chars, A-Z 0-9 _ -'),
  description: z.string().trim().max(200).nullable().optional(),
  type: couponTypeSchema,
  value: z.number().int().nonnegative(),
  minSubtotal: moneySchema.nullable().optional(),
  maxDiscount: moneySchema.nullable().optional(),
  startsAt: isoDateTimeSchema.nullable().optional(),
  endsAt: isoDateTimeSchema.nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  perUserLimit: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().default(true),
});

type CouponFieldsInput = Partial<z.infer<typeof couponFields>>;

function checkCoupon(value: CouponFieldsInput, ctx: z.RefinementCtx) {
  if (value.type === 'PERCENT' && value.value !== undefined && (value.value < 1 || value.value > 100))
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'PERCENT value must be 1-100' });
  if (value.type === 'FLAT' && value.value !== undefined && value.value < 1)
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'FLAT value must be > 0 paise' });
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt)
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'endsAt must be after startsAt' });
}

export const createCouponSchema = couponFields.superRefine(checkCoupon);
export class CreateCouponDto extends createZodDto(createCouponSchema) {}

/** Partial update; the service re-validates the merged coupon (type/value consistency). */
export const updateCouponSchema = couponFields
  .partial()
  .extend({ isActive: z.boolean().optional() })
  .superRefine(checkCoupon);
export class UpdateCouponDto extends createZodDto(updateCouponSchema) {}
