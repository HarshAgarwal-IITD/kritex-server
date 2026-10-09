import { timingSafeEqual } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma, Shipment as ShipmentRow } from '@prisma/client';
import type { OrderStatus, ShipmentStatus } from '../common/dto/enums';
import { AppException } from '../common/exceptions/app.exception';
import { AppConfigService } from '../config/app-config.service';
import {
  invalidTransition,
  ORDER_TX,
  OrderLifecycleService,
} from '../orders/order-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AdminShipmentDto,
  CreateShiprocketShipmentDto,
  OrderTrackingDto,
  WebhookAckDto,
} from './dto/shipment.dto';
import { FAKE_SHIPROCKET_WEBHOOK_TOKEN } from './provider/fake-shipping.provider';
import {
  mapShiprocketStatus,
  nextShipmentStatus,
  parseShiprocketWebhook,
} from './provider/shiprocket-payload';
import {
  type CreateProviderOrderInput,
  SHIPPING_PROVIDER,
  type ShipmentParty,
  type ShippingProvider,
  ShippingProviderError,
  type TrackingUpdate,
} from './provider/shipping-provider';
import {
  type StoredScan,
  storedScans,
  toAdminShipmentDto,
  toShipmentDto,
} from './shipment.mappers';
import { ORDER_DELIVERED_EVENT, type OrderDeliveredPayload } from './shipping-events';

/** Orders that can be handed to a courier. */
const SHIPPABLE: readonly OrderStatus[] = ['PAID', 'PROCESSING'];
/** Shipment statuses that mean the parcel has left us. */
const IN_CARRIER_HANDS: readonly ShipmentStatus[] = [
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];
/** A fresh PENDING claim (no Shiprocket ids yet) younger than this blocks a second create. */
const CLAIM_TTL_MS = 2 * 60_000;

/** Defaults when products have no weight / dimensions (Q2: real values come with the import). */
const DEFAULT_ITEM_WEIGHT_GRAMS = 500;
const DEFAULT_BOX_CM = { length: 30, width: 25, height: 5 };

const STATUS_MESSAGES: Partial<Record<ShipmentStatus, string>> = {
  IN_TRANSIT: 'In transit',
  OUT_FOR_DELIVERY: 'Out for delivery',
  RTO: 'Shipment is returning to us (RTO)',
  CANCELLED: 'Shipment cancelled by the courier',
};

const shipmentExists = (message: string, details?: unknown) =>
  new AppException('SHIPMENT_EXISTS', HttpStatus.CONFLICT, message, details);

const providerError = (step: string, err: ShippingProviderError) =>
  new AppException('SHIPROCKET_ERROR', HttpStatus.UNPROCESSABLE_ENTITY, err.message, {
    step,
    provider: err.details ?? null,
  });

const scanKey = (s: { at: string; status: string }) => `${s.at}|${s.status.toUpperCase()}`;

function addressParty(address: unknown, email: string, phone: string): ShipmentParty {
  const a = (address && typeof address === 'object' ? address : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    name: s(a.name),
    phone: s(a.phone) || phone,
    email,
    line1: s(a.line1),
    line2: s(a.line2) || null,
    city: s(a.city),
    state: s(a.state),
    pincode: s(a.pincode),
  };
}

/**
 * Fulfilment (OPS-3, ADR-005): Shiprocket shipments (create → AWB → label → pickup, resumable
 * after a failure by calling the same endpoint again), carrier tracking webhooks and public
 * tracking. Order status changes go through OrderLifecycleService:
 * pickup scheduled → SHIPPED (emits `order.shipped`); carrier "DELIVERED" → DELIVERED (then
 * `order.delivered` from here). Manual shipping stays in `POST /admin/orders/:id/ship`.
 */
@Injectable()
export class ShippingService {
  private readonly logger = new Logger(ShippingService.name);
  /** Orders with a shipment being created by this instance (stops double clicks). */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly events: EventEmitter2,
    private readonly config: AppConfigService,
    @Inject(SHIPPING_PROVIDER) private readonly provider: ShippingProvider,
  ) {}

  // ------------------------------------------------------------------ admin

  async createShiprocketShipment(
    orderId: string,
    input: CreateShiprocketShipmentDto,
    actorId?: string,
  ): Promise<AdminShipmentDto> {
    if (this.inFlight.has(orderId)) {
      throw shipmentExists('A shipment is already being created for this order');
    }
    this.inFlight.add(orderId);
    try {
      let shipment = await this.claim(orderId);
      try {
        if (!shipment.shiprocketShipmentId) {
          const created = await this.provider.createOrder(
            await this.providerInput(shipment, input),
          );
          shipment = await this.prisma.shipment.update({
            where: { id: shipment.id },
            data: {
              shiprocketOrderId: created.providerOrderId,
              shiprocketShipmentId: created.providerShipmentId,
            },
          });
        }
      } catch (err) {
        if (!(err instanceof ShippingProviderError)) throw err;
        // Nothing exists at Shiprocket: drop the claim so the next attempt starts clean.
        await this.prisma.shipment.deleteMany({
          where: { id: shipment.id, shiprocketOrderId: null },
        });
        throw providerError('create_order', err);
      }

      if (!shipment.awb) shipment = await this.assignAwb(shipment, input.courierId, actorId);
      if (!shipment.labelUrl) shipment = await this.generateLabelFor(shipment);
      if (input.schedulePickup) {
        shipment = await this.pickupFor(shipment, actorId ?? null);
      } else {
        const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
        if (order.status === 'PAID') {
          await this.lifecycle.changeStatus(orderId, 'PROCESSING', { actorId: actorId ?? null });
        }
      }
      return toAdminShipmentDto(shipment);
    } finally {
      this.inFlight.delete(orderId);
    }
  }

  /** `POST /admin/shipments/:id/label`: (re)generates the courier label. */
  async generateLabel(shipmentId: string): Promise<AdminShipmentDto> {
    const shipment = await this.findProviderShipment(shipmentId);
    return toAdminShipmentDto(await this.generateLabelFor(shipment));
  }

  /** `POST /admin/shipments/:id/pickup`: schedules the pickup and marks the order SHIPPED. */
  async requestPickup(shipmentId: string, actorId?: string): Promise<AdminShipmentDto> {
    const shipment = await this.findProviderShipment(shipmentId);
    return toAdminShipmentDto(await this.pickupFor(shipment, actorId ?? null));
  }

  /**
   * Locks the order, checks it can ship and returns the shipment to work on: a resumable
   * Shiprocket shipment of this order (not yet handed over), or a new PENDING claim row.
   */
  private async claim(orderId: string): Promise<ShipmentRow> {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.lifecycle.lockOrder(tx, orderId);
      if (!SHIPPABLE.includes(order.status)) throw invalidTransition(order.status, 'SHIPPED');
      const open = await tx.shipment.findFirst({
        where: {
          orderId,
          status: { in: ['PENDING', 'READY_TO_SHIP'] },
          OR: [{ shiprocketOrderId: { not: null } }, { status: 'PENDING' }],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (open) {
        if (!open.shiprocketOrderId && Date.now() - open.updatedAt.getTime() < CLAIM_TTL_MS) {
          throw shipmentExists('A shipment is already being created for this order', {
            shipmentId: open.id,
          });
        }
        return tx.shipment.update({ where: { id: open.id }, data: { updatedAt: new Date() } });
      }
      const handedOver = await tx.shipment.findFirst({
        where: { orderId, status: { in: [...IN_CARRIER_HANDS] } },
      });
      if (handedOver) {
        throw shipmentExists('This order already has a shipment', { shipmentId: handedOver.id });
      }
      return tx.shipment.create({ data: { orderId, status: 'PENDING', events: [] } });
    }, ORDER_TX);
  }

  private async providerInput(
    shipment: ShipmentRow,
    input: CreateShiprocketShipmentDto,
  ): Promise<CreateProviderOrderInput> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: shipment.orderId },
      include: {
        items: { include: { variant: { include: { product: true } } } },
        _count: { select: { shipments: true } },
      },
    });
    const previous = order._count.shipments - 1;
    const products = order.items.map((i) => i.variant?.product ?? null);
    const weight =
      input.weightGrams ??
      order.items.reduce(
        (sum, item, idx) =>
          sum + (products[idx]?.weightGrams ?? DEFAULT_ITEM_WEIGHT_GRAMS) * item.quantity,
        0,
      );
    const maxDim = (pick: (p: NonNullable<(typeof products)[number]>) => number | null) =>
      Math.max(0, ...products.map((p) => (p ? (pick(p) ?? 0) : 0)));
    return {
      channelOrderId: previous > 0 ? `${order.number}-${previous + 1}` : order.number,
      orderDate: order.createdAt,
      pickupLocation: input.pickupLocation ?? this.config.get('SHIPROCKET_PICKUP_LOCATION'),
      billing: addressParty(order.billingAddress, order.email, order.phone),
      shipping: addressParty(order.shippingAddress, order.email, order.phone),
      items: order.items.map((i) => ({
        name:
          i.variantTitle && i.variantTitle !== 'Default'
            ? `${i.productName} (${i.variantTitle})`
            : i.productName,
        sku: i.sku,
        units: i.quantity,
        unitPrice: i.unitPrice,
        discount: i.discount,
        hsn: i.hsnCode,
        taxRate: Number(i.gstRate),
      })),
      shippingCharges: order.shipping,
      total: order.total,
      weightGrams: weight,
      lengthCm: input.lengthCm ?? (maxDim((p) => p.lengthCm) || DEFAULT_BOX_CM.length),
      widthCm: input.widthCm ?? (maxDim((p) => p.widthCm) || DEFAULT_BOX_CM.width),
      heightCm: input.heightCm ?? (maxDim((p) => p.heightCm) || DEFAULT_BOX_CM.height),
    };
  }

  private async assignAwb(
    shipment: ShipmentRow,
    courierId: number | undefined,
    actorId?: string,
  ): Promise<ShipmentRow> {
    let awb;
    try {
      awb = await this.provider.assignAwb(shipment.shiprocketShipmentId!, courierId);
    } catch (err) {
      if (err instanceof ShippingProviderError) throw providerError('assign_awb', err);
      throw err;
    }
    const updated = await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        awb: awb.awb,
        carrier: awb.courierName,
        trackingUrl: this.provider.trackingUrl(awb.awb),
        status: 'READY_TO_SHIP',
        events: this.withScan(shipment, {
          status: 'AWB ASSIGNED',
          description: `AWB ${awb.awb} (${awb.courierName})`,
        }),
      },
    });
    await this.prisma.orderEvent.create({
      data: {
        orderId: shipment.orderId,
        type: 'SHIPMENT_CREATED',
        message: `Shiprocket shipment ${shipment.shiprocketShipmentId}: AWB ${awb.awb} via ${awb.courierName}`,
        internal: true,
        actorId: actorId ?? null,
      },
    });
    return updated;
  }

  private async generateLabelFor(shipment: ShipmentRow): Promise<ShipmentRow> {
    let labelUrl: string;
    try {
      ({ labelUrl } = await this.provider.generateLabel(shipment.shiprocketShipmentId!));
    } catch (err) {
      if (err instanceof ShippingProviderError) throw providerError('generate_label', err);
      throw err;
    }
    return this.prisma.shipment.update({ where: { id: shipment.id }, data: { labelUrl } });
  }

  private async pickupFor(shipment: ShipmentRow, actorId: string | null): Promise<ShipmentRow> {
    let scheduledFor: string | null;
    try {
      ({ scheduledFor } = await this.provider.requestPickup(shipment.shiprocketShipmentId!));
    } catch (err) {
      if (err instanceof ShippingProviderError) throw providerError('request_pickup', err);
      throw err;
    }
    const updated = await this.prisma.shipment.update({
      where: { id: shipment.id },
      data: {
        shippedAt: shipment.shippedAt ?? new Date(),
        events: this.withScan(shipment, {
          status: 'PICKUP SCHEDULED',
          description: scheduledFor ? `Pickup scheduled for ${scheduledFor}` : 'Pickup requested',
        }),
      },
    });
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: shipment.orderId } });
    if (SHIPPABLE.includes(order.status)) {
      await this.lifecycle.changeStatus(order.id, 'SHIPPED', {
        actorId,
        note: `Handed to ${shipment.carrier ?? 'courier'} (AWB ${shipment.awb})`,
      });
    }
    return updated;
  }

  private async findProviderShipment(id: string): Promise<ShipmentRow> {
    const shipment = await this.prisma.shipment.findUnique({ where: { id } });
    if (!shipment) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Shipment not found');
    if (!shipment.shiprocketShipmentId || !shipment.awb) {
      throw new AppException(
        'SHIPMENT_NOT_READY',
        HttpStatus.CONFLICT,
        'Shipment has no Shiprocket AWB yet (create it with POST /admin/orders/{id}/shiprocket)',
      );
    }
    if (shipment.status === 'CANCELLED' || shipment.status === 'RTO') {
      throw new AppException(
        'SHIPMENT_CLOSED',
        HttpStatus.CONFLICT,
        `Shipment is ${shipment.status}`,
      );
    }
    return shipment;
  }

  private withScan(
    shipment: ShipmentRow,
    scan: { status: string; description: string | null },
  ): Prisma.InputJsonValue {
    const events: StoredScan[] = [
      ...storedScans(shipment.events),
      {
        at: new Date().toISOString(),
        status: scan.status,
        location: null,
        description: scan.description,
      },
    ];
    return events as unknown as Prisma.InputJsonValue;
  }

  // ------------------------------------------------------------------ webhook

  private webhookToken(): string | null {
    const token = this.config.get('SHIPROCKET_WEBHOOK_TOKEN');
    if (token) return token;
    return this.config.isProduction ? null : FAKE_SHIPROCKET_WEBHOOK_TOKEN;
  }

  /** Verifies the `x-api-key` token, then updates Shipment + OrderEvent idempotently. */
  async handleWebhook(token: string | undefined, payload: unknown): Promise<WebhookAckDto> {
    const expected = this.webhookToken();
    const a = Buffer.from(token ?? '');
    const b = Buffer.from(expected ?? '');
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED, 'Invalid webhook token');
    }
    const update = parseShiprocketWebhook(payload);
    if (!update) {
      this.logger.warn('Shiprocket webhook without AWB/status ignored');
      return { received: true };
    }
    await this.applyTrackingUpdate(update);
    return { received: true };
  }

  /**
   * Applies a carrier update. Idempotent: scans are de-duplicated, the shipment status only moves
   * forward, and the order is then brought in line with the shipment (SHIPPED / DELIVERED), so a
   * redelivered webhook also repairs an order transition that failed the first time.
   */
  async applyTrackingUpdate(update: TrackingUpdate): Promise<boolean> {
    const found = await this.prisma.shipment.findFirst({
      where: update.awb ? { awb: update.awb } : { shiprocketOrderId: update.providerOrderId },
      orderBy: { createdAt: 'desc' },
    });
    if (!found) {
      this.logger.warn({ awb: update.awb }, 'Shiprocket update for an unknown shipment ignored');
      return false;
    }

    const shipment = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Shipment" WHERE id = ${found.id} FOR UPDATE`;
      const current = await tx.shipment.findUniqueOrThrow({ where: { id: found.id } });
      const existing = storedScans(current.events);
      const seen = new Set(existing.map(scanKey));
      const incoming: StoredScan[] = update.scans.map((s) => ({
        at: s.at.toISOString(),
        status: s.status,
        location: s.location,
        description: s.description,
      }));
      const statuses = new Set(
        [...existing, ...incoming].map((s) => s.status.trim().toUpperCase()),
      );
      if (!statuses.has(update.currentStatus.trim().toUpperCase())) {
        incoming.push({
          at: update.at.toISOString(),
          status: update.currentStatus,
          location: null,
          description: null,
        });
      }
      const added = incoming.filter((s) => {
        const key = scanKey(s);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const next = nextShipmentStatus(current.status, mapShiprocketStatus(update.currentStatus));
      if (added.length === 0 && !next) return current;

      const events = [...existing, ...added].sort((x, y) => x.at.localeCompare(y.at));
      const status = next ?? current.status;
      const updated = await tx.shipment.update({
        where: { id: current.id },
        data: {
          events: events as unknown as Prisma.InputJsonValue,
          status,
          carrier: current.carrier ?? update.courierName,
          ...(IN_CARRIER_HANDS.includes(status) && !current.shippedAt
            ? { shippedAt: update.at }
            : {}),
          ...(status === 'DELIVERED' && !current.deliveredAt ? { deliveredAt: update.at } : {}),
        },
      });
      const message = next ? STATUS_MESSAGES[next] : undefined;
      if (next && message) {
        await tx.orderEvent.create({
          data: {
            orderId: current.orderId,
            type: `SHIPMENT_${next}`,
            message: current.awb ? `${message} (AWB ${current.awb})` : message,
            internal: next === 'RTO' || next === 'CANCELLED',
          },
        });
      }
      return updated;
    }, ORDER_TX);

    await this.syncOrder(shipment);
    return true;
  }

  /** Moves the order to SHIPPED / DELIVERED to match the shipment (no-op when already there). */
  private async syncOrder(shipment: ShipmentRow): Promise<void> {
    if (!IN_CARRIER_HANDS.includes(shipment.status)) return;
    const raced = (err: unknown) =>
      err instanceof AppException && err.code === 'INVALID_TRANSITION';
    let order = await this.prisma.order.findUniqueOrThrow({ where: { id: shipment.orderId } });
    if (SHIPPABLE.includes(order.status)) {
      try {
        await this.lifecycle.changeStatus(order.id, 'SHIPPED', { actorId: null });
      } catch (err) {
        if (!raced(err)) throw err;
      }
      order = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    }
    if (shipment.status !== 'DELIVERED' || order.status !== 'SHIPPED') return;
    try {
      await this.lifecycle.changeStatus(order.id, 'DELIVERED', { actorId: null });
    } catch (err) {
      if (raced(err)) return; // a concurrent update delivered it (and emitted the event)
      throw err;
    }
    const payload: OrderDeliveredPayload = {
      orderId: order.id,
      number: order.number,
      userId: order.userId,
      email: order.email,
    };
    try {
      await this.events.emitAsync(ORDER_DELIVERED_EVENT, payload);
    } catch (err) {
      this.logger.error({ err, orderId: order.id }, 'order.delivered listener failed');
    }
  }

  // ------------------------------------------------------------------ public tracking

  async getTracking(number: string, email: string): Promise<OrderTrackingDto> {
    const order = await this.prisma.order.findUnique({
      where: { number },
      include: {
        shipments: { orderBy: { createdAt: 'asc' } },
        events: { where: { internal: false }, orderBy: { createdAt: 'asc' } },
      },
    });
    // Same answer for "no such order" and "wrong email": no order-number enumeration.
    if (!order || order.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
      throw new AppException(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'No order found with this number and email',
      );
    }
    return {
      orderNumber: order.number,
      status: order.status,
      placedAt: order.createdAt.toISOString(),
      // Claims still being created at Shiprocket carry nothing useful yet.
      shipments: order.shipments.filter((s) => s.status !== 'PENDING').map(toShipmentDto),
      timeline: order.events.map((e) => ({
        type: e.type,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }
}
