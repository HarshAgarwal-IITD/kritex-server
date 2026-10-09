import { shippingProviderFactory } from '../../shipping/provider/shipping-provider.factory';
import type { AppConfigService } from '../../config/app-config.service';
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderDeliveredEmail,
  orderShippedEmail,
  paymentFailedEmail,
} from './order-emails';
import { quoteRespondedEmail } from './quote-emails';

describe('email templates', () => {
  const order = {
    number: 'KTX-100001',
    customerName: 'Asha Rao',
    placedAt: new Date('2026-10-09T10:00:00Z'),
    items: [{ name: 'Combat Shirt', variant: 'M', quantity: 2, total: 259800 }],
    totals: { subtotal: 259800, discount: 0, shipping: 0, taxTotal: 12371, total: 259800 },
    shippingAddress: ['Asha Rao', '12 MG Road', 'Mumbai, Maharashtra, 400001'],
    orderUrl: 'https://kritex.in/account/orders/KTX-100001',
  };

  it('order confirmation: items, INR totals, link, invoice note; HTML + text', async () => {
    const e = await orderConfirmationEmail({
      ...order,
      invoiceNumber: 'KTX/2026-27/00001',
      invoiceAttached: true,
    });
    expect(e.subject).toBe('Order KTX-100001 confirmed');
    expect(e.html.startsWith('<!DOCTYPE html')).toBe(true);
    expect(e.html).toContain('href="https://kritex.in/account/orders/KTX-100001"');
    expect(e.text).toContain('Combat Shirt');
    expect(e.text).toContain('₹2,598.00');
    expect(e.text).toContain('Hi Asha,');
    expect(e.text).toContain('KTX/2026-27/00001 is attached');
  });

  it('other templates render their key facts', async () => {
    expect(
      (
        await paymentFailedEmail({
          number: 'KTX-1',
          customerName: '',
          total: 9900,
          retryUrl: 'https://x/retry',
        })
      ).text,
    ).toContain('Hi there,');
    const shipped = await orderShippedEmail({
      number: 'KTX-1',
      customerName: 'A',
      carrier: 'Delhivery',
      awb: 'AWB9',
      carrierTrackingUrl: null,
      trackUrl: 'https://x/track',
    });
    expect(shipped.text).toContain('AWB9');
    expect(shipped.text).toContain('with Delhivery');
    expect(
      (
        await orderDeliveredEmail({
          number: 'KTX-1',
          customerName: 'A',
          orderUrl: 'https://x/o',
          returnsUrl: 'https://x/returns',
        })
      ).html,
    ).toContain('https://x/returns');
    const cancelled = await orderCancelledEmail({
      number: 'KTX-1',
      customerName: 'A',
      reason: 'Out of stock.',
      paymentLapsed: false,
      wasPaid: true,
      refunded: true,
      total: 9900,
      shopUrl: 'https://x/products',
    });
    expect(cancelled.text).toContain('cancelled: Out of stock.');
    expect(cancelled.text).toContain('full refund');
    const quote = await quoteRespondedEmail({
      number: 'KTQ-1',
      contactName: 'Major Singh',
      organization: '21 Para',
      quotedTotal: 12_500_000,
      validUntil: '2026-11-30T18:29:59Z',
      quoteUrl: 'https://x/account/quotes/KTQ-1',
    });
    expect(quote.text).toContain('₹1,25,000.00');
    expect(quote.text).toContain('30 Nov 2026'); // 23:59:59 IST
  });
});

describe('shippingProviderFactory', () => {
  const config = (env: Record<string, unknown>) =>
    ({
      get: (k: string) => env[k],
      isProduction: env.NODE_ENV === 'production',
    }) as unknown as AppConfigService;

  it('fake without credentials (dev/test), unconfigured in production; Shiprocket with them', () => {
    expect(shippingProviderFactory(config({})).name).toBe('fake');
    expect(shippingProviderFactory(config({ NODE_ENV: 'production' })).name).toBe('unconfigured');
    expect(
      shippingProviderFactory(
        config({
          SHIPROCKET_EMAIL: 'a',
          SHIPROCKET_PASSWORD: 'b',
          SHIPROCKET_API_URL: 'https://x',
        }),
      ).name,
    ).toBe('shiprocket');
  });
});
