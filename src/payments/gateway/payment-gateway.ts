import { createHmac, timingSafeEqual } from 'node:crypto';

/** Nest injection token for the active `PaymentGateway` (Razorpay, or the fake one in dev/test). */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

/** Razorpay's payment states (https://razorpay.com/docs/payments/payments/#payment-life-cycle). */
export type GatewayPaymentStatus = 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';

export interface GatewayOrder {
  /** Provider order id, e.g. `order_N...` (Razorpay) or `order_fake_...`. */
  id: string;
  /** Paise. */
  amount: number;
  currency: 'INR';
}

export interface GatewayPayment {
  id: string;
  orderId: string | null;
  /** Paise. */
  amount: number;
  status: GatewayPaymentStatus;
  /** upi | card | netbanking | ... (provider value, informational). */
  method: string | null;
}

export type GatewayRefundStatus = 'pending' | 'processed' | 'failed';

export interface GatewayRefund {
  id: string;
  paymentId: string;
  amount: number;
  status: GatewayRefundStatus;
}

/**
 * The payment provider as the rest of the app sees it (ADR-003). `RazorpayGateway` talks to the
 * Razorpay REST API; `FakeGateway` (no RAZORPAY_KEY_ID; refused in production) lets dev and tests
 * run the whole checkout without a network.
 */
export interface PaymentGateway {
  readonly kind: 'razorpay' | 'fake';
  /** Public key id for Checkout.js. */
  readonly keyId: string;
  createOrder(input: {
    amount: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder>;
  /** Checkout.js handler signature: HMAC-SHA256(`${orderId}|${paymentId}`, key secret). */
  verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string }): boolean;
  /** `x-razorpay-signature`: HMAC-SHA256(raw body, webhook secret). */
  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean;
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** Capture an `authorized` payment (when auto-capture is off). */
  capturePayment(paymentId: string, amount: number): Promise<GatewayPayment>;
  refund(
    paymentId: string,
    input: { amount: number; notes?: Record<string, string> },
  ): Promise<GatewayRefund>;
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Constant-time comparison of two hex/ascii strings. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Thrown when the provider is unreachable or rejects a call; mapped to 502 by callers. */
export class PaymentGatewayError extends Error {
  constructor(
    message: string,
    public readonly providerCode?: string,
  ) {
    super(message);
    this.name = 'PaymentGatewayError';
  }
}
