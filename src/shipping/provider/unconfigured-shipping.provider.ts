import { HttpStatus } from '@nestjs/common';
import { AppException } from '../../common/exceptions/app.exception';
import type { ShippingProvider } from './shipping-provider';

/**
 * Production without Shiprocket credentials: every Shiprocket action answers 503
 * `SHIPPING_PROVIDER_NOT_CONFIGURED`, while manual shipping (courier + AWB entered by staff) keeps
 * working. The fake provider is never used in production.
 */
export class UnconfiguredShippingProvider implements ShippingProvider {
  readonly name = 'unconfigured' as const;

  private fail(): never {
    throw new AppException(
      'SHIPPING_PROVIDER_NOT_CONFIGURED',
      HttpStatus.SERVICE_UNAVAILABLE,
      'Shiprocket is not configured; use "Ship manually" instead',
    );
  }

  createOrder(): never {
    return this.fail();
  }
  assignAwb(): never {
    return this.fail();
  }
  generateLabel(): never {
    return this.fail();
  }
  requestPickup(): never {
    return this.fail();
  }
  track(): Promise<null> {
    return Promise.resolve(null);
  }
  trackingUrl(awb: string): string {
    return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  }
}
