import type { Shipment as ShipmentRow } from '@prisma/client';
import type { AdminShipmentDto, Shipment } from './dto/shipment.dto';

export interface StoredScan {
  at: string;
  status: string;
  location: string | null;
  description: string | null;
}

/** Shipment.events JSON → validated scans (bad entries dropped). */
export function storedScans(events: unknown): StoredScan[] {
  if (!Array.isArray(events)) return [];
  return (events as Record<string, unknown>[])
    .filter((e) => e && typeof e.at === 'string' && typeof e.status === 'string')
    .map((e) => ({
      at: new Date(e.at as string).toISOString(),
      status: e.status as string,
      location: typeof e.location === 'string' ? e.location : null,
      description: typeof e.description === 'string' ? e.description : null,
    }));
}

export function toShipmentDto(s: ShipmentRow): Shipment {
  return {
    id: s.id,
    carrier: s.carrier,
    awb: s.awb,
    trackingUrl: s.trackingUrl,
    status: s.status,
    events: storedScans(s.events),
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
  };
}

export function toAdminShipmentDto(s: ShipmentRow): AdminShipmentDto {
  return {
    ...toShipmentDto(s),
    shiprocketOrderId: s.shiprocketOrderId,
    shiprocketShipmentId: s.shiprocketShipmentId,
    labelUrl: s.labelUrl,
    manual: s.shiprocketOrderId === null && s.status !== 'PENDING',
  };
}
