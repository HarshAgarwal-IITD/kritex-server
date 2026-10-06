import type { AppConfigService } from '../config/app-config.service';

/**
 * Plain config object consumed by the pricing services. Built once from the validated env
 * (`AppConfigService`) by `PricingModule`; unit tests pass literals instead.
 */
export interface PricingConfig {
  /** Seller's registered GST state code, e.g. "27". Compared with the place of supply. */
  businessStateCode: string;
  /** Percent. Used when a non-slab product has no gstRate. */
  defaultGstRate: number;
  /** HSN prefixes whose rate follows the price slab (ADR-006). */
  slabHsnPrefixes: readonly string[];
  /** Per-unit taxable value (ex-GST, paise) at or below which `slabLowRate` applies. */
  slabThresholdPaise: number;
  slabLowRate: number;
  slabHighRate: number;
  /** Flat shipping fee, GST-inclusive paise. */
  shippingFlatFeePaise: number;
  /** Merchandise total (after discount) at or above which shipping is free, paise. */
  shippingFreeThresholdPaise: number;
}

export const PRICING_CONFIG = Symbol('PRICING_CONFIG');

export function pricingConfigFromEnv(config: AppConfigService): PricingConfig {
  return {
    businessStateCode: config.get('BUSINESS_STATE_CODE'),
    defaultGstRate: config.get('GST_DEFAULT_RATE'),
    slabHsnPrefixes: config.get('GST_SLAB_HSN_PREFIXES'),
    slabThresholdPaise: config.get('GST_SLAB_THRESHOLD_PAISE'),
    slabLowRate: config.get('GST_SLAB_LOW_RATE'),
    slabHighRate: config.get('GST_SLAB_HIGH_RATE'),
    shippingFlatFeePaise: config.get('SHIPPING_FLAT_FEE_PAISE'),
    shippingFreeThresholdPaise: config.get('SHIPPING_FREE_THRESHOLD_PAISE'),
  };
}

/** The env defaults, handy for tests. Keep in sync with src/config/env.schema.ts. */
export const DEFAULT_PRICING_CONFIG: PricingConfig = {
  businessStateCode: '27',
  defaultGstRate: 18,
  slabHsnPrefixes: ['61', '62', '63', '64'],
  slabThresholdPaise: 250000,
  slabLowRate: 5,
  slabHighRate: 18,
  shippingFlatFeePaise: 9900,
  shippingFreeThresholdPaise: 99900,
};
