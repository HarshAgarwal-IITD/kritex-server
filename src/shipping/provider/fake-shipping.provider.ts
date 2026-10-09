import { createHash } from 'node:crypto';
import type {
  CreateProviderOrderInput,
  ProviderAwb,
  ProviderOrder,
  ShippingProvider,
  TrackingUpdate,
} from './shipping-provider';

export const FAKE_COURIER = 'Fake Courier';
/** Webhook token accepted in dev/test when SHIPROCKET_WEBHOOK_TOKEN is unset. */
export const FAKE_SHIPROCKET_WEBHOOK_TOKEN = 'fake-shiprocket-token';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const digits = (value: string, n: number) =>
  BigInt(`0x${digest(value).slice(0, 15)}`)
    .toString()
    .padStart(n, '0')
    .slice(-n);

/**
 * Dev/test stand-in for Shiprocket (no network), used when SHIPROCKET_EMAIL is unset and refused
 * in production. Deterministic: the same channel order id always gives the same ids, and
 * `fake_ship_<x>` always gets AWB `FAKE<10 digits>`. Drive tracking with
 * `POST /webhooks/shiprocket` (x-api-key `fake-shiprocket-token`) and a Shiprocket-shaped body,
 * e.g. `{ "awb": "FAKE…", "current_status": "DELIVERED" }`.
 */
export class FakeShippingProvider implements ShippingProvider {
  readonly name = 'fake' as const;

  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const id = digits(input.channelOrderId, 9);
    return Promise.resolve({
      providerOrderId: `fake_order_${id}`,
      providerShipmentId: `fake_ship_${id}`,
    });
  }

  assignAwb(providerShipmentId: string, courierId?: number): Promise<ProviderAwb> {
    return Promise.resolve({
      awb: `FAKE${digits(providerShipmentId, 10)}`,
      courierName: FAKE_COURIER,
      courierId: courierId ?? 1,
    });
  }

  generateLabel(providerShipmentId: string): Promise<{ labelUrl: string }> {
    return Promise.resolve({
      labelUrl: `https://example.com/fake-shiprocket/labels/${providerShipmentId}.pdf`,
    });
  }

  requestPickup(): Promise<{ scheduledFor: string | null }> {
    return Promise.resolve({ scheduledFor: null });
  }

  track(): Promise<TrackingUpdate | null> {
    return Promise.resolve(null);
  }

  trackingUrl(awb: string): string {
    return `https://example.com/fake-shiprocket/track/${awb}`;
  }
}
