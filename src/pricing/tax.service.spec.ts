import { Test } from '@nestjs/testing';
import { AppException } from '../common/exceptions/app.exception';
import { gstinCheckChar, validateGstin } from './gstin';
import { DEFAULT_PRICING_CONFIG, PRICING_CONFIG, type PricingConfig } from './pricing.config';
import { TaxService } from './tax.service';

function makeTax(overrides: Partial<PricingConfig> = {}): TaxService {
  return new TaxService({ ...DEFAULT_PRICING_CONFIG, ...overrides });
}

describe('TaxService', () => {
  const tax = makeTax();

  it('is injectable with PRICING_CONFIG', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [TaxService, { provide: PRICING_CONFIG, useValue: DEFAULT_PRICING_CONFIG }],
    }).compile();
    expect(moduleRef.get(TaxService).businessStateCode).toBe('27');
  });

  describe('taxFromInclusive (prices include GST, ADR-006)', () => {
    it.each([
      [105000, 5, 5000],
      [11800, 18, 1800],
      [11200, 12, 1200],
      [12800, 28, 2800],
      [10250, 2.5, 250],
      [100, 18, 15], // 15.25 → 15
      [59900, 5, 2852], // 2852.38 → 2852
      [0, 18, 0],
      [5000, 0, 0],
      [1, 18, 0], // 0.15 → 0
      [3, 18, 0], // 0.46 → 0
      [4, 18, 1], // 0.61 → 1
    ])('%p paise @ %p%% → %p', (amount, rate, expected) => {
      expect(tax.taxFromInclusive(amount, rate)).toBe(expected);
    });

    it('rounds exact halves up', () => {
      expect(tax.taxFromInclusive(14, 12)).toBe(2); // 14 × 12/112 = 1.5
      expect(tax.taxFromInclusive(16, 28)).toBe(4); // 16 × 28/128 = 3.5
    });

    it('accepts Prisma Decimal-like and string rates', () => {
      expect(tax.taxFromInclusive(11200, { toString: () => '12.00' })).toBe(1200);
      expect(tax.taxFromInclusive(11800, '18')).toBe(1800);
    });

    it('rejects non-integer or negative amounts', () => {
      expect(() => tax.taxFromInclusive(100.5, 5)).toThrow(RangeError);
      expect(() => tax.taxFromInclusive(-1, 5)).toThrow(RangeError);
    });
  });

  describe('taxFromExclusive', () => {
    it.each([
      [1000, 18, 180],
      [25, 18, 5], // 4.5 → 5
      [24, 18, 4], // 4.32 → 4
      [100000, 5, 5000],
      [10000, 2.5, 250],
    ])('%p paise ex-GST @ %p%% → %p', (amount, rate, expected) => {
      expect(tax.taxFromExclusive(amount, rate)).toBe(expected);
    });

    it('inclusive and exclusive agree when the tax is exact', () => {
      const exclusive = 100000;
      const gst = tax.taxFromExclusive(exclusive, 18);
      expect(tax.taxFromInclusive(exclusive + gst, 18)).toBe(gst);
    });
  });

  describe('place of supply', () => {
    it('intra-state when the buyer is in the seller state', () => {
      expect(tax.isInterState('27')).toBe(false);
    });
    it('inter-state otherwise', () => {
      expect(tax.isInterState('29')).toBe(true);
      expect(tax.isInterState('07')).toBe(true);
    });
    it('treats an unknown state (cart preview) as intra-state', () => {
      expect(tax.isInterState(null)).toBe(false);
      expect(tax.isInterState(undefined)).toBe(false);
      expect(tax.isInterState('')).toBe(false);
    });
    it('follows the configured business state', () => {
      expect(makeTax({ businessStateCode: '29' }).isInterState('29')).toBe(false);
      expect(makeTax({ businessStateCode: '29' }).isInterState('27')).toBe(true);
    });
  });

  describe('splitTax', () => {
    it('halves even tax into CGST + SGST', () => {
      expect(tax.splitTax(100, false)).toEqual({ cgst: 50, sgst: 50, igst: 0 });
    });
    it('gives the odd paisa to CGST', () => {
      expect(tax.splitTax(101, false)).toEqual({ cgst: 51, sgst: 50, igst: 0 });
      expect(tax.splitTax(1, false)).toEqual({ cgst: 1, sgst: 0, igst: 0 });
    });
    it('puts everything in IGST inter-state', () => {
      expect(tax.splitTax(101, true)).toEqual({ cgst: 0, sgst: 0, igst: 101 });
    });
    it('handles zero', () => {
      expect(tax.splitTax(0, false)).toEqual({ cgst: 0, sgst: 0, igst: 0 });
    });
  });

  describe('computeInclusive', () => {
    it('returns taxable value + split, intra-state', () => {
      expect(tax.computeInclusive(119800, 5, false)).toEqual({
        amount: 119800,
        taxableValue: 114095,
        tax: 5705,
        rate: 5,
        cgst: 2853,
        sgst: 2852,
        igst: 0,
      });
    });
    it('inter-state', () => {
      expect(tax.computeInclusive(11800, '18.00', true)).toEqual({
        amount: 11800,
        taxableValue: 10000,
        tax: 1800,
        rate: 18,
        cgst: 0,
        sgst: 0,
        igst: 1800,
      });
    });
  });

  describe('resolveRate (slab rule)', () => {
    const slab = (netAmount: number, quantity = 1, hsnCode = '6109') =>
      tax.resolveRate({ hsnCode, gstRate: null, quantity, netAmount });

    it('identifies slab HSN codes by prefix', () => {
      expect(tax.isSlabHsn('6109')).toBe(true);
      expect(tax.isSlabHsn('62034200')).toBe(true);
      expect(tax.isSlabHsn('6306')).toBe(true);
      expect(tax.isSlabHsn('6403 91')).toBe(true);
      expect(tax.isSlabHsn('4202')).toBe(false);
      expect(tax.isSlabHsn('5810')).toBe(false);
      expect(tax.isSlabHsn('')).toBe(false);
      expect(tax.isSlabHsn(null)).toBe(false);
    });

    it('low rate at the boundary: inclusive ₹2,625 = taxable ₹2,500 exactly', () => {
      expect(slab(262500)).toEqual({ rate: 5, source: 'SLAB' });
    });

    it('high rate one paisa above the boundary', () => {
      expect(slab(262501)).toEqual({ rate: 18, source: 'SLAB' });
    });

    it('low rate for cheap items, high for expensive ones', () => {
      expect(slab(59900).rate).toBe(5);
      expect(slab(0).rate).toBe(5);
      expect(slab(300000).rate).toBe(18);
    });

    it('judges the per-unit value for multi-unit lines', () => {
      expect(slab(787500, 3).rate).toBe(5); // 3 × 262500
      expect(slab(787501, 3).rate).toBe(18);
      expect(slab(500000, 4).rate).toBe(5); // 125000 per unit
    });

    it('overrides the product gstRate for slab HSN codes', () => {
      expect(
        tax.resolveRate({ hsnCode: '6109', gstRate: 12, quantity: 1, netAmount: 1000 }),
      ).toEqual({ rate: 5, source: 'SLAB' });
    });

    it('uses the product gstRate for non-slab HSN codes', () => {
      expect(
        tax.resolveRate({
          hsnCode: '5810',
          gstRate: { toString: () => '12.00' },
          quantity: 1,
          netAmount: 1,
        }),
      ).toEqual({ rate: 12, source: 'PRODUCT' });
      expect(tax.resolveRate({ hsnCode: null, gstRate: 0, quantity: 1, netAmount: 1 })).toEqual({
        rate: 0,
        source: 'PRODUCT',
      });
    });

    it('falls back to the default rate', () => {
      expect(
        tax.resolveRate({ hsnCode: '4202', gstRate: null, quantity: 1, netAmount: 1 }),
      ).toEqual({
        rate: 18,
        source: 'DEFAULT',
      });
      expect(
        tax.resolveRate({ hsnCode: null, gstRate: undefined, quantity: 1, netAmount: 1 }),
      ).toEqual({ rate: 18, source: 'DEFAULT' });
    });

    it('is config-driven (old ₹1,000 / 5% / 12% rule)', () => {
      const old = makeTax({ slabThresholdPaise: 100000, slabLowRate: 5, slabHighRate: 12 });
      const r = (net: number) =>
        old.resolveRate({ hsnCode: '6109', gstRate: null, quantity: 1, netAmount: net });
      expect(r(105000).rate).toBe(5);
      expect(r(105001).rate).toBe(12);
      const custom = makeTax({ slabHsnPrefixes: ['4202'] });
      expect(custom.isSlabHsn('6109')).toBe(false);
      expect(custom.isSlabHsn('42021210')).toBe(true);
    });

    it('rejects a bad quantity for slab lines', () => {
      expect(() => slab(100, 0)).toThrow(RangeError);
    });
  });

  describe('GSTIN', () => {
    it.each(['27AAPFU0939F1ZV', '29AAGCB7383J1Z4', '33AAACH7409R1Z8', '24AAACC1206D1ZM'])(
      'accepts %s',
      (gstin) => {
        expect(tax.validateGstin(gstin)).toEqual({
          valid: true,
          gstin,
          stateCode: gstin.slice(0, 2),
          pan: gstin.slice(2, 12),
        });
      },
    );

    it('computes the check character', () => {
      expect(gstinCheckChar('27AAPFU0939F1Z')).toBe('V');
      expect(() => gstinCheckChar('27aapfu0939f1z')).toThrow(RangeError);
    });

    it('normalises case and whitespace', () => {
      const r = validateGstin('  27aapfu0939f1zv ');
      expect(r).toMatchObject({ valid: true, gstin: '27AAPFU0939F1ZV' });
    });

    it.each([
      ['27AAPFU0939F1Z', 'FORMAT'],
      ['27AAPFU0939F1ZVX', 'FORMAT'],
      ['27AAPFU0939F1XV', 'FORMAT'], // 14th char must be Z
      ['27AAPF10939F1ZV', 'FORMAT'],
      ['', 'FORMAT'],
      ['27AAPFU0939F1ZW', 'CHECKSUM'],
      ['25AAPFU0939F1ZV', 'STATE_CODE'], // 25 merged into 26
      ['99AAPFU0939F1ZV', 'STATE_CODE'],
      ['00AAPFU0939F1ZV', 'STATE_CODE'],
    ])('rejects %s (%s)', (gstin, reason) => {
      expect(tax.validateGstin(gstin)).toMatchObject({ valid: false, reason });
    });

    it('checks the expected state', () => {
      expect(tax.validateGstin('27AAPFU0939F1ZV', '27').valid).toBe(true);
      expect(tax.validateGstin('27AAPFU0939F1ZV', '29')).toMatchObject({
        valid: false,
        reason: 'STATE_MISMATCH',
      });
    });

    it('assertValidGstin returns the normalised GSTIN or throws 422 INVALID_GSTIN', () => {
      expect(tax.assertValidGstin('27aapfu0939f1zv')).toBe('27AAPFU0939F1ZV');
      try {
        tax.assertValidGstin('27AAPFU0939F1ZW');
        fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(AppException);
        const err = e as AppException;
        expect(err.code).toBe('INVALID_GSTIN');
        expect(err.getStatus()).toBe(422);
        expect(err.details).toEqual({ reason: 'CHECKSUM' });
      }
    });
  });
});
