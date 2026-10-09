/** Injection token for the shipping provider (Shiprocket, or the fake one in dev/test). */
export const SHIPPING_PROVIDER = Symbol('SHIPPING_PROVIDER');

export interface ShipmentParty {
  name: string;
  phone: string;
  email: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface ShipmentItem {
  name: string;
  sku: string;
  units: number;
  /** GST-inclusive unit price, paise. */
  unitPrice: number;
  /** Line discount, paise. */
  discount: number;
  hsn: string | null;
  /** Percent. */
  taxRate: number;
}

export interface CreateProviderOrderInput {
  /** Unique per attempt on the provider side, e.g. `KTX-100001` or `KTX-100001-2`. */
  channelOrderId: string;
  orderDate: Date;
  pickupLocation: string;
  billing: ShipmentParty;
  shipping: ShipmentParty;
  items: ShipmentItem[];
  /** Paise. */
  shippingCharges: number;
  /** Order total, paise. */
  total: number;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
}

export interface ProviderOrder {
  providerOrderId: string;
  providerShipmentId: string;
}

export interface ProviderAwb {
  awb: string;
  courierName: string;
  courierId: number | null;
}

export interface ProviderTrackingScan {
  at: Date;
  status: string;
  location: string | null;
  description: string | null;
}

/** A tracking update, from a webhook or a pull. */
export interface TrackingUpdate {
  awb: string | null;
  providerOrderId: string | null;
  courierName: string | null;
  /** Carrier/aggregator status text, e.g. "IN TRANSIT". */
  currentStatus: string;
  at: Date;
  scans: ProviderTrackingScan[];
}

/** A provider call failed; surfaced as 422 SHIPROCKET_ERROR with `details`. */
export class ShippingProviderError extends Error {
  constructor(
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ShippingProviderError';
  }
}

/**
 * Fulfilment provider (ADR-005). Each step is separate so an interrupted shipment can be resumed:
 * create order → assign AWB → label → pickup. Webhooks are parsed by `parseWebhook`.
 */
export interface ShippingProvider {
  readonly name: 'shiprocket' | 'fake';
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder>;
  assignAwb(providerShipmentId: string, courierId?: number): Promise<ProviderAwb>;
  generateLabel(providerShipmentId: string): Promise<{ labelUrl: string }>;
  requestPickup(providerShipmentId: string): Promise<{ scheduledFor: string | null }>;
  track(awb: string): Promise<TrackingUpdate | null>;
  /** Public tracking page for an AWB. */
  trackingUrl(awb: string): string;
}
