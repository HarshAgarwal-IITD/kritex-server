/**
 * Integer-paise arithmetic for the pricing module.
 *
 * Rounding rules (documented once, used everywhere):
 * - Every amount is an integer number of paise. Intermediate products/quotients are done in
 *   BigInt so they are exact, then rounded once.
 * - Tax is rounded **half-up to the nearest paisa, per line** (`divRoundHalfUp`). Order-level tax
 *   figures are the sum of the rounded line figures, so an invoice's lines always add up.
 * - Percentage coupon discounts are rounded **down** (`floor`) so a discount never exceeds the
 *   advertised percentage.
 * - An order-level amount spread over lines (coupon discount) uses the largest-remainder method
 *   (`allocate`): the shares always sum to exactly the amount.
 * - GST rates are handled as integer basis points (5% = 500 bp, 2.5% = 250 bp).
 */

export function assertPaise(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer number of paise (got ${value})`);
  }
}

/** round(numerator / denominator), halves rounded up. Both must be non-negative. */
export function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n || numerator < 0n) throw new RangeError('divRoundHalfUp: invalid operands');
  return (2n * numerator + denominator) / (2n * denominator);
}

/** Percent (e.g. 18, "12.00", Prisma Decimal) → integer basis points. Max 2 decimals. */
export function rateToBp(rate: number | string | { toString(): string }): number {
  const n = typeof rate === 'number' ? rate : Number(rate.toString());
  const bp = Math.round(n * 100);
  if (!Number.isFinite(n) || n < 0 || Math.abs(n * 100 - bp) > 1e-6) {
    throw new RangeError(`Invalid GST rate: ${String(rate)}`);
  }
  return bp;
}

/** Basis points → percent number (500 → 5, 250 → 2.5). */
export function bpToRate(bp: number): number {
  return bp / 100;
}

/**
 * Split `amount` across `weights` proportionally (largest-remainder method). Shares sum to exactly
 * `amount`; ties in the remainder go to the earlier index. All-zero weights → all-zero shares
 * (amount must then be 0).
 */
export function allocate(amount: number, weights: readonly number[]): number[] {
  assertPaise(amount, 'amount');
  weights.forEach((w, i) => assertPaise(w, `weights[${i}]`));
  const total = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (total === 0n) {
    if (amount !== 0) throw new RangeError('Cannot allocate a non-zero amount over zero weights');
    return weights.map(() => 0);
  }
  const amt = BigInt(amount);
  const shares = weights.map((w) => (amt * BigInt(w)) / total);
  const remainders = weights.map((w, i) => ({ i, r: (amt * BigInt(w)) % total }));
  let left = amt - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const { i } of remainders) {
    if (left === 0n) break;
    shares[i] += 1n;
    left -= 1n;
  }
  return shares.map(Number);
}
