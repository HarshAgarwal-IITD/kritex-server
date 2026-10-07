import { randomBytes } from 'node:crypto';
import {
  type GatewayOrder,
  type GatewayPayment,
  type GatewayRefund,
  hmacSha256Hex,
  type PaymentGateway,
  safeEqual,
} from './payment-gateway';

export const FAKE_KEY_ID = 'rzp_fake';
export const FAKE_SIGNATURE = 'fake';
export const FAKE_PAYMENT_PREFIX = 'pay_fake_';
export const FAKE_FAILED_PAYMENT_PREFIX = 'pay_fake_fail';
/** Webhook secret used by the fake gateway when RAZORPAY_WEBHOOK_SECRET is unset. */
export const FAKE_WEBHOOK_SECRET = 'fake_webhook_secret';

/**
 * Dev/test stand-in for Razorpay (no network). Contract relied on by the storefront:
 * - `createOrder` → `order_fake_<random>`; Checkout.js is replaced by the client's own fake step.
 * - `/checkout/verify` accepts `razorpay_payment_id = pay_fake_<anything>` with
 *   `razorpay_signature = "fake"`; `pay_fake_fail...` is a failed payment, anything else captured.
 * - Webhooks are signed like Razorpay's, with RAZORPAY_WEBHOOK_SECRET or `FAKE_WEBHOOK_SECRET`.
 * - Refunds are processed immediately (`rfnd_fake_<random>`).
 */
export class FakeGateway implements PaymentGateway {
  readonly kind = 'fake' as const;
  readonly keyId = FAKE_KEY_ID;

  constructor(private readonly webhookSecret: string = FAKE_WEBHOOK_SECRET) {}

  createOrder(input: { amount: number }): Promise<GatewayOrder> {
    return Promise.resolve({
      id: `order_fake_${randomBytes(7).toString('hex')}`,
      amount: input.amount,
      currency: 'INR',
    });
  }

  verifyPaymentSignature(input: { paymentId: string; signature: string }): boolean {
    return input.paymentId.startsWith(FAKE_PAYMENT_PREFIX) && input.signature === FAKE_SIGNATURE;
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return safeEqual(hmacSha256Hex(this.webhookSecret, rawBody), signature);
  }

  fetchPayment(paymentId: string): Promise<GatewayPayment> {
    return Promise.resolve({
      id: paymentId,
      orderId: null,
      amount: 0,
      status: paymentId.startsWith(FAKE_FAILED_PAYMENT_PREFIX) ? 'failed' : 'captured',
      method: 'fake',
    });
  }

  capturePayment(paymentId: string, amount: number): Promise<GatewayPayment> {
    return Promise.resolve({
      id: paymentId,
      orderId: null,
      amount,
      status: 'captured',
      method: 'fake',
    });
  }

  refund(paymentId: string, input: { amount: number }): Promise<GatewayRefund> {
    return Promise.resolve({
      id: `rfnd_fake_${randomBytes(7).toString('hex')}`,
      paymentId,
      amount: input.amount,
      status: 'processed',
    });
  }
}
