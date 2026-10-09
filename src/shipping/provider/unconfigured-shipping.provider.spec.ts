import { UnconfiguredShippingProvider } from './unconfigured-shipping.provider';
import { shippingProviderFactory } from './shipping-provider.factory';
import type { AppConfigService } from '../../config/app-config.service';

const config = (env: Record<string, string | undefined>, isProduction: boolean) =>
  ({ get: (k: string) => env[k], isProduction }) as unknown as AppConfigService;

describe('UnconfiguredShippingProvider', () => {
  it('is what production gets without Shiprocket, and refuses Shiprocket actions with 503', () => {
    const provider = shippingProviderFactory(config({}, true));
    expect(provider).toBeInstanceOf(UnconfiguredShippingProvider);
    expect(() => provider.generateLabel('1')).toThrow(
      expect.objectContaining({ code: 'SHIPPING_PROVIDER_NOT_CONFIGURED' }),
    );
    expect(provider.trackingUrl('AWB 1')).toBe('https://shiprocket.co/tracking/AWB%201');
  });

  it('dev/test without Shiprocket still uses the fake provider', () => {
    expect(shippingProviderFactory(config({}, false))).not.toBeInstanceOf(
      UnconfiguredShippingProvider,
    );
  });
});
