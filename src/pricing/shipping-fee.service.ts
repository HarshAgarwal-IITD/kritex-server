import { Inject, Injectable } from '@nestjs/common';
import { assertPaise } from './money';
import { PRICING_CONFIG, type PricingConfig } from './pricing.config';

export type FreeShippingReason = 'EMPTY' | 'THRESHOLD' | 'COUPON';

export interface ShippingFee {
  /** GST-inclusive fee, paise. */
  fee: number;
  /** Why the fee is 0 (null when charged). */
  freeReason: FreeShippingReason | null;
  /** How much more merchandise (paise) would make shipping free; null when already free. */
  amountToFreeShipping: number | null;
}

/**
 * v1 shipping pricing (ADR-005): a flat fee, free when the merchandise total **after discount**
 * is >= the threshold, or when a FREE_SHIPPING coupon applies. An empty cart ships for 0.
 * A threshold of 0 means shipping is always free.
 */
@Injectable()
export class ShippingFeeService {
  constructor(@Inject(PRICING_CONFIG) private readonly config: PricingConfig) {}

  get flatFee(): number {
    return this.config.shippingFlatFeePaise;
  }

  get freeThreshold(): number {
    return this.config.shippingFreeThresholdPaise;
  }

  compute(input: {
    /** Subtotal minus discount, paise. */
    merchandiseTotal: number;
    hasItems: boolean;
    freeShippingCoupon?: boolean;
  }): ShippingFee {
    assertPaise(input.merchandiseTotal, 'merchandiseTotal');
    if (!input.hasItems) return { fee: 0, freeReason: 'EMPTY', amountToFreeShipping: null };
    if (input.merchandiseTotal >= this.freeThreshold || this.flatFee === 0) {
      return { fee: 0, freeReason: 'THRESHOLD', amountToFreeShipping: null };
    }
    if (input.freeShippingCoupon) {
      return { fee: 0, freeReason: 'COUPON', amountToFreeShipping: null };
    }
    return {
      fee: this.flatFee,
      freeReason: null,
      amountToFreeShipping: this.freeThreshold - input.merchandiseTotal,
    };
  }
}
