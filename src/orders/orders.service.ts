import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import type { PlacedOrder } from '../checkout/dto/checkout.dto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CancelOrderDto,
  ListMyOrdersQueryDto,
  OrderDetail,
  OrderListDto,
  RequestReturnDto,
} from './dto/order.dto';
import { OrderLifecycleService, orderNotFound } from './order-lifecycle.service';
import { OrderPaymentsService } from './order-payments.service';
import {
  canRequestReturn,
  orderDetailInclude,
  orderSummaryInclude,
  RETURN_WINDOW_DAYS,
  toOrderDetail,
  toOrderSummary,
} from './orders.mappers';

/** Customer order endpoints (COM-13, COM-16). Orders not owned by the user are 404 (no IDOR). */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly payments: OrderPaymentsService,
  ) {}

  async listMyOrders(userId: string, query: ListMyOrdersQueryDto): Promise<OrderListDto> {
    const where: Prisma.OrderWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
    };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: orderSummaryInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.order.count({ where }),
    ]);
    return { items: orders.map(toOrderSummary), page: query.page, limit: query.limit, total };
  }

  async getMyOrder(userId: string, number: string): Promise<OrderDetail> {
    return toOrderDetail(await this.findOwned(userId, number));
  }

  async cancelMyOrder(userId: string, number: string, input: CancelOrderDto): Promise<OrderDetail> {
    const order = await this.findOwned(userId, number);
    await this.lifecycle.cancel(order.id, {
      reason: input.reason ?? 'cancelled by customer',
      restock: true,
      refund: true,
      actorId: userId,
      notCancellableCode: 'ORDER_NOT_CANCELLABLE',
    });
    return this.getMyOrder(userId, number);
  }

  async requestReturn(
    userId: string,
    number: string,
    input: RequestReturnDto,
  ): Promise<OrderDetail> {
    const order = await this.findOwned(userId, number);
    const notAllowed = () =>
      new AppException(
        'RETURN_NOT_ALLOWED',
        HttpStatus.CONFLICT,
        `Returns are accepted within ${RETURN_WINDOW_DAYS} days of delivery`,
        { status: order.status },
      );
    if (!canRequestReturn(order, new Date())) throw notAllowed();

    // Lines must belong to the order, within the ordered quantity.
    const requested = new Map<string, number>();
    for (const line of input.items) {
      requested.set(line.orderItemId, (requested.get(line.orderItemId) ?? 0) + line.quantity);
    }
    for (const [itemId, qty] of requested) {
      const item = order.items.find((i) => i.id === itemId);
      if (!item || qty > item.quantity) {
        throw new AppException(
          'INVALID_RETURN_ITEMS',
          HttpStatus.UNPROCESSABLE_ENTITY,
          'Return items must be lines of this order, within the ordered quantity',
          { orderItemId: itemId },
        );
      }
    }
    const exchangeIds = [
      ...new Set(input.items.map((i) => i.exchangeVariantId).filter((v): v is string => !!v)),
    ];
    if (exchangeIds.length) {
      const found = await this.prisma.variant.count({
        where: { id: { in: exchangeIds }, isActive: true },
      });
      if (found !== exchangeIds.length) {
        throw new AppException(
          'INVALID_RETURN_ITEMS',
          HttpStatus.UNPROCESSABLE_ENTITY,
          'Exchange variant not found',
        );
      }
    }

    const label = input.type === 'EXCHANGE' ? 'Exchange' : 'Return';
    const details = [
      `${label} request (${input.reason})`,
      ...input.items.map((i) => {
        const item = order.items.find((o) => o.id === i.orderItemId);
        const exchange = i.exchangeVariantId ? ` → variant ${i.exchangeVariantId}` : '';
        return `- ${item?.sku ?? i.orderItemId} × ${i.quantity}${exchange}`;
      }),
      ...(input.notes ? [`Notes: ${input.notes}`] : []),
    ].join('\n');
    await this.lifecycle.requestReturn(order.id, `${label} requested`, details, userId, (locked) =>
      locked.status === 'DELIVERED' ? Promise.resolve() : Promise.reject(notAllowed()),
    );
    return this.getMyOrder(userId, number);
  }

  /**
   * COM-16: a fresh gateway order for an unpaid Razorpay order (e.g. after the Checkout modal
   * was closed and the page reloaded). Only while the stock reservation is still valid.
   */
  async payMyOrder(userId: string, number: string): Promise<PlacedOrder> {
    const order = await this.findOwned(userId, number);
    if (
      order.status !== 'PENDING_PAYMENT' ||
      order.paymentMethod !== 'RAZORPAY' ||
      !order.reservedUntil ||
      order.reservedUntil.getTime() <= Date.now()
    ) {
      throw new AppException(
        'ORDER_NOT_PAYABLE',
        HttpStatus.CONFLICT,
        'This order is not awaiting an online payment',
        { status: order.status },
      );
    }
    const payment = await this.payments.ensureGatewayOrder(order.id, { forceNew: true });
    const fresh = await this.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    return this.payments.placedOrder(fresh, payment);
  }

  private async findOwned(userId: string, number: string) {
    const order = await this.prisma.order.findFirst({
      where: { number, userId },
      include: orderDetailInclude,
    });
    if (!order) throw orderNotFound();
    return order;
  }
}
