import { HttpStatus, Injectable } from '@nestjs/common';
import type { CouponType } from '../common/dto/enums';
import { AppException } from '../common/exceptions/app.exception';
import { assertPaise } from './money';

/** The coupon fields the rules need (a Prisma `Coupon` row satisfies this). */
export interface CouponRules {
  code: string;
  type: CouponType;
  /** PERCENT: whole percent 1-100. FLAT: paise. FREE_SHIPPING: ignored. */
  value: number;
  minSubtotal: number | null;
  /** Cap for PERCENT coupons, paise. */
  maxDiscount: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perUserLimit: number | null;
  /** Redemptions so far (all customers). */
  usedCount: number;
  isActive: boolean;
}

export interface CouponUsageContext {
  /** Merchandise subtotal the coupon applies to (GST-inclusive, after B2B tiers), paise. */
  subtotal: number;
  /**
   * Previous redemptions by this customer, as counted by the caller (orders with this coupon).
   * null = identity unknown (guest cart): coupons with a per-customer limit are then refused
   * with COUPON_LOGIN_REQUIRED. Callers may pass a count keyed by e-mail for guests instead.
   */
  customerUsageCount: number | null;
  now?: Date;
}

/** Error codes (422). COUPON_NOT_FOUND is for callers that look the code up. */
export const COUPON_ERROR_CODES = [
  'COUPON_NOT_FOUND',
  'COUPON_INACTIVE',
  'COUPON_NOT_STARTED',
  'COUPON_EXPIRED',
  'COUPON_USAGE_LIMIT_REACHED',
  'COUPON_LOGIN_REQUIRED',
  'COUPON_PER_CUSTOMER_LIMIT_REACHED',
  'COUPON_MIN_SUBTOTAL_NOT_MET',
] as const;
export type CouponErrorCode = (typeof COUPON_ERROR_CODES)[number];

export type CouponValidation =
  | {
      valid: true;
      code: string;
      type: CouponType;
      /** Discount on the merchandise subtotal, paise (0 for FREE_SHIPPING). */
      discount: number;
      freeShipping: boolean;
    }
  | {
      valid: false;
      code: string;
      type: CouponType;
      reason: Exclude<CouponErrorCode, 'COUPON_NOT_FOUND'>;
      message: string;
      details?: Record<string, unknown>;
    };

/**
 * Coupon rules (PR-3). Pure: usage counts come in as inputs; nothing is read or written here.
 *
 * Checks, in order: active → started (`startsAt <= now`) → not ended (`now < endsAt`, end is
 * exclusive) → total usage (`usedCount < usageLimit`) → per-customer usage → min subtotal
 * (`subtotal >= minSubtotal`). Discount: PERCENT = floor(subtotal × value / 100) capped at
 * maxDiscount; FLAT = value; both capped at the subtotal. FREE_SHIPPING gives no discount but
 * waives the shipping fee.
 */
@Injectable()
export class CouponValidationService {
  validate(coupon: CouponRules, ctx: CouponUsageContext): CouponValidation {
    assertPaise(ctx.subtotal, 'subtotal');
    const now = ctx.now ?? new Date();
    const fail = (
      reason: Exclude<CouponErrorCode, 'COUPON_NOT_FOUND'>,
      message: string,
      details?: Record<string, unknown>,
    ): CouponValidation => ({
      valid: false,
      code: coupon.code,
      type: coupon.type,
      reason,
      message,
      ...(details ? { details } : {}),
    });

    if (!coupon.isActive) return fail('COUPON_INACTIVE', 'This coupon is not active');
    if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
      return fail('COUPON_NOT_STARTED', 'This coupon is not valid yet', {
        startsAt: coupon.startsAt.toISOString(),
      });
    }
    if (coupon.endsAt && now.getTime() >= coupon.endsAt.getTime()) {
      return fail('COUPON_EXPIRED', 'This coupon has expired', {
        endsAt: coupon.endsAt.toISOString(),
      });
    }
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      return fail('COUPON_USAGE_LIMIT_REACHED', 'This coupon has been fully redeemed');
    }
    if (coupon.perUserLimit !== null) {
      if (ctx.customerUsageCount === null) {
        return fail('COUPON_LOGIN_REQUIRED', 'Sign in to use this coupon');
      }
      if (ctx.customerUsageCount >= coupon.perUserLimit) {
        return fail(
          'COUPON_PER_CUSTOMER_LIMIT_REACHED',
          'You have already used this coupon the maximum number of times',
          { perUserLimit: coupon.perUserLimit },
        );
      }
    }
    if (coupon.minSubtotal !== null && ctx.subtotal < coupon.minSubtotal) {
      return fail('COUPON_MIN_SUBTOTAL_NOT_MET', 'Your order does not meet the coupon minimum', {
        minSubtotal: coupon.minSubtotal,
        shortBy: coupon.minSubtotal - ctx.subtotal,
      });
    }
    return {
      valid: true,
      code: coupon.code,
      type: coupon.type,
      discount: this.computeDiscount(coupon, ctx.subtotal),
      freeShipping: coupon.type === 'FREE_SHIPPING',
    };
  }

  /** Same as `validate` but throws 422 `AppException(reason)` when the coupon is not usable. */
  assertValid(
    coupon: CouponRules,
    ctx: CouponUsageContext,
  ): Extract<CouponValidation, { valid: true }> {
    const result = this.validate(coupon, ctx);
    if (!result.valid) {
      throw new AppException(
        result.reason,
        HttpStatus.UNPROCESSABLE_ENTITY,
        result.message,
        result.details,
      );
    }
    return result;
  }

  /** Discount (paise) the coupon gives on `subtotal`, ignoring eligibility checks. */
  computeDiscount(coupon: Pick<CouponRules, 'type' | 'value' | 'maxDiscount'>, subtotal: number) {
    assertPaise(subtotal, 'subtotal');
    let discount: number;
    switch (coupon.type) {
      case 'PERCENT': {
        const pct = Math.min(Math.max(coupon.value, 0), 100);
        discount = Number((BigInt(subtotal) * BigInt(pct)) / 100n); // floor
        if (coupon.maxDiscount !== null) discount = Math.min(discount, coupon.maxDiscount);
        break;
      }
      case 'FLAT':
        discount = Math.max(coupon.value, 0);
        break;
      case 'FREE_SHIPPING':
        discount = 0;
        break;
    }
    return Math.min(discount, subtotal);
  }
}
