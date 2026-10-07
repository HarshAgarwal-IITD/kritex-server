import { Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { FAKE_WEBHOOK_SECRET, FakeGateway } from './fake.gateway';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway';
import { RazorpayGateway } from './razorpay.gateway';

/** Picks the gateway from env: Razorpay when RAZORPAY_KEY_ID is set, else the fake one. */
export function paymentGatewayFactory(config: AppConfigService): PaymentGateway {
  const keyId = config.get('RAZORPAY_KEY_ID');
  if (!keyId) {
    // The env schema already refuses this; belt and braces.
    if (config.isProduction) {
      throw new Error('RAZORPAY_KEY_ID is required in production (fake gateway is dev/test only)');
    }
    return new FakeGateway(config.get('RAZORPAY_WEBHOOK_SECRET') ?? FAKE_WEBHOOK_SECRET);
  }
  const keySecret = config.get('RAZORPAY_KEY_SECRET');
  const webhookSecret = config.get('RAZORPAY_WEBHOOK_SECRET');
  if (!keySecret || !webhookSecret) {
    throw new Error('RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET are required');
  }
  return new RazorpayGateway({ keyId, keySecret, webhookSecret });
}

@Module({
  providers: [
    { provide: PAYMENT_GATEWAY, useFactory: paymentGatewayFactory, inject: [AppConfigService] },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentGatewayModule {}
