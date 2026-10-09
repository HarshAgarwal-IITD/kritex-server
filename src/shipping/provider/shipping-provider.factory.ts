import type { AppConfigService } from '../../config/app-config.service';
import { FakeShippingProvider } from './fake-shipping.provider';
import { ShiprocketProvider } from './shiprocket.provider';
import type { ShippingProvider } from './shipping-provider';

/** Shiprocket when SHIPROCKET_EMAIL is set, else the fake provider (never in production). */
export function shippingProviderFactory(config: AppConfigService): ShippingProvider {
  const email = config.get('SHIPROCKET_EMAIL');
  if (!email) {
    // The env schema already refuses this; belt and braces.
    if (config.isProduction) {
      throw new Error(
        'SHIPROCKET_EMAIL is required in production (fake shipping is dev/test only)',
      );
    }
    return new FakeShippingProvider();
  }
  const password = config.get('SHIPROCKET_PASSWORD');
  if (!password) throw new Error('SHIPROCKET_PASSWORD is required with SHIPROCKET_EMAIL');
  return new ShiprocketProvider({ email, password, baseUrl: config.get('SHIPROCKET_API_URL') });
}
