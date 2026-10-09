import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AddOrderNoteDto,
  AdminCancelOrderDto,
  AdminOrderDetailDto,
  AdminOrderListDto,
  ExportOrdersQueryDto,
  ListAdminOrdersQueryDto,
  MarkOrderPaidDto,
  RefundOrderDto,
  ShipOrderDto,
  UpdateOrderStatusDto,
} from '../dto/admin-order.dto';
import { EVENT } from '../order-events';
import {
  invalidTransition,
  OrderLifecycleService,
  orderNotFound,
} from '../order-lifecycle.service';
import { adminStatusTransitions } from '../order-state-machine';
import {
  adminSummaryInclude,
  orderDetailInclude,
  toAddress,
  toAdminOrderDetail,
  toAdminOrderSummary,
} from '../orders.mappers';

/** Rows cap for the CSV export (one row per order item). */
export const EXPORT_MAX_ORDERS = 10_000;

type Filters = ExportOrdersQueryDto;

export function orderFilterWhere(f: Filters): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  if (f.status) and.push({ status: f.status });
  if (f.paymentMethod) and.push({ paymentMethod: f.paymentMethod });
  if (f.paymentStatus) and.push({ payments: { some: { status: f.paymentStatus } } });
  if (f.userId) and.push({ userId: f.userId });
  if (f.from || f.to) {
    and.push({
      createdAt: {
        ...(f.from ? { gte: new Date(f.from) } : {}),
        ...(f.to ? { lt: new Date(f.to) } : {}),
      },
    });
  }
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { number: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q } },
        { user: { name: { contains: q, mode: 'insensitive' } } },
        { shippingAddress: { path: ['name'], string_contains: q } },
        { businessName: { contains: q, mode: 'insensitive' } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

const SORTS: Record<ListAdminOrdersQueryDto['sort'], Prisma.OrderOrderByWithRelationInput[]> = {
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  oldest: [{ createdAt: 'asc' }, { id: 'asc' }],
  total_desc: [{ total: 'desc' }, { createdAt: 'desc' }],
};

/** CSV cell: quoted when needed; formula-looking text is prefixed with ' (CSV injection). */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  'order_number',
  'created_at',
  'status',
  'payment_method',
  'payment_status',
  'customer_name',
  'email',
  'phone',
  'gstin',
  'business_name',
  'ship_city',
  'ship_state',
  'ship_state_code',
  'ship_pincode',
  'coupon_code',
  'sku',
  'product_name',
  'variant_title',
  'hsn_code',
  'quantity',
  'unit_price_paise',
  'line_total_paise',
  'line_discount_paise',
  'line_net_paise',
  'gst_rate',
  'line_tax_paise',
  'order_subtotal_paise',
  'order_discount_paise',
  'order_shipping_paise',
  'order_cgst_paise',
  'order_sgst_paise',
  'order_igst_paise',
  'order_total_paise',
] as const;

/** Admin order management (COM-14). Status changes go through OrderLifecycleService. */
@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
  ) {}

  async list(query: ListAdminOrdersQueryDto): Promise<AdminOrderListDto> {
    const where = orderFilterWhere(query);
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: adminSummaryInclude,
        orderBy: SORTS[query.sort],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: orders.map(toAdminOrderSummary), page: query.page, limit: query.limit, total };
  }

  async exportCsv(query: ExportOrdersQueryDto): Promise<string> {
    const orders = await this.prisma.order.findMany({
      where: orderFilterWhere(query),
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: EXPORT_MAX_ORDERS,
      include: {
        items: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        user: { select: { name: true } },
        payments: { orderBy: { createdAt: 'asc' }, select: { status: true } },
      },
    });
    const lines = [CSV_COLUMNS.join(',')];
    for (const o of orders) {
      const ship = toAddress(o.shippingAddress);
      const paymentStatus = o.payments.length ? o.payments[o.payments.length - 1].status : '';
      for (const i of o.items) {
        const row: (string | number | null)[] = [
          o.number,
          o.createdAt.toISOString(),
          o.status,
          o.paymentMethod,
          paymentStatus,
          o.user?.name ?? ship.name,
          o.email,
          o.phone,
          o.gstin,
          o.businessName,
          ship.city,
          ship.state,
          ship.stateCode,
          ship.pincode,
          o.couponCode,
          i.sku,
          i.productName,
          i.variantTitle,
          i.hsnCode,
          i.quantity,
          i.unitPrice,
          i.lineTotal,
          i.discount,
          i.netTotal,
          Number(i.gstRate),
          i.taxAmount,
          o.subtotal,
          o.discount,
          o.shipping,
          o.cgst,
          o.sgst,
          o.igst,
          o.total,
        ];
        lines.push(row.map(csvCell).join(','));
      }
    }
    return `${lines.join('\r\n')}\r\n`;
  }

  async get(id: string): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderDetailInclude,
    });
    if (!order) throw orderNotFound();
    const actorIds = [
      ...new Set(order.events.map((e) => e.actorId).filter((a): a is string => !!a)),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    return toAdminOrderDetail(order, new Map(actors.map((a) => [a.id, a.name])));
  }

  async updateStatus(
    id: string,
    input: UpdateOrderStatusDto,
    actorId?: string,
  ): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { status: true } });
    if (!order) throw orderNotFound();
    if (!adminStatusTransitions(order.status).includes(input.status)) {
      throw invalidTransition(order.status, input.status);
    }
    if (input.status === 'CANCELLED') {
      await this.lifecycle.cancel(id, {
        reason: input.note ?? 'cancelled by staff',
        restock: true,
        refund: true,
        actorId: actorId ?? null,
        notifyCustomer: input.notifyCustomer,
      });
    } else {
      await this.lifecycle.changeStatus(id, input.status, {
        actorId: actorId ?? null,
        note: input.note,
        notifyCustomer: input.notifyCustomer,
      });
    }
    return this.get(id);
  }

  async ship(id: string, input: ShipOrderDto, actorId?: string): Promise<AdminOrderDetailDto> {
    await this.lifecycle.ship(id, input, actorId ?? null);
    return this.get(id);
  }

  async cancel(
    id: string,
    input: AdminCancelOrderDto,
    actorId?: string,
  ): Promise<AdminOrderDetailDto> {
    await this.lifecycle.cancel(id, {
      reason: input.reason,
      restock: input.restock,
      refund: input.refund,
      actorId: actorId ?? null,
      notifyCustomer: input.notifyCustomer,
    });
    return this.get(id);
  }

  async refund(id: string, input: RefundOrderDto, actorId?: string): Promise<AdminOrderDetailDto> {
    await this.lifecycle.refund(id, input, actorId ?? null);
    return this.get(id);
  }

  async markPaid(
    id: string,
    input: MarkOrderPaidDto,
    actorId?: string,
  ): Promise<AdminOrderDetailDto> {
    await this.lifecycle.markOfflinePaid(id, input, actorId ?? null);
    return this.get(id);
  }

  async addNote(
    id: string,
    input: AddOrderNoteDto,
    actorId?: string,
  ): Promise<AdminOrderDetailDto> {
    const exists = await this.prisma.order.count({ where: { id } });
    if (!exists) throw orderNotFound();
    await this.lifecycle.addEvent(this.prisma, id, EVENT.NOTE, input.message, {
      internal: input.internal,
      actorId: actorId ?? null,
    });
    return this.get(id);
  }
}
