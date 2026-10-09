import type { ShipmentStatus } from '../../common/dto/enums';
import type { ProviderTrackingScan, TrackingUpdate } from './shipping-provider';

const IST_OFFSET_MIN = 330;

/**
 * Shiprocket timestamps are IST without a zone, in two shapes:
 * `2023-05-19 11:59:16` (scans, dates) and `23 05 2023 11:43:52` (webhook current_timestamp).
 */
export function parseShiprocketDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  let parts: number[] | null = null;
  if (m) parts = [+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] ?? 0)];
  m = /^(\d{2})[ -/](\d{2})[ -/](\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  if (m) parts = [+m[3], +m[2], +m[1], +m[4], +m[5], +(m[6] ?? 0)];
  if (!parts) {
    const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? new Date(v) : null;
    return iso && !Number.isNaN(iso.getTime()) ? iso : null;
  }
  const [y, mo, d, h, mi, s] = parts;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s) - IST_OFFSET_MIN * 60_000;
  return Number.isNaN(utc) ? null : new Date(utc);
}

/**
 * Shiprocket status text → our ShipmentStatus. Null = informational (record the scan only).
 * Labels per Shiprocket's status list (e.g. "PICKED UP", "IN TRANSIT", "RTO INITIATED").
 */
export function mapShiprocketStatus(status: string): ShipmentStatus | null {
  const s = status.trim().toUpperCase().replace(/[_-]+/g, ' ');
  if (!s) return null;
  if (s.startsWith('RTO') || s.includes('RETURN TO ORIGIN')) return 'RTO';
  if (s === 'DELIVERED') return 'DELIVERED';
  if (s.startsWith('CANCEL')) return 'CANCELLED';
  if (s === 'OUT FOR DELIVERY') return 'OUT_FOR_DELIVERY';
  if (s === 'PICKED UP' || s === 'SHIPPED') return 'SHIPPED';
  if (
    s === 'IN TRANSIT' ||
    s.startsWith('REACHED') ||
    s === 'MISROUTED' ||
    s === 'DELAYED' ||
    s === 'UNDELIVERED' ||
    s.startsWith('IN TRANSIT')
  ) {
    return 'IN_TRANSIT';
  }
  if (
    s === 'AWB ASSIGNED' ||
    s === 'LABEL GENERATED' ||
    s.startsWith('PICKUP') ||
    s === 'OUT FOR PICKUP' ||
    s === 'MANIFEST GENERATED' ||
    s === 'READY TO SHIP'
  ) {
    return 'READY_TO_SHIP';
  }
  return null;
}

/** Forward-only progress; RTO / CANCELLED may replace anything not yet delivered. */
const RANK: Record<ShipmentStatus, number> = {
  PENDING: 0,
  READY_TO_SHIP: 1,
  SHIPPED: 2,
  IN_TRANSIT: 3,
  OUT_FOR_DELIVERY: 4,
  DELIVERED: 5,
  RTO: 6,
  CANCELLED: 6,
};

/** The status a shipment should take on `incoming`, or null to keep the current one. */
export function nextShipmentStatus(
  current: ShipmentStatus,
  incoming: ShipmentStatus | null,
): ShipmentStatus | null {
  if (!incoming || incoming === current) return null;
  if (current === 'DELIVERED' || current === 'RTO' || current === 'CANCELLED') return null;
  return RANK[incoming] > RANK[current] ? incoming : null;
}

const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null;

/** Parses a Shiprocket tracking webhook body. Null when it carries no AWB / order id or status. */
export function parseShiprocketWebhook(payload: unknown, now = new Date()): TrackingUpdate | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const currentStatus = str(p.current_status) ?? str(p.shipment_status);
  const awb = str(p.awb);
  const providerOrderId = str(p.sr_order_id);
  if (!currentStatus || (!awb && !providerOrderId)) return null;
  const at = parseShiprocketDate(p.current_timestamp) ?? now;
  const scans: ProviderTrackingScan[] = [];
  if (Array.isArray(p.scans)) {
    for (const raw of p.scans as unknown[]) {
      if (!raw || typeof raw !== 'object') continue;
      const scan = raw as Record<string, unknown>;
      const scanAt = parseShiprocketDate(scan.date);
      const status = str(scan['sr-status-label']) ?? str(scan.status);
      if (!scanAt || !status) continue;
      scans.push({
        at: scanAt,
        status,
        location: str(scan.location),
        description: str(scan.activity),
      });
    }
  }
  return {
    awb,
    providerOrderId,
    courierName: str(p.courier_name),
    currentStatus,
    at,
    scans,
  };
}
