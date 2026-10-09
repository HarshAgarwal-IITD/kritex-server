import { Logger } from '@nestjs/common';
import { parseShiprocketDate } from './shiprocket-payload';
import {
  type CreateProviderOrderInput,
  type ProviderAwb,
  type ProviderOrder,
  type ProviderTrackingScan,
  type ShipmentParty,
  type ShippingProvider,
  ShippingProviderError,
  type TrackingUpdate,
} from './shipping-provider';

export interface ShiprocketConfig {
  email: string;
  password: string;
  /** e.g. https://apiv2.shiprocket.in/v1/external */
  baseUrl: string;
}

/** Shiprocket tokens last 10 days; refresh well before that. */
const TOKEN_TTL_MS = 8 * 24 * 3600_000;

const rupees = (paise: number) => Math.round(paise) / 100;

/** "2026-10-09 14:05" in IST, the format Shiprocket expects for order_date. */
function istDateTime(date: Date): string {
  const ist = new Date(date.getTime() + 330 * 60_000).toISOString();
  return `${ist.slice(0, 10)} ${ist.slice(11, 16)}`;
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') };
}

function phone10(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.slice(-10);
}

function party(prefix: 'billing' | 'shipping', p: ShipmentParty): Record<string, unknown> {
  const name = splitName(p.name);
  return {
    [`${prefix}_customer_name`]: name.first,
    [`${prefix}_last_name`]: name.last,
    [`${prefix}_address`]: p.line1,
    [`${prefix}_address_2`]: p.line2 ?? '',
    [`${prefix}_city`]: p.city,
    [`${prefix}_pincode`]: p.pincode,
    [`${prefix}_state`]: p.state,
    [`${prefix}_country`]: 'India',
    [`${prefix}_email`]: p.email,
    [`${prefix}_phone`]: phone10(p.phone),
  };
}

/**
 * Shiprocket REST API (https://apidocs.shiprocket.in). Auth: POST /auth/login → bearer token,
 * cached in memory and refreshed on expiry or a 401. All failures become ShippingProviderError
 * (no credentials or personal data in the message).
 */
export class ShiprocketProvider implements ShippingProvider {
  readonly name = 'shiprocket' as const;
  private readonly logger = new Logger('Shiprocket');
  private token: { value: string; expiresAt: number } | null = null;
  private login: Promise<string> | null = null;

  constructor(
    private readonly config: ShiprocketConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  private url(path: string) {
    return `${this.config.baseUrl.replace(/\/+$/, '')}${path}`;
  }

  /** Cached token; concurrent callers share one login request. */
  async authToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > this.now()) return this.token.value;
    this.login ??= (async () => {
      try {
        const res = await this.fetchImpl(this.url('/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: this.config.email, password: this.config.password }),
          signal: AbortSignal.timeout(15_000),
        });
        const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
        if (!res.ok || !body.token) {
          throw new ShippingProviderError('Shiprocket login failed', {
            status: res.status,
            message: body.message ?? null,
          });
        }
        this.token = { value: body.token, expiresAt: this.now() + TOKEN_TTL_MS };
        return body.token;
      } finally {
        this.login = null;
      }
    })();
    return this.login;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const send = async (token: string) =>
      this.fetchImpl(this.url(path), {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    let res: Response;
    try {
      res = await send(await this.authToken());
      if (res.status === 401) res = await send(await this.authToken(true));
    } catch (err) {
      if (err instanceof ShippingProviderError) throw err;
      throw new ShippingProviderError(`Shiprocket ${path} unreachable`, {
        message: (err as Error).message,
      });
    }
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const raw =
        json && typeof json === 'object' ? (json as Record<string, unknown>).message : undefined;
      const message = typeof raw === 'string' && raw ? raw : `HTTP ${res.status}`;
      this.logger.warn({ path, status: res.status }, 'Shiprocket call failed');
      throw new ShippingProviderError(`Shiprocket ${path}: ${message}`, {
        status: res.status,
        response: json,
      });
    }
    return json as T;
  }

  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrder> {
    const sameAddress =
      JSON.stringify({ ...input.billing, email: '' }) ===
      JSON.stringify({ ...input.shipping, email: '' });
    const body = {
      order_id: input.channelOrderId,
      order_date: istDateTime(input.orderDate),
      pickup_location: input.pickupLocation,
      ...party('billing', input.billing),
      shipping_is_billing: sameAddress,
      ...(sameAddress ? {} : party('shipping', input.shipping)),
      order_items: input.items.map((i) => ({
        name: i.name,
        sku: i.sku,
        units: i.units,
        selling_price: rupees(i.unitPrice),
        discount: rupees(i.discount),
        tax: i.taxRate,
        hsn: i.hsn ?? '',
      })),
      payment_method: 'Prepaid',
      shipping_charges: rupees(input.shippingCharges),
      sub_total: rupees(input.total - input.shippingCharges),
      length: input.lengthCm,
      breadth: input.widthCm,
      height: input.heightCm,
      weight: Math.max(input.weightGrams, 1) / 1000,
    };
    const res = await this.call<{ order_id?: number | string; shipment_id?: number | string }>(
      'POST',
      '/orders/create/adhoc',
      body,
    );
    if (!res?.order_id || !res.shipment_id) {
      throw new ShippingProviderError('Shiprocket did not return an order/shipment id', {
        response: res,
      });
    }
    return { providerOrderId: String(res.order_id), providerShipmentId: String(res.shipment_id) };
  }

  async assignAwb(providerShipmentId: string, courierId?: number): Promise<ProviderAwb> {
    const res = await this.call<{
      awb_assign_status?: number;
      message?: string;
      response?: {
        data?: { awb_code?: string; courier_name?: string; courier_company_id?: number };
      };
    }>('POST', '/courier/assign/awb', {
      shipment_id: Number(providerShipmentId),
      ...(courierId ? { courier_id: courierId } : {}),
    });
    const data = res?.response?.data;
    if (res?.awb_assign_status !== 1 || !data?.awb_code) {
      throw new ShippingProviderError('Shiprocket could not assign an AWB', {
        message: res?.message ?? null,
        response: res,
      });
    }
    return {
      awb: String(data.awb_code),
      courierName: data.courier_name ?? 'Courier',
      courierId: data.courier_company_id ?? null,
    };
  }

  async generateLabel(providerShipmentId: string): Promise<{ labelUrl: string }> {
    const res = await this.call<{ label_created?: number; label_url?: string }>(
      'POST',
      '/courier/generate/label',
      { shipment_id: [Number(providerShipmentId)] },
    );
    if (!res?.label_url) {
      throw new ShippingProviderError('Shiprocket did not return a label', { response: res });
    }
    return { labelUrl: res.label_url };
  }

  async requestPickup(providerShipmentId: string): Promise<{ scheduledFor: string | null }> {
    const res = await this.call<{
      pickup_status?: number;
      response?: { pickup_scheduled_date?: string };
    }>('POST', '/courier/generate/pickup', { shipment_id: [Number(providerShipmentId)] });
    if (res?.pickup_status !== 1) {
      throw new ShippingProviderError('Shiprocket could not schedule the pickup', {
        response: res,
      });
    }
    return { scheduledFor: res.response?.pickup_scheduled_date ?? null };
  }

  async track(awb: string): Promise<TrackingUpdate | null> {
    const res = await this.call<{
      tracking_data?: {
        shipment_track?: { current_status?: string; courier_name?: string; sr_order_id?: number }[];
        shipment_track_activities?: {
          date?: string;
          activity?: string;
          location?: string;
          'sr-status-label'?: string;
          status?: string;
        }[];
      };
    }>('GET', `/courier/track/awb/${encodeURIComponent(awb)}`);
    const data = res?.tracking_data;
    const track = data?.shipment_track?.[0];
    if (!track?.current_status) return null;
    const scans: ProviderTrackingScan[] = (data?.shipment_track_activities ?? [])
      .map((a) => ({
        at: parseShiprocketDate(a.date),
        status: a['sr-status-label'] ?? a.status ?? '',
        location: a.location ?? null,
        description: a.activity ?? null,
      }))
      .filter((s): s is ProviderTrackingScan => !!s.at && !!s.status);
    return {
      awb,
      providerOrderId: track.sr_order_id ? String(track.sr_order_id) : null,
      courierName: track.courier_name ?? null,
      currentStatus: track.current_status,
      at: scans.reduce((latest, s) => (s.at > latest ? s.at : latest), new Date(0)),
      scans,
    };
  }

  trackingUrl(awb: string): string {
    return `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
  }
}
