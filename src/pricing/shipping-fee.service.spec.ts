import { DEFAULT_PRICING_CONFIG } from './pricing.config';
import { ShippingFeeService } from './shipping-fee.service';

describe('ShippingFeeService', () => {
  const svc = new ShippingFeeService(DEFAULT_PRICING_CONFIG); // ₹99 flat, free from ₹999

  it('exposes the configured values', () => {
    expect(svc.flatFee).toBe(9900);
    expect(svc.freeThreshold).toBe(99900);
  });

  it('charges the flat fee below the threshold', () => {
    expect(svc.compute({ merchandiseTotal: 49900, hasItems: true })).toEqual({
      fee: 9900,
      freeReason: null,
      amountToFreeShipping: 50000,
    });
  });

  it('is free exactly at the threshold', () => {
    expect(svc.compute({ merchandiseTotal: 99900, hasItems: true })).toEqual({
      fee: 0,
      freeReason: 'THRESHOLD',
      amountToFreeShipping: null,
    });
  });

  it('charges one paisa below the threshold', () => {
    expect(svc.compute({ merchandiseTotal: 99899, hasItems: true })).toMatchObject({
      fee: 9900,
      amountToFreeShipping: 1,
    });
  });

  it('is free above the threshold', () => {
    expect(svc.compute({ merchandiseTotal: 500000, hasItems: true }).fee).toBe(0);
  });

  it('a FREE_SHIPPING coupon waives the fee', () => {
    expect(
      svc.compute({ merchandiseTotal: 100, hasItems: true, freeShippingCoupon: true }),
    ).toEqual({ fee: 0, freeReason: 'COUPON', amountToFreeShipping: null });
  });

  it('reports THRESHOLD over COUPON when both apply', () => {
    expect(
      svc.compute({ merchandiseTotal: 99900, hasItems: true, freeShippingCoupon: true }).freeReason,
    ).toBe('THRESHOLD');
  });

  it('charges a fee even when a 100% discount makes the merchandise free', () => {
    expect(svc.compute({ merchandiseTotal: 0, hasItems: true }).fee).toBe(9900);
  });

  it('charges nothing for an empty cart', () => {
    expect(svc.compute({ merchandiseTotal: 0, hasItems: false })).toEqual({
      fee: 0,
      freeReason: 'EMPTY',
      amountToFreeShipping: null,
    });
  });

  it('threshold 0 = always free; fee 0 = always free', () => {
    const alwaysFree = new ShippingFeeService({
      ...DEFAULT_PRICING_CONFIG,
      shippingFreeThresholdPaise: 0,
    });
    expect(alwaysFree.compute({ merchandiseTotal: 1, hasItems: true }).fee).toBe(0);
    const noFee = new ShippingFeeService({ ...DEFAULT_PRICING_CONFIG, shippingFlatFeePaise: 0 });
    expect(noFee.compute({ merchandiseTotal: 1, hasItems: true }).fee).toBe(0);
  });

  it('rejects non-integer amounts', () => {
    expect(() => svc.compute({ merchandiseTotal: 1.5, hasItems: true })).toThrow(RangeError);
  });
});
