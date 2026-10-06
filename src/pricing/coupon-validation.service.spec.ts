import { AppException } from '../common/exceptions/app.exception';
import { type CouponRules, CouponValidationService } from './coupon-validation.service';

const NOW = new Date('2026-10-07T12:00:00.000Z');

function makeCoupon(overrides: Partial<CouponRules> = {}): CouponRules {
  return {
    code: 'SAVE10',
    type: 'PERCENT',
    value: 10,
    minSubtotal: null,
    maxDiscount: null,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    perUserLimit: null,
    usedCount: 0,
    isActive: true,
    ...overrides,
  };
}

describe('CouponValidationService', () => {
  const svc = new CouponValidationService();
  const ctx = (subtotal = 100000, customerUsageCount: number | null = 0) => ({
    subtotal,
    customerUsageCount,
    now: NOW,
  });

  describe('discount', () => {
    it('PERCENT: floor(subtotal × pct)', () => {
      expect(svc.validate(makeCoupon(), ctx(100000))).toEqual({
        valid: true,
        code: 'SAVE10',
        type: 'PERCENT',
        discount: 10000,
        freeShipping: false,
      });
      expect(svc.validate(makeCoupon(), ctx(99999))).toMatchObject({ discount: 9999 }); // 9999.9 ↓
      expect(svc.validate(makeCoupon({ value: 15 }), ctx(333))).toMatchObject({ discount: 49 }); // 49.95 ↓
    });

    it('PERCENT: capped by maxDiscount', () => {
      const c = makeCoupon({ value: 20, maxDiscount: 15000 });
      expect(svc.validate(c, ctx(100000))).toMatchObject({ discount: 15000 });
      expect(svc.validate(c, ctx(50000))).toMatchObject({ discount: 10000 });
      expect(svc.validate(c, ctx(75000))).toMatchObject({ discount: 15000 }); // exactly at cap
    });

    it('PERCENT 100 discounts the whole subtotal', () => {
      expect(svc.validate(makeCoupon({ value: 100 }), ctx(49900))).toMatchObject({
        discount: 49900,
      });
    });

    it('FLAT: value, never more than the subtotal', () => {
      const c = makeCoupon({ code: 'FLAT200', type: 'FLAT', value: 20000 });
      expect(svc.validate(c, ctx(100000))).toMatchObject({ discount: 20000 });
      expect(svc.validate(c, ctx(15000))).toMatchObject({ discount: 15000 });
    });

    it('FLAT ignores maxDiscount (cap is for PERCENT)', () => {
      const c = makeCoupon({ type: 'FLAT', value: 20000, maxDiscount: 100 });
      expect(svc.validate(c, ctx(100000))).toMatchObject({ discount: 20000 });
    });

    it('FREE_SHIPPING: no discount, freeShipping flag', () => {
      expect(svc.validate(makeCoupon({ type: 'FREE_SHIPPING', value: 0 }), ctx(100))).toMatchObject(
        {
          valid: true,
          discount: 0,
          freeShipping: true,
        },
      );
    });

    it('zero subtotal → zero discount', () => {
      expect(svc.validate(makeCoupon(), ctx(0))).toMatchObject({ valid: true, discount: 0 });
      expect(svc.validate(makeCoupon({ type: 'FLAT', value: 500 }), ctx(0))).toMatchObject({
        discount: 0,
      });
    });
  });

  describe('eligibility', () => {
    it('inactive', () => {
      expect(svc.validate(makeCoupon({ isActive: false }), ctx())).toMatchObject({
        valid: false,
        reason: 'COUPON_INACTIVE',
      });
    });

    it('start date is inclusive', () => {
      expect(svc.validate(makeCoupon({ startsAt: NOW }), ctx()).valid).toBe(true);
      expect(
        svc.validate(makeCoupon({ startsAt: new Date(NOW.getTime() + 1) }), ctx()),
      ).toMatchObject({ valid: false, reason: 'COUPON_NOT_STARTED' });
    });

    it('end date is exclusive', () => {
      expect(svc.validate(makeCoupon({ endsAt: new Date(NOW.getTime() + 1) }), ctx()).valid).toBe(
        true,
      );
      expect(svc.validate(makeCoupon({ endsAt: NOW }), ctx())).toMatchObject({
        valid: false,
        reason: 'COUPON_EXPIRED',
        details: { endsAt: NOW.toISOString() },
      });
    });

    it('defaults now to the current time', () => {
      const past = makeCoupon({ endsAt: new Date('2000-01-01T00:00:00Z') });
      expect(svc.validate(past, { subtotal: 1, customerUsageCount: 0 })).toMatchObject({
        reason: 'COUPON_EXPIRED',
      });
    });

    it('total usage limit', () => {
      expect(svc.validate(makeCoupon({ usageLimit: 5, usedCount: 4 }), ctx()).valid).toBe(true);
      expect(svc.validate(makeCoupon({ usageLimit: 5, usedCount: 5 }), ctx())).toMatchObject({
        reason: 'COUPON_USAGE_LIMIT_REACHED',
      });
    });

    it('per-customer limit', () => {
      const c = makeCoupon({ perUserLimit: 1 });
      expect(svc.validate(c, ctx(100000, 0)).valid).toBe(true);
      expect(svc.validate(c, ctx(100000, 1))).toMatchObject({
        reason: 'COUPON_PER_CUSTOMER_LIMIT_REACHED',
        details: { perUserLimit: 1 },
      });
    });

    it('per-customer limit needs a known customer', () => {
      expect(svc.validate(makeCoupon({ perUserLimit: 2 }), ctx(100000, null))).toMatchObject({
        reason: 'COUPON_LOGIN_REQUIRED',
      });
      // No per-customer limit → guests are fine.
      expect(svc.validate(makeCoupon(), ctx(100000, null)).valid).toBe(true);
    });

    it('min subtotal is inclusive', () => {
      const c = makeCoupon({ minSubtotal: 50000 });
      expect(svc.validate(c, ctx(50000)).valid).toBe(true);
      expect(svc.validate(c, ctx(49999))).toMatchObject({
        valid: false,
        reason: 'COUPON_MIN_SUBTOTAL_NOT_MET',
        details: { minSubtotal: 50000, shortBy: 1 },
      });
    });

    it('reports the first failing rule', () => {
      const c = makeCoupon({ isActive: false, endsAt: NOW, minSubtotal: 1e9 });
      expect(svc.validate(c, ctx())).toMatchObject({ reason: 'COUPON_INACTIVE' });
    });
  });

  describe('assertValid', () => {
    it('returns the valid result', () => {
      expect(svc.assertValid(makeCoupon(), ctx(1000)).discount).toBe(100);
    });

    it('throws a 422 AppException with the reason as code', () => {
      try {
        svc.assertValid(makeCoupon({ minSubtotal: 50000 }), ctx(100));
        fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        const err = e as AppException;
        expect(err.code).toBe('COUPON_MIN_SUBTOTAL_NOT_MET');
        expect(err.getStatus()).toBe(422);
        expect(err.details).toEqual({ minSubtotal: 50000, shortBy: 49900 });
      }
    });
  });

  it('rejects a non-integer subtotal', () => {
    expect(() => svc.validate(makeCoupon(), ctx(10.5))).toThrow(RangeError);
  });
});
