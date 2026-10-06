import { totalsSchema } from '../common/dto/money';
import { type CouponRules, CouponValidationService } from './coupon-validation.service';
import { DEFAULT_PRICING_CONFIG, type PricingConfig } from './pricing.config';
import { ShippingFeeService } from './shipping-fee.service';
import { TaxService } from './tax.service';
import {
  type PricingCustomer,
  type PricingLineInput,
  type PricingResult,
  TotalsService,
} from './totals.service';

// Defaults: seller state 27, apparel slab ₹2,500 taxable (5% / 18%), default 18%,
// shipping ₹99 flat, free from ₹999.
function makeService(overrides: Partial<PricingConfig> = {}): TotalsService {
  const config = { ...DEFAULT_PRICING_CONFIG, ...overrides };
  return new TotalsService(
    new TaxService(config),
    new ShippingFeeService(config),
    new CouponValidationService(),
  );
}

const NOW = new Date('2026-10-07T12:00:00.000Z');
const SAME_STATE = { stateCode: '27' };
const OTHER_STATE = { stateCode: '29' };
const GUEST: PricingCustomer = null;
const RETAIL: PricingCustomer = { id: 'u1', isB2BApproved: false };
const B2B: PricingCustomer = { id: 'b1', isB2BApproved: true };

function line(overrides: Partial<PricingLineInput> = {}): PricingLineInput {
  return {
    variantId: 'v-tee',
    productId: 'p-tee',
    quantity: 1,
    unitPrice: 59900,
    hsnCode: '6109',
    gstRate: null,
    ...overrides,
  };
}

function coupon(overrides: Partial<CouponRules> = {}, customerUsageCount: number | null = 0) {
  return {
    coupon: {
      code: 'SAVE10',
      type: 'PERCENT' as const,
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
    },
    customerUsageCount,
  };
}

/** Invariants every result must satisfy. */
function expectConsistent(r: PricingResult): void {
  const t = r.totals;
  expect(totalsSchema.parse(t)).toEqual(t);
  expect(t.total).toBe(t.subtotal - t.discount + t.shipping);
  expect(t.taxTotal).toBe(t.cgst + t.sgst + t.igst);
  expect(t.subtotal).toBe(r.lines.reduce((s, l) => s + l.lineTotal, 0));
  expect(t.discount).toBe(r.lines.reduce((s, l) => s + l.discount, 0));
  expect(t.taxTotal).toBe(r.lines.reduce((s, l) => s + l.taxAmount, 0) + r.shipping.taxAmount);
  expect(t.shipping).toBe(r.shipping.fee);
  if (r.interState) expect(t.cgst + t.sgst).toBe(0);
  else expect(t.igst).toBe(0);
  for (const l of r.lines) {
    expect(l.lineTotal).toBe(l.unitPrice * l.quantity);
    expect(l.netTotal).toBe(l.lineTotal - l.discount);
    expect(l.taxableValue + l.taxAmount).toBe(l.netTotal);
    expect(l.cgst + l.sgst + l.igst).toBe(l.taxAmount);
    expect(l.cgst - l.sgst).toBeGreaterThanOrEqual(0);
    expect(l.cgst - l.sgst).toBeLessThanOrEqual(1);
  }
}

describe('TotalsService.compute', () => {
  const svc = makeService();
  const compute = (...args: Parameters<TotalsService['compute']>) => {
    const r = svc.compute(args[0], args[1], args[2], args[3], args[4] ?? { now: NOW });
    expectConsistent(r);
    return r;
  };

  describe('tax-inclusive pricing (ADR-006)', () => {
    it('intra-state: CGST + SGST, GST is inside the total (not added)', () => {
      const r = compute([line({ quantity: 2 })], SAME_STATE, null, GUEST);
      expect(r.interState).toBe(false);
      expect(r.totals).toEqual({
        subtotal: 119800,
        discount: 0,
        shipping: 0, // >= ₹999
        taxTotal: 5705, // 119800 × 5/105 = 5704.76 → 5705
        cgst: 2853,
        sgst: 2852,
        igst: 0,
        total: 119800,
        currency: 'INR',
      });
      expect(r.lines[0]).toMatchObject({
        unitPrice: 59900,
        listUnitPrice: 59900,
        lineTotal: 119800,
        discount: 0,
        netTotal: 119800,
        taxableValue: 114095,
        gstRate: 5,
        gstRateSource: 'SLAB',
        taxAmount: 5705,
        priceTierMinQty: null,
      });
    });

    it('inter-state: IGST only, same total', () => {
      const r = compute([line({ quantity: 2 })], OTHER_STATE, null, GUEST);
      expect(r.interState).toBe(true);
      expect(r.totals).toMatchObject({
        total: 119800,
        taxTotal: 5705,
        cgst: 0,
        sgst: 0,
        igst: 5705,
      });
    });

    it('no address yet (cart preview) assumes intra-state', () => {
      const r = compute([line({ quantity: 2 })], null, null, GUEST);
      expect(r.interState).toBe(false);
      expect(r.totals.igst).toBe(0);
    });

    it('rounds tax per line, half-up to the paisa', () => {
      const r = compute(
        [
          line({ variantId: 'a', unitPrice: 14, hsnCode: '5810', gstRate: 12 }), // 1.5 → 2
          line({ variantId: 'b', unitPrice: 14, hsnCode: '5810', gstRate: 12 }), // 1.5 → 2
        ],
        OTHER_STATE,
        null,
        GUEST,
      );
      expect(r.lines.map((l) => l.taxAmount)).toEqual([2, 2]);
      // Shipping ₹99 @ 12% = 1060.71 → 1061
      expect(r.shipping).toMatchObject({ fee: 9900, gstRate: 12, taxAmount: 1061 });
      expect(r.totals.taxTotal).toBe(1065);
    });
  });

  describe('slab rule', () => {
    it('picks 5% / 18% per line by unit value and taxes shipping at the highest line rate', () => {
      const r = compute(
        [
          line({ variantId: 'tee', unitPrice: 40000 }), // 6109 → 5%
          line({
            variantId: 'patch',
            productId: 'p-patch',
            unitPrice: 20000,
            hsnCode: '5810',
            gstRate: '12.00',
          }),
        ],
        SAME_STATE,
        null,
        GUEST,
      );
      expect(r.lines.map((l) => [l.gstRate, l.gstRateSource, l.taxAmount])).toEqual([
        [5, 'SLAB', 1905], // 1904.76
        [12, 'PRODUCT', 2143], // 2142.86
      ]);
      expect(r.shipping).toEqual({
        fee: 9900,
        freeReason: null,
        amountToFreeShipping: 39900,
        gstRate: 12,
        taxAmount: 1061,
        cgst: 531,
        sgst: 530,
        igst: 0,
      });
      expect(r.totals).toMatchObject({
        subtotal: 60000,
        shipping: 9900,
        total: 69900,
        taxTotal: 5109,
        cgst: 953 + 1072 + 531,
        sgst: 952 + 1071 + 530,
      });
    });

    it('boundary: ₹2,625.00 inclusive → 5%, ₹2,625.01 → 18%', () => {
      const at = compute([line({ unitPrice: 262500, hsnCode: '6201' })], SAME_STATE, null, GUEST);
      expect(at.lines[0]).toMatchObject({ gstRate: 5, taxAmount: 12500, taxableValue: 250000 });
      const above = compute(
        [line({ unitPrice: 262501, hsnCode: '6201' })],
        SAME_STATE,
        null,
        GUEST,
      );
      expect(above.lines[0]).toMatchObject({ gstRate: 18, taxAmount: 40043 }); // 40042.53 → 40043
    });

    it('uses the per-unit value, not the line value', () => {
      const r = compute(
        [line({ unitPrice: 200000, quantity: 5, hsnCode: '6403' })],
        SAME_STATE,
        null,
        GUEST,
      );
      expect(r.lines[0].gstRate).toBe(5);
    });

    it('a coupon that brings the unit value under the slab lowers the rate', () => {
      const jacket = line({ unitPrice: 270000, hsnCode: '6201' });
      expect(compute([jacket], SAME_STATE, null, GUEST).lines[0].gstRate).toBe(18);
      const r = compute([jacket], SAME_STATE, coupon({ type: 'FLAT', value: 10000 }), GUEST);
      expect(r.lines[0]).toMatchObject({ netTotal: 260000, gstRate: 5, taxAmount: 12381 }); // 12380.95
    });

    it('defaults to 18% for non-slab products without a rate', () => {
      const r = compute([line({ hsnCode: '4202', unitPrice: 118000 })], SAME_STATE, null, GUEST);
      expect(r.lines[0]).toMatchObject({ gstRate: 18, gstRateSource: 'DEFAULT', taxAmount: 18000 });
    });
  });

  describe('coupons', () => {
    it('allocates a percent discount across lines in proportion and taxes the net', () => {
      const r = compute(
        [
          line({ variantId: 'tee', unitPrice: 40000 }),
          line({
            variantId: 'patch',
            productId: 'p-patch',
            unitPrice: 20000,
            hsnCode: '5810',
            gstRate: 12,
          }),
        ],
        SAME_STATE,
        coupon(),
        RETAIL,
      );
      expect(r.coupon).toMatchObject({ valid: true, discount: 6000 });
      expect(r.lines.map((l) => [l.discount, l.netTotal, l.taxAmount])).toEqual([
        [4000, 36000, 1714], // 1714.29
        [2000, 18000, 1929], // 1928.57
      ]);
      expect(r.totals).toMatchObject({
        subtotal: 60000,
        discount: 6000,
        shipping: 9900,
        total: 63900,
        taxTotal: 1714 + 1929 + 1061,
      });
    });

    it('allocation is exact to the paisa (largest remainder)', () => {
      const lines = ['a', 'b', 'c'].map((id) => line({ variantId: id, unitPrice: 33333 }));
      const r = compute(lines, SAME_STATE, coupon({ type: 'FLAT', value: 100 }), GUEST);
      expect(r.lines.map((l) => l.discount)).toEqual([34, 33, 33]);
      expect(r.totals.discount).toBe(100);
    });

    it('FLAT larger than the subtotal is capped; shipping still charged', () => {
      const r = compute(
        [line({ unitPrice: 5000 })],
        SAME_STATE,
        coupon({ type: 'FLAT', value: 10000 }),
        GUEST,
      );
      expect(r.totals).toMatchObject({
        subtotal: 5000,
        discount: 5000,
        shipping: 9900,
        total: 9900,
      });
      expect(r.lines[0]).toMatchObject({ netTotal: 0, taxAmount: 0 });
      expect(r.shipping).toMatchObject({ gstRate: 5, taxAmount: 471 }); // 471.43
    });

    it('free-shipping threshold is judged after the discount', () => {
      const lines = [line({ unitPrice: 100000 })];
      expect(compute(lines, SAME_STATE, null, GUEST).totals.shipping).toBe(0);
      const r = compute(lines, SAME_STATE, coupon({ type: 'FLAT', value: 200 }), GUEST);
      expect(r.totals).toMatchObject({ discount: 200, shipping: 9900, total: 109700 });
      expect(r.shipping.amountToFreeShipping).toBe(100);
    });

    it('FREE_SHIPPING coupon waives the fee without a discount', () => {
      const r = compute(
        [line({ unitPrice: 49900 })],
        OTHER_STATE,
        coupon({ type: 'FREE_SHIPPING', value: 0 }),
        GUEST,
      );
      expect(r.totals).toMatchObject({ subtotal: 49900, discount: 0, shipping: 0, total: 49900 });
      expect(r.shipping).toMatchObject({ freeReason: 'COUPON', taxAmount: 0 });
    });

    it('an invalid coupon is reported but not applied', () => {
      const r = compute([line()], SAME_STATE, coupon({ minSubtotal: 100000 }), GUEST);
      expect(r.coupon).toMatchObject({ valid: false, reason: 'COUPON_MIN_SUBTOTAL_NOT_MET' });
      expect(r.totals.discount).toBe(0);
    });

    it('per-customer-limited coupons need a known customer', () => {
      const r = compute([line()], SAME_STATE, coupon({ perUserLimit: 1 }, null), GUEST);
      expect(r.coupon).toMatchObject({ valid: false, reason: 'COUPON_LOGIN_REQUIRED' });
      const ok = compute([line()], SAME_STATE, coupon({ perUserLimit: 1 }, 0), RETAIL);
      expect(ok.coupon?.valid).toBe(true);
    });

    it('validates dates against options.now', () => {
      const c = coupon({ endsAt: new Date('2026-10-01T00:00:00Z') });
      expect(compute([line()], SAME_STATE, c, GUEST, { now: NOW }).coupon).toMatchObject({
        reason: 'COUPON_EXPIRED',
      });
      expect(
        compute([line()], SAME_STATE, c, GUEST, { now: new Date('2026-09-01T00:00:00Z') }).coupon
          ?.valid,
      ).toBe(true);
    });

    it('min subtotal is checked against the B2B-tier subtotal', () => {
      const tiers = [{ minQty: 10, unitPrice: 50000 }];
      const lines = [line({ quantity: 10, priceTiers: tiers })]; // retail 599000, B2B 500000
      const c = coupon({ minSubtotal: 550000 });
      expect(compute(lines, SAME_STATE, c, RETAIL).coupon?.valid).toBe(true);
      expect(compute(lines, SAME_STATE, c, B2B).coupon).toMatchObject({
        reason: 'COUPON_MIN_SUBTOTAL_NOT_MET',
      });
    });
  });

  describe('B2B price tiers', () => {
    const tiers = [
      { minQty: 50, unitPrice: 45000 },
      { minQty: 10, unitPrice: 50000 },
    ];

    it('only for approved B2B customers', () => {
      const lines = [line({ quantity: 10, priceTiers: tiers })];
      expect(compute(lines, SAME_STATE, null, GUEST).lines[0].unitPrice).toBe(59900);
      expect(compute(lines, SAME_STATE, null, RETAIL).lines[0].unitPrice).toBe(59900);
      const r = compute(lines, SAME_STATE, null, B2B);
      expect(r.b2bPricingApplied).toBe(true);
      expect(r.lines[0]).toMatchObject({
        listUnitPrice: 59900,
        unitPrice: 50000,
        priceTierMinQty: 10,
        lineTotal: 500000,
      });
      expect(r.totals.subtotal).toBe(500000);
    });

    it('tier boundaries: minQty is inclusive, highest reachable tier wins', () => {
      const at = (q: number) =>
        compute([line({ quantity: q, priceTiers: tiers })], SAME_STATE, null, B2B).lines[0];
      expect(at(9)).toMatchObject({ unitPrice: 59900, priceTierMinQty: null });
      expect(at(10)).toMatchObject({ unitPrice: 50000, priceTierMinQty: 10 });
      expect(at(49)).toMatchObject({ unitPrice: 50000 });
      expect(at(50)).toMatchObject({ unitPrice: 45000, priceTierMinQty: 50 });
    });

    it('sums quantity across variants of the same product', () => {
      const r = compute(
        [
          line({ variantId: 'tee-m', quantity: 6, priceTiers: tiers }),
          line({ variantId: 'tee-l', quantity: 5, priceTiers: tiers }),
          line({
            variantId: 'cap',
            productId: 'p-cap',
            quantity: 5,
            unitPrice: 30000,
            hsnCode: '6505',
            priceTiers: [{ minQty: 10, unitPrice: 1 }],
          }),
        ],
        SAME_STATE,
        null,
        B2B,
      );
      expect(r.lines.map((l) => l.unitPrice)).toEqual([50000, 50000, 30000]);
    });

    it('never charges more than the list price', () => {
      const r = compute(
        [line({ quantity: 20, priceTiers: [{ minQty: 10, unitPrice: 70000 }] })],
        SAME_STATE,
        null,
        B2B,
      );
      expect(r.lines[0]).toMatchObject({ unitPrice: 59900, priceTierMinQty: null });
      expect(r.b2bPricingApplied).toBe(false);
    });

    it('tax and slab use the tier price', () => {
      const r = compute(
        [
          line({
            unitPrice: 300000,
            hsnCode: '6201',
            quantity: 10,
            priceTiers: [{ minQty: 10, unitPrice: 250000 }],
          }),
        ],
        OTHER_STATE,
        null,
        B2B,
      );
      expect(r.lines[0]).toMatchObject({ unitPrice: 250000, gstRate: 5, taxAmount: 119048 }); // 2.5M/21 = 119047.6
      expect(r.totals.igst).toBe(119048);
    });
  });

  describe('edge cases', () => {
    it('empty cart → all zero', () => {
      const r = compute([], SAME_STATE, coupon(), GUEST);
      expect(r.totals).toEqual({
        subtotal: 0,
        discount: 0,
        shipping: 0,
        taxTotal: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        total: 0,
        currency: 'INR',
      });
      expect(r.shipping.freeReason).toBe('EMPTY');
    });

    it('below threshold: shipping fee is GST-inclusive and taxed inter-state as IGST', () => {
      const r = compute([line({ unitPrice: 49900 })], OTHER_STATE, null, GUEST);
      expect(r.totals).toEqual({
        subtotal: 49900,
        discount: 0,
        shipping: 9900,
        taxTotal: 2376 + 471,
        cgst: 0,
        sgst: 0,
        igst: 2847,
        total: 59800,
        currency: 'INR',
      });
    });

    it('free shipping exactly at the threshold', () => {
      expect(compute([line({ unitPrice: 99900 })], SAME_STATE, null, GUEST).totals.shipping).toBe(
        0,
      );
      expect(compute([line({ unitPrice: 99899 })], SAME_STATE, null, GUEST).totals.shipping).toBe(
        9900,
      );
    });

    it('zero-priced line', () => {
      const r = compute([line({ unitPrice: 0 })], SAME_STATE, coupon(), GUEST);
      expect(r.totals).toMatchObject({ subtotal: 0, discount: 0, shipping: 9900, total: 9900 });
    });

    it('rejects invalid input', () => {
      expect(() => svc.compute([line({ quantity: 0 })], null, null, null)).toThrow(RangeError);
      expect(() => svc.compute([line({ quantity: 1.5 })], null, null, null)).toThrow(RangeError);
      expect(() => svc.compute([line({ unitPrice: 99.5 })], null, null, null)).toThrow(RangeError);
      expect(() => svc.compute([line({ unitPrice: -1 })], null, null, null)).toThrow(RangeError);
      expect(() =>
        svc.compute([line({ priceTiers: [{ minQty: 0, unitPrice: 1 }] })], null, null, B2B),
      ).toThrow(RangeError);
    });

    it('respects config (different seller state and shipping)', () => {
      const custom = makeService({
        businessStateCode: '29',
        shippingFlatFeePaise: 5000,
        shippingFreeThresholdPaise: 200000,
      });
      const r = custom.compute([line({ unitPrice: 100000 })], OTHER_STATE, null, GUEST);
      expectConsistent(r);
      expect(r.interState).toBe(false);
      expect(r.totals).toMatchObject({ shipping: 5000, total: 105000, igst: 0 });
    });
  });

  it('invariants hold for random carts', () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    const hsns = ['6109', '6201', '6403', '4202', '5810', null];
    const coupons = [
      null,
      coupon(),
      coupon({ value: 33, maxDiscount: 25000 }),
      coupon({ type: 'FLAT', value: 12345 }),
      coupon({ type: 'FREE_SHIPPING', value: 0 }),
    ];
    for (let i = 0; i < 300; i++) {
      const n = rand(5);
      const lines = Array.from({ length: n }, (_, j) =>
        line({
          variantId: `v${j}`,
          productId: `p${rand(3)}`,
          quantity: 1 + rand(60),
          unitPrice: rand(400000),
          hsnCode: hsns[rand(hsns.length)],
          gstRate: rand(2) ? [0, 5, 12, 18, 28][rand(5)] : null,
          priceTiers: rand(2) ? [{ minQty: 10, unitPrice: rand(300000) }] : [],
        }),
      );
      const r = compute(
        lines,
        rand(2) ? SAME_STATE : OTHER_STATE,
        coupons[rand(coupons.length)],
        [GUEST, RETAIL, B2B][rand(3)],
      );
      for (const l of r.lines) expect([0, 5, 12, 18, 28]).toContain(l.gstRate);
    }
  });
});
