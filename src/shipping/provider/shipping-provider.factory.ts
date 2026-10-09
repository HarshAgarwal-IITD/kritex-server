import type { AppConfigService } from '../../config/app-config.service';
import { FakeShippingProvider } from './fake-shipping.provider';
import { ShiprocketProvider } from './shiprocket.provider';
import type { ShippingProvider } from './shipping-provider';
import { UnconfiguredShippingProvider } from './unconfigured-shipping.provider';

/**
 * Shiprocket when SHIPROCKET_EMAIL is set. Otherwise the fake provider in dev/test, and in production
 * a provider that refuses Shiprocket actions (manual shipping still works).
 */
export function shippingProviderFactory(config: AppConfigService): ShippingProvider {
  const email = config.get('SHIPROCKET_EMAIL');
  if (!email) {
    if (config.isProduction) return new UnconfiguredShippingProvider();
    return new FakeShippingProvider();
  }
  const password = config.get('SHIPROCKET_PASSWORD');
  if (!password) throw new Error('SHIPROCKET_PASSWORD is required with SHIPROCKET_EMAIL');
  return new ShiprocketProvider({ email, password, baseUrl: config.get('SHIPROCKET_API_URL') });
}
