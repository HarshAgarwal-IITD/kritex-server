import { Test } from '@nestjs/testing';
import { ConfigModule } from '../config/config.module';
import { CouponValidationService } from './coupon-validation.service';
import { DEFAULT_PRICING_CONFIG, PRICING_CONFIG } from './pricing.config';
import { PricingModule } from './pricing.module';
import { ShippingFeeService } from './shipping-fee.service';
import { TaxService } from './tax.service';
import { TotalsService } from './totals.service';

describe('PricingModule', () => {
  it('wires the services from the validated env (defaults)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, PricingModule],
    }).compile();

    expect(moduleRef.get(PRICING_CONFIG)).toEqual(DEFAULT_PRICING_CONFIG);
    expect(moduleRef.get(TaxService)).toBeInstanceOf(TaxService);
    expect(moduleRef.get(ShippingFeeService)).toBeInstanceOf(ShippingFeeService);
    expect(moduleRef.get(CouponValidationService)).toBeInstanceOf(CouponValidationService);

    const totals = moduleRef.get(TotalsService);
    const r = totals.compute(
      [
        {
          variantId: 'v',
          productId: 'p',
          quantity: 1,
          unitPrice: 49900,
          hsnCode: '6109',
          gstRate: null,
        },
      ],
      { stateCode: '27' },
      null,
      null,
    );
    expect(r.totals.total).toBe(59800);
  });
});
