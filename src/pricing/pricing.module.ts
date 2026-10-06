import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { CouponValidationService } from './coupon-validation.service';
import { PRICING_CONFIG, pricingConfigFromEnv } from './pricing.config';
import { ShippingFeeService } from './shipping-fee.service';
import { TaxService } from './tax.service';
import { TotalsService } from './totals.service';

/**
 * Pure pricing services (no HTTP surface): tax, shipping fee, coupon rules and the totals
 * function. Import this module where totals are needed (cart, checkout, orders, quotes).
 * Relies on the global ConfigModule for AppConfigService.
 */
@Module({
  providers: [
    { provide: PRICING_CONFIG, useFactory: pricingConfigFromEnv, inject: [AppConfigService] },
    TaxService,
    ShippingFeeService,
    CouponValidationService,
    TotalsService,
  ],
  exports: [PRICING_CONFIG, TaxService, ShippingFeeService, CouponValidationService, TotalsService],
})
export class PricingModule {}
