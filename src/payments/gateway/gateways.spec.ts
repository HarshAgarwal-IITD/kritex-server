import { createHmac } from 'node:crypto';
import { FAKE_WEBHOOK_SECRET, FakeGateway } from './fake.gateway';
import { PaymentGatewayError } from './payment-gateway';
import { paymentGatewayFactory } from './payment-gateway.module';
import { RazorpayGateway } from './razorpay.gateway';

const hmac = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('RazorpayGateway', () => {
  const creds = { keyId: 'rzp_test_1', keySecret: 'key_secret', webhookSecret: 'wh_secret' };

  it('verifies the Checkout.js signature HMAC(order_id|payment_id, key secret)', () => {
    const gw = new RazorpayGateway(creds);
    const signature = hmac('key_secret', 'order_1|pay_1');
    expect(gw.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature })).toBe(
      true,
    );
    expect(gw.verifyPaymentSignature({ orderId: 'order_2', paymentId: 'pay_1', signature })).toBe(
      false,
    );
    expect(
      gw.verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: 'x' }),
    ).toBe(false);
  });

  it('verifies webhook signatures over the raw body with the webhook secret', () => {
    const gw = new RazorpayGateway(creds);
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(gw.verifyWebhookSignature(body, hmac('wh_secret', body.toString()))).toBe(true);
    expect(gw.verifyWebhookSignature(body, hmac('key_secret', body.toString()))).toBe(false);
  });

  it('creates orders and refunds with basic auth; maps API errors', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'order_A', amount: 1000, currency: 'INR' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'rfnd_A', payment_id: 'pay_A', amount: 500, status: 'pending' }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'amount too high' } }),
          { status: 400 },
        ),
      );
    const gw = new RazorpayGateway({ ...creds, fetch: fetchMock as typeof fetch });

    await expect(gw.createOrder({ amount: 1000, receipt: 'KTX-1' })).resolves.toEqual({
      id: 'order_A',
      amount: 1000,
      currency: 'INR',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.razorpay.com/v1/orders');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('rzp_test_1:key_secret').toString('base64')}`,
    );
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 1000,
      currency: 'INR',
      receipt: 'KTX-1',
      notes: {},
    });

    await expect(gw.refund('pay_A', { amount: 500 })).resolves.toEqual({
      id: 'rfnd_A',
      paymentId: 'pay_A',
      amount: 500,
      status: 'pending',
    });
    await expect(gw.fetchPayment('pay_A')).rejects.toBeInstanceOf(PaymentGatewayError);
  });
});

describe('FakeGateway', () => {
  const gw = new FakeGateway();

  it('implements the documented dev contract', async () => {
    expect(gw.keyId).toBe('rzp_fake');
    expect((await gw.createOrder({ amount: 5 })).id).toMatch(/^order_fake_/);
    expect(gw.verifyPaymentSignature({ paymentId: 'pay_fake_1', signature: 'fake' })).toBe(true);
    expect(gw.verifyPaymentSignature({ paymentId: 'pay_1', signature: 'fake' })).toBe(false);
    expect(gw.verifyPaymentSignature({ paymentId: 'pay_fake_1', signature: 'x' })).toBe(false);
    expect((await gw.fetchPayment('pay_fake_1')).status).toBe('captured');
    expect((await gw.fetchPayment('pay_fake_fail_1')).status).toBe('failed');
    const body = Buffer.from('{}');
    expect(gw.verifyWebhookSignature(body, hmac(FAKE_WEBHOOK_SECRET, '{}'))).toBe(true);
  });
});

describe('paymentGatewayFactory', () => {
  const config = (env: Record<string, string | undefined>, isProduction = false) =>
    ({ get: (k: string) => env[k], isProduction }) as never;

  it('uses the fake gateway without RAZORPAY_KEY_ID, Razorpay with it', () => {
    expect(paymentGatewayFactory(config({})).kind).toBe('fake');
    expect(
      paymentGatewayFactory(
        config({
          RAZORPAY_KEY_ID: 'rzp_test_1',
          RAZORPAY_KEY_SECRET: 's',
          RAZORPAY_WEBHOOK_SECRET: 'w',
        }),
      ).kind,
    ).toBe('razorpay');
  });

  it('refuses the fake gateway in production', () => {
    expect(() => paymentGatewayFactory(config({}, true))).toThrow(/RAZORPAY_KEY_ID/);
  });
});
