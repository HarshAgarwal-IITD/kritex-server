import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { type GstinValidation, validateGstin } from './gstin';
import { assertPaise, bpToRate, divRoundHalfUp, rateToBp } from './money';
import { PRICING_CONFIG, type PricingConfig } from './pricing.config';

export type GstRateInput = number | string | { toString(): string };

export interface TaxSplit {
  cgst: number;
  sgst: number;
  igst: number;
}

export interface InclusiveTax extends TaxSplit {
  /** Amount the tax was taken out of (GST-inclusive), paise. */
  amount: number;
  /** amount - tax, paise. */
  taxableValue: number;
  /** cgst + sgst + igst, paise. */
  tax: number;
  /** Percent, e.g. 5. */
  rate: number;
}

export type GstRateSource = 'SLAB' | 'PRODUCT' | 'DEFAULT';

export interface ResolvedRate {
  /** Percent, e.g. 18. */
  rate: number;
  source: GstRateSource;
}

/**
 * GST rules (ADR-006). Prices are GST-inclusive; tax is "taken out" of an amount, not added.
 *
 * - Rate: HSN codes matching a slab prefix (apparel/made-ups/footwear) get the low rate when the
 *   **per-unit taxable value** (ex-GST, after discounts) is <= the threshold, else the high rate.
 *   Other products use their own `gstRate`, else the configured default.
 * - Tax in an inclusive amount A at rate r: round_half_up(A × r / (100 + r)) paise.
 * - Place of supply = shipping state. Same as the seller's state → CGST + SGST (half each; an odd
 *   paisa goes to CGST), otherwise IGST. No address yet (cart preview) → intra-state.
 */
@Injectable()
export class TaxService {
  constructor(@Inject(PRICING_CONFIG) private readonly config: PricingConfig) {}

  get businessStateCode(): string {
    return this.config.businessStateCode;
  }

  /** true → IGST. Unknown buyer state (null) is treated as intra-state (preview only). */
  isInterState(buyerStateCode: string | null | undefined): boolean {
    return !!buyerStateCode && buyerStateCode !== this.config.businessStateCode;
  }

  isSlabHsn(hsnCode: string | null | undefined): boolean {
    const hsn = hsnCode?.replace(/\s+/g, '') ?? '';
    return hsn.length > 0 && this.config.slabHsnPrefixes.some((p) => hsn.startsWith(p));
  }

  /**
   * Rate for `quantity` units whose combined GST-inclusive value (after discounts) is `netAmount`.
   *
   * Slab test with inclusive prices: the unit is in the low slab iff its taxable value at the low
   * rate is within the threshold, i.e. netAmount / (1 + low) <= threshold × quantity. Done in exact
   * integer arithmetic.
   */
  resolveRate(input: {
    hsnCode: string | null | undefined;
    gstRate: GstRateInput | null | undefined;
    quantity: number;
    netAmount: number;
  }): ResolvedRate {
    if (this.isSlabHsn(input.hsnCode)) {
      if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
        throw new RangeError('quantity must be a positive integer');
      }
      assertPaise(input.netAmount, 'netAmount');
      const lowBp = BigInt(rateToBp(this.config.slabLowRate));
      const withinLow =
        BigInt(input.netAmount) * 10000n <=
        BigInt(this.config.slabThresholdPaise) * BigInt(input.quantity) * (10000n + lowBp);
      return {
        rate: withinLow ? this.config.slabLowRate : this.config.slabHighRate,
        source: 'SLAB',
      };
    }
    if (input.gstRate !== null && input.gstRate !== undefined) {
      return { rate: bpToRate(rateToBp(input.gstRate)), source: 'PRODUCT' };
    }
    return { rate: this.config.defaultGstRate, source: 'DEFAULT' };
  }

  /** GST contained in a GST-inclusive amount, rounded half-up to the paisa. */
  taxFromInclusive(amount: number, rate: GstRateInput): number {
    assertPaise(amount, 'amount');
    const bp = BigInt(rateToBp(rate));
    return Number(divRoundHalfUp(BigInt(amount) * bp, 10000n + bp));
  }

  /** GST to add on top of an exclusive (taxable) amount, rounded half-up to the paisa. */
  taxFromExclusive(amount: number, rate: GstRateInput): number {
    assertPaise(amount, 'amount');
    return Number(divRoundHalfUp(BigInt(amount) * BigInt(rateToBp(rate)), 10000n));
  }

  /** Split a tax amount into CGST/SGST (intra-state; odd paisa → CGST) or IGST. */
  splitTax(tax: number, interState: boolean): TaxSplit {
    assertPaise(tax, 'tax');
    if (interState) return { cgst: 0, sgst: 0, igst: tax };
    const cgst = Math.ceil(tax / 2);
    return { cgst, sgst: tax - cgst, igst: 0 };
  }

  /** Tax breakdown of a GST-inclusive amount. */
  computeInclusive(amount: number, rate: GstRateInput, interState: boolean): InclusiveTax {
    const tax = this.taxFromInclusive(amount, rate);
    return {
      amount,
      taxableValue: amount - tax,
      tax,
      rate: bpToRate(rateToBp(rate)),
      ...this.splitTax(tax, interState),
    };
  }

  validateGstin(gstin: string, expectedStateCode?: string | null): GstinValidation {
    return validateGstin(gstin, expectedStateCode);
  }

  /** Returns the normalised GSTIN or throws 422 `INVALID_GSTIN` (details.reason). */
  assertValidGstin(gstin: string, expectedStateCode?: string | null): string {
    const result = validateGstin(gstin, expectedStateCode);
    if (!result.valid) {
      throw new AppException('INVALID_GSTIN', HttpStatus.UNPROCESSABLE_ENTITY, result.message, {
        reason: result.reason,
      });
    }
    return result.gstin;
  }
}
