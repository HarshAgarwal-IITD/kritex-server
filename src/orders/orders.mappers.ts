import type { Order, Prisma } from '@prisma/client';
import type { Address } from '../common/dto/address';
import type { Totals } from '../common/dto/money';
import type { Shipment } from '../shipping/dto/shipment.dto';
import type { z } from 'zod';
import type { adminOrderDetailSchema, adminOrderSummarySchema } from './dto/admin-order.dto';
import type { OrderDetail, orderItemSchema, orderSummarySchema } from './dto/order.dto';
import { adminStatusTransitions, CUSTOMER_CANCELLABLE } from './order-state-machine';

/** Return / exchange window after delivery (policy default Q6: 7-day size exchange). */
export const RETURN_WINDOW_DAYS = 7;

export const orderDetailInclude = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      variant: {
        select: {
          options: true,
          product: {
            select: {
              slug: true,
              images: {
                orderBy: { sortOrder: 'asc' },
                select: { url: true, variantOptionValue: true },
              },
            },
          },
        },
      },
    },
  },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: { refunds: { orderBy: { createdAt: 'asc' } } },
  },
  shipments: { orderBy: { createdAt: 'asc' } },
  events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
  invoice: { select: { number: true, issuedAt: true } },
  quote: { select: { number: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithDetail = Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>;
type DetailItem = OrderWithDetail['items'][number];

export function toTotals(order: Order): Totals {
  return {
    subtotal: order.subtotal,
    discount: order.discount,
    shipping: order.shipping,
    taxTotal: order.taxTotal,
    cgst: order.cgst,
    sgst: order.sgst,
    igst: order.igst,
    total: order.total,
    currency: 'INR',
  };
}

/** The variant's colour image when there is one, else the product's first image. */
export function pickImage(
  images: readonly { url: string; variantOptionValue: string | null }[],
  options: unknown,
): string | null {
  const values = new Set(
    options && typeof options === 'object' ? Object.values(options as Record<string, unknown>) : [],
  );
  return (
    images.find((i) => i.variantOptionValue && values.has(i.variantOptionValue))?.url ??
    images.find((i) => !i.variantOptionValue)?.url ??
    images[0]?.url ??
    null
  );
}

export function toOrderItem(item: DetailItem): z.infer<typeof orderItemSchema> {
  return {
    id: item.id,
    variantId: item.variantId,
    productSlug: item.variant?.product.slug ?? null,
    productName: item.productName,
    variantTitle: item.variantTitle,
    sku: item.sku,
    hsnCode: item.hsnCode,
    image: item.variant ? pickImage(item.variant.product.images, item.variant.options) : null,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    gstRate: Number(item.gstRate),
    taxAmount: item.taxAmount,
    lineTotal: item.lineTotal,
    discount: item.discount,
    netTotal: item.netTotal,
  };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function toAddress(json: Prisma.JsonValue): Address {
  const a = (json ?? {}) as Record<string, unknown>;
  return {
    name: str(a.name),
    phone: str(a.phone),
    line1: str(a.line1),
    line2: typeof a.line2 === 'string' && a.line2 ? a.line2 : null,
    city: str(a.city),
    state: str(a.state),
    stateCode: a.stateCode as Address['stateCode'],
    pincode: str(a.pincode),
    country: 'IN',
  };
}

function toShipment(s: OrderWithDetail['shipments'][number]): Shipment {
  const events = Array.isArray(s.events) ? (s.events as Record<string, unknown>[]) : [];
  return {
    id: s.id,
    carrier: s.carrier,
    awb: s.awb,
    trackingUrl: s.trackingUrl,
    status: s.status,
    events: events
      .filter((e) => e && typeof e.at === 'string' && typeof e.status === 'string')
      .map((e) => ({
        at: new Date(e.at as string).toISOString(),
        status: e.status as string,
        location: typeof e.location === 'string' ? e.location : null,
        description: typeof e.description === 'string' ? e.description : null,
      })),
    shippedAt: s.shippedAt?.toISOString() ?? null,
    deliveredAt: s.deliveredAt?.toISOString() ?? null,
  };
}

/** When the order was delivered: the DELIVERED status event, else a shipment's deliveredAt. */
export function deliveredAt(order: OrderWithDetail): Date | null {
  const event = [...order.events].reverse().find((e) => e.type === 'DELIVERED');
  if (event) return event.createdAt;
  const times = order.shipments.map((s) => s.deliveredAt?.getTime() ?? 0).filter((t) => t > 0);
  return times.length ? new Date(Math.max(...times)) : null;
}

export function canRequestReturn(order: OrderWithDetail, now: Date): boolean {
  if (order.status !== 'DELIVERED') return false;
  const at = deliveredAt(order);
  return !!at && now.getTime() - at.getTime() <= RETURN_WINDOW_DAYS * 86_400_000;
}

/** Latest payment's status (null before any payment record). */
function latestPaymentStatus(order: {
  payments: { status: OrderWithDetail['payments'][number]['status'] }[];
}) {
  return order.payments.length ? order.payments[order.payments.length - 1].status : null;
}

export function toOrderDetail(order: OrderWithDetail, now: Date = new Date()): OrderDetail {
  return {
    number: order.number,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: latestPaymentStatus(order),
    email: order.email,
    phone: order.phone,
    shippingAddress: toAddress(order.shippingAddress),
    billingAddress: toAddress(order.billingAddress),
    gstin: order.gstin,
    businessName: order.businessName,
    couponCode: order.couponCode,
    items: order.items.map(toOrderItem),
    totals: toTotals(order),
    shipments: order.shipments.map(toShipment),
    timeline: order.events
      .filter((e) => !e.internal)
      .map((e) => ({ type: e.type, message: e.message, createdAt: e.createdAt.toISOString() })),
    invoice: order.invoice
      ? { number: order.invoice.number, issuedAt: order.invoice.issuedAt.toISOString() }
      : null,
    quoteNumber: order.quote?.number ?? null,
    reservedUntil: order.reservedUntil?.toISOString() ?? null,
    canCancel: CUSTOMER_CANCELLABLE.includes(order.status),
    canRequestReturn: canRequestReturn(order, now),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export function toAdminOrderDetail(
  order: OrderWithDetail,
  actors: Map<string, string>,
  now: Date = new Date(),
): z.infer<typeof adminOrderDetailSchema> {
  const { shipments: _s, timeline: _t, ...base } = toOrderDetail(order, now);
  return {
    ...base,
    id: order.id,
    userId: order.userId,
    shipments: order.shipments.map((s) => ({
      ...toShipment(s),
      shiprocketOrderId: s.shiprocketOrderId,
      shiprocketShipmentId: s.shiprocketShipmentId,
      labelUrl: s.labelUrl,
      manual: s.shiprocketOrderId === null,
    })),
    payments: order.payments.map((p) => ({
      id: p.id,
      provider: p.provider,
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId,
      amount: p.amount,
      status: p.status,
      reference: p.reference,
      createdAt: p.createdAt.toISOString(),
    })),
    refunds: order.payments.flatMap((p) =>
      p.refunds.map((r) => ({
        id: r.id,
        paymentId: r.paymentId,
        amount: r.amount,
        reason: r.reason,
        providerRefundId: r.providerRefundId,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    ),
    events: order.events.map((e) => ({
      id: e.id,
      type: e.type,
      message: e.message,
      actor: e.actorId ? { id: e.actorId, name: actors.get(e.actorId) ?? 'Unknown user' } : null,
      internal: e.internal,
      createdAt: e.createdAt.toISOString(),
    })),
    refundableAmount: order.payments
      .filter((p) => p.status === 'CAPTURED')
      .reduce(
        (sum, p) =>
          sum +
          Math.max(
            0,
            p.amount -
              p.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amount, 0),
          ),
        0,
      ),
    allowedTransitions: adminStatusTransitions(order.status),
  };
}

export const orderSummaryInclude = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      quantity: true,
      variant: {
        select: {
          options: true,
          product: {
            select: {
              images: {
                orderBy: { sortOrder: 'asc' },
                select: { url: true, variantOptionValue: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export type OrderWithSummary = Prisma.OrderGetPayload<{ include: typeof orderSummaryInclude }>;

export function toOrderSummary(order: OrderWithSummary): z.infer<typeof orderSummarySchema> {
  const first = order.items.find((i) => i.variant);
  return {
    number: order.number,
    status: order.status,
    paymentMethod: order.paymentMethod,
    total: order.total,
    itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
    image: first?.variant ? pickImage(first.variant.product.images, first.variant.options) : null,
    createdAt: order.createdAt.toISOString(),
  };
}

export const adminSummaryInclude = {
  items: { select: { quantity: true } },
  user: { select: { name: true } },
  payments: { orderBy: { createdAt: 'asc' }, select: { status: true } },
} satisfies Prisma.OrderInclude;

export type OrderWithAdminSummary = Prisma.OrderGetPayload<{ include: typeof adminSummaryInclude }>;

export function toAdminOrderSummary(
  order: OrderWithAdminSummary,
): z.infer<typeof adminOrderSummarySchema> {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentMethod: order.paymentMethod,
    paymentStatus: latestPaymentStatus(order),
    customerName: order.user?.name ?? toAddress(order.shippingAddress).name,
    email: order.email,
    phone: order.phone,
    isGuest: order.userId === null,
    isB2B: order.gstin !== null,
    itemCount: order.items.reduce((s, i) => s + i.quantity, 0),
    total: order.total,
    createdAt: order.createdAt.toISOString(),
  };
}
