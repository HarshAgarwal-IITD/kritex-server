import {
  type GatewayOrder,
  type GatewayPayment,
  type GatewayPaymentStatus,
  type GatewayRefund,
  type GatewayRefundStatus,
  hmacSha256Hex,
  type PaymentGateway,
  PaymentGatewayError,
  safeEqual,
} from './payment-gateway';

export interface RazorpayCredentials {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Override for tests. */
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface RazorpayPaymentEntity {
  id: string;
  order_id: string | null;
  amount: number;
  status: GatewayPaymentStatus;
  method?: string | null;
}

interface RazorpayRefundEntity {
  id: string;
  payment_id: string;
  amount: number;
  status: GatewayRefundStatus;
}

/** Razorpay REST v1 (basic auth with key id + secret). Only ids/statuses are kept; no card data. */
export class RazorpayGateway implements PaymentGateway {
  readonly kind = 'razorpay' as const;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly creds: RazorpayCredentials) {
    this.baseUrl = creds.baseUrl ?? 'https://api.razorpay.com/v1';
    this.fetchImpl = creds.fetch ?? fetch;
  }

  get keyId(): string {
    return this.creds.keyId;
  }

  async createOrder(input: {
    amount: number;
    receipt: string;
    notes?: Record<string, string>;
  }): Promise<GatewayOrder> {
    const order = await this.request<{ id: string; amount: number; currency: 'INR' }>(
      'POST',
      '/orders',
      { amount: input.amount, currency: 'INR', receipt: input.receipt, notes: input.notes ?? {} },
    );
    return { id: order.id, amount: order.amount, currency: 'INR' };
  }

  verifyPaymentSignature(input: { orderId: string; paymentId: string; signature: string }) {
    const expected = hmacSha256Hex(this.creds.keySecret, `${input.orderId}|${input.paymentId}`);
    return safeEqual(expected, input.signature);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string): boolean {
    return safeEqual(hmacSha256Hex(this.creds.webhookSecret, rawBody), signature);
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    const p = await this.request<RazorpayPaymentEntity>(
      'GET',
      `/payments/${encodeURIComponent(paymentId)}`,
    );
    return toPayment(p);
  }

  async capturePayment(paymentId: string, amount: number): Promise<GatewayPayment> {
    const p = await this.request<RazorpayPaymentEntity>(
      'POST',
      `/payments/${encodeURIComponent(paymentId)}/capture`,
      { amount, currency: 'INR' },
    );
    return toPayment(p);
  }

  async refund(
    paymentId: string,
    input: { amount: number; notes?: Record<string, string> },
  ): Promise<GatewayRefund> {
    const r = await this.request<RazorpayRefundEntity>(
      'POST',
      `/payments/${encodeURIComponent(paymentId)}/refund`,
      { amount: input.amount, notes: input.notes ?? {} },
    );
    return { id: r.id, paymentId: r.payment_id, amount: r.amount, status: r.status };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const auth = Buffer.from(`${this.creds.keyId}:${this.creds.keySecret}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${auth}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new PaymentGatewayError(`Razorpay unreachable: ${(err as Error).message}`);
    }
    const json = (await res.json().catch(() => ({}))) as {
      error?: { code?: string; description?: string };
    };
    if (!res.ok) {
      throw new PaymentGatewayError(
        `Razorpay ${method} ${path.split('/')[1]} failed (${res.status}): ${json.error?.description ?? 'unknown error'}`,
        json.error?.code,
      );
    }
    return json as T;
  }
}

function toPayment(p: RazorpayPaymentEntity): GatewayPayment {
  return {
    id: p.id,
    orderId: p.order_id ?? null,
    amount: p.amount,
    status: p.status,
    method: p.method ?? null,
  };
}
