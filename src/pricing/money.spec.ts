import { allocate, assertPaise, bpToRate, divRoundHalfUp, rateToBp } from './money';

describe('money helpers', () => {
  describe('divRoundHalfUp', () => {
    it.each([
      [10n, 4n, 3n], // 2.5 → 3 (half up)
      [9n, 4n, 2n], // 2.25 → 2
      [11n, 4n, 3n], // 2.75 → 3
      [8n, 4n, 2n], // exact
      [0n, 7n, 0n],
      [1n, 2n, 1n], // 0.5 → 1
      [1n, 3n, 0n],
    ])('%p / %p = %p', (n, d, expected) => {
      expect(divRoundHalfUp(n, d)).toBe(expected);
    });

    it('rejects bad operands', () => {
      expect(() => divRoundHalfUp(1n, 0n)).toThrow(RangeError);
      expect(() => divRoundHalfUp(-1n, 2n)).toThrow(RangeError);
    });
  });

  describe('rateToBp / bpToRate', () => {
    it.each([
      [5, 500],
      [18, 1800],
      [2.5, 250],
      [0.25, 25],
      ['12.00', 1200],
      [{ toString: () => '28.00' }, 2800],
      [0, 0],
    ])('%p → %p bp', (rate, bp) => {
      expect(rateToBp(rate)).toBe(bp);
    });

    it('rejects negative, non-numeric and >2-decimal rates', () => {
      expect(() => rateToBp(-1)).toThrow(RangeError);
      expect(() => rateToBp('abc')).toThrow(RangeError);
      expect(() => rateToBp(5.125)).toThrow(RangeError);
    });

    it('bpToRate inverts', () => expect(bpToRate(250)).toBe(2.5));
  });

  describe('assertPaise', () => {
    it('accepts non-negative integers', () => expect(() => assertPaise(0, 'x')).not.toThrow());
    it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects %p', (v) => {
      expect(() => assertPaise(v, 'x')).toThrow(RangeError);
    });
  });

  describe('allocate (largest remainder)', () => {
    it('splits evenly with the odd paisa to the earliest line', () => {
      expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    });

    it('gives remainders to the largest fractional parts', () => {
      expect(allocate(10000, [33333, 33333, 33334])).toEqual([3333, 3333, 3334]);
    });

    it('is proportional when exact', () => {
      expect(allocate(6000, [40000, 20000])).toEqual([4000, 2000]);
    });

    it('gives nothing to zero-weight lines', () => {
      expect(allocate(500, [0, 1000, 0])).toEqual([0, 500, 0]);
    });

    it('handles zero amount and all-zero weights', () => {
      expect(allocate(0, [10, 20])).toEqual([0, 0]);
      expect(allocate(0, [0, 0])).toEqual([0, 0]);
      expect(allocate(0, [])).toEqual([]);
      expect(() => allocate(1, [0, 0])).toThrow(RangeError);
    });

    it('always sums exactly, even with huge values (BigInt intermediates)', () => {
      const weights = [9_999_999_999, 1, 7_777_777_777, 3];
      const shares = allocate(1_234_567_891, weights);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(1_234_567_891);
      shares.forEach((s) => expect(Number.isInteger(s)).toBe(true));
    });
  });
});
