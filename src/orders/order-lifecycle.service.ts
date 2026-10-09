import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  type InventoryReason,
  type Order,
  type OrderItem,
  type Payment,
  Prisma,
  type Refund,
} from '@prisma/client';
import type { OrderStatus } from '../common/dto/enums';
import { AppException } from '../common/exceptions/app.exception';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  PaymentGatewayError,
} from '../payments/gateway/payment-gateway';
import { PrismaService } from '../prisma/prisma.service';
import {
  EVENT,
  ORDER_CANCELLED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_SHIPPED_EVENT,
  ORDER_DELIVERED_EVENT,
  ORDER_PAYMENT_FAILED_EVENT,
  type OrderCancelledPayload,
  type OrderPaymentFailedPayload,
  type OrderEventPayload,
} from './order-events';
import { canTransition, UNPAID_STATUSES } from './order-state-machine';

export type Tx = Prisma.TransactionClient;
type OrderWithItems = Order & { items: OrderItem[] };

/** Interactive transaction options for order work (row locks, a few statements). */
export const ORDER_TX = { maxWait: 10_000, timeout: 20_000 } as const;

const STATUS_MESSAGES: Partial<Record<OrderStatus, string>> = {
  PAID: 'Payment received',
  PROCESSING: 'Your order is being packed',
  SHIPPED: 'Your order has shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Order cancelled',
  RETURN_REQUESTED: 'Return requested',
  RETURNED: 'Return received',
  REFUNDED: 'Order refunded',
};

export const invalidTransition = (from: OrderStatus, to: OrderStatus) =>
  new AppException(
    'INVALID_TRANSITION',
    HttpStatus.CONFLICT,
    `Order cannot move from ${from} to ${to}`,
    { from, to },
  );

export const orderNotFound = () =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Order not found');

/** Work to do after the transaction commits (events, gateway refunds). */
interface AfterCommit {
  emit: [string, OrderEventPayload | OrderCancelledPayload | OrderPaymentFailedPayload][];
  refunds: { refundId: string }[];
}

const newAfter = (): AfterCommit => ({ emit: [], refunds: [] });

export interface CancelOptions {
  reason: string;
  /** Paid orders: put the units back on hand. Ignored for unpaid orders (reservation released). */
  restock: boolean;
  /** Paid orders: refund captured payments in full. */
  refund: boolean;
  actorId: string | null;
  /** Expiry job: only cancel if still unpaid and reservedUntil <= this time. */
  expiredBefore?: Date;
  /** Error code when the order can't be cancelled (customer: ORDER_NOT_CANCELLABLE). */
  notCancellableCode?: string;
  /** Admin opted out of the customer email. */
  notifyCustomer?: boolean;
}

/**
 * Order lifecycle (COM-12): the only code that changes `Order.status`. Every change runs in a
 * transaction holding the order row lock (`SELECT … FOR UPDATE`), is checked against the state
 * machine, writes an OrderEvent and, after commit, emits `order.paid` / `order.cancelled` /
 * `order.shipped`. Payment/refund handlers are idempotent (keyed by provider payment/refund id).
 */
@Injectable()
export class OrderLifecycleService {
  private readonly logger = new Logger(OrderLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // ---------------------------------------------------------------- helpers

  /** Locks the order row for the rest of the transaction and returns it with its items. */
  async lockOrder(tx: Tx, orderId: string): Promise<OrderWithItems> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (rows.length === 0) throw orderNotFound();
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  }

  async addEvent(
    tx: Tx,
    orderId: string,
    type: string,
    message: string,
    options: { internal?: boolean; actorId?: string | null } = {},
  ): Promise<void> {
    await tx.orderEvent.create({
      data: {
        orderId,
        type,
        message,
        internal: options.internal ?? false,
        actorId: options.actorId ?? null,
      },
    });
  }

  private async setStatus(
    tx: Tx,
    order: Order,
    to: OrderStatus,
    options: { actorId?: string | null; message?: string } = {},
  ): Promise<void> {
    if (!canTransition(order.status, to)) throw invalidTransition(order.status, to);
    await tx.order.update({
      where: { id: order.id },
      data: { status: to, ...(UNPAID_STATUSES.includes(to) ? {} : { reservedUntil: null }) },
    });
    await this.addEvent(tx, order.id, to, options.message ?? STATUS_MESSAGES[to] ?? to, {
      actorId: options.actorId,
    });
    order.status = to;
  }

  private payload(order: Order, notifyCustomer?: boolean): OrderEventPayload {
    return {
      orderId: order.id,
      number: order.number,
      userId: order.userId,
      email: order.email,
      ...(notifyCustomer === false ? { notifyCustomer: false } : {}),
    };
  }

  private async run<T>(work: (tx: Tx, after: AfterCommit) => Promise<T>): Promise<T> {
    const after = newAfter();
    const result = await this.prisma.$transaction((tx) => work(tx, after), ORDER_TX);
    await this.flush(after);
    return result;
  }

  private async flush(after: AfterCommit): Promise<void> {
    for (const { refundId } of after.refunds) await this.submitRefund(refundId);
    for (const [name, payload] of after.emit) {
      try {
        await this.events.emitAsync(name, payload);
      } catch (err) {
        this.logger.error(
          { err, event: name, orderId: payload.orderId },
          'order event listener failed',
        );
      }
    }
  }

  private async moveStock(
    tx: Tx,
    order: OrderWithItems,
    kind: 'reserve-to-sale' | 'release-reservation' | 'restock',
    actorId: string | null,
  ): Promise<void> {
    for (const item of order.items) {
      if (!item.variantId) continue;
      const qty = item.quantity;
      if (kind === 'reserve-to-sale') {
        // GREATEST: a capture must never fail because staff lowered stock below the reservation.
        await tx.$executeRaw`
          UPDATE "Variant" SET stock = GREATEST(stock - ${qty}, 0),
            reserved = GREATEST(reserved - ${qty}, 0), "updatedAt" = now()
          WHERE id = ${item.variantId}`;
        await this.movement(tx, item.variantId, -qty, 'ORDER', order, actorId, 'Sold');
      } else if (kind === 'release-reservation') {
        await tx.$executeRaw`
          UPDATE "Variant" SET reserved = GREATEST(reserved - ${qty}, 0), "updatedAt" = now()
          WHERE id = ${item.variantId}`;
      } else {
        await tx.$executeRaw`
          UPDATE "Variant" SET stock = stock + ${qty}, "updatedAt" = now()
          WHERE id = ${item.variantId}`;
        await this.movement(tx, item.variantId, qty, 'RELEASE', order, actorId, 'Order cancelled');
      }
    }
  }

  private movement(
    tx: Tx,
    variantId: string,
    delta: number,
    reason: InventoryReason,
    order: Order,
    actorId: string | null,
    note: string,
  ) {
    return tx.inventoryMovement.create({
      data: {
        variantId,
        delta,
        reason,
        refId: order.id,
        actorId,
        note: `${note} (${order.number})`,
      },
    });
  }

  /** PENDING_PAYMENT / AWAITING_PAYMENT → PAID: reservation becomes a sale, cart lines cleared. */
  private async markPaidLocked(
    tx: Tx,
    order: OrderWithItems,
    after: AfterCommit,
    actorId: string | null,
  ): Promise<void> {
    await this.setStatus(tx, order, 'PAID', { actorId });
    await this.moveStock(tx, order, 'reserve-to-sale', actorId);
    if (order.cartId) {
      const variantIds = order.items.map((i) => i.variantId).filter((v): v is string => !!v);
      await tx.cartItem.deleteMany({
        where: { cartId: order.cartId, variantId: { in: variantIds } },
      });
      if (order.couponCode) {
        await tx.cart.updateMany({
          where: { id: order.cartId, couponCode: order.couponCode },
          data: { couponCode: null },
        });
      }
    }
    after.emit.push([ORDER_PAID_EVENT, this.payload(order)]);
  }

  // ---------------------------------------------------------------- payments

  /**
   * A gateway payment was captured (verify / webhook). Idempotent per provider payment id.
   * A capture for an order that is no longer awaiting payment (expired/cancelled, or already paid
   * by another attempt) is recorded and refunded in full automatically.
   */
  async confirmGatewayPayment(input: {
    paymentRowId: string;
    providerPaymentId: string;
    amount: number;
    method?: string | null;
  }): Promise<{ order: Order; changed: boolean }> {
    return this.run(async (tx, after) => {
      const row = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentRowId } });
      const order = await this.lockOrder(tx, row.orderId);
      const existing = await tx.payment.findUnique({
        where: { providerPaymentId: input.providerPaymentId },
      });
      if (existing?.status === 'CAPTURED' || existing?.status === 'REFUNDED') {
        return { order, changed: false };
      }

      let payment: Payment;
      if (existing) {
        payment = await tx.payment.update({
          where: { id: existing.id },
          data: { status: 'CAPTURED', raw: rawPayment(input) },
        });
      } else if (row.status === 'CAPTURED' || row.status === 'REFUNDED') {
        // A second successful payment on the same gateway order: keep it as its own row.
        payment = await tx.payment.create({
          data: {
            orderId: order.id,
            provider: row.provider,
            providerOrderId: row.providerOrderId,
            providerPaymentId: input.providerPaymentId,
            amount: input.amount,
            status: 'CAPTURED',
            raw: rawPayment(input),
          },
        });
      } else {
        payment = await tx.payment.update({
          where: { id: row.id },
          data: {
            providerPaymentId: input.providerPaymentId,
            status: 'CAPTURED',
            amount: input.amount || row.amount,
            raw: rawPayment(input),
          },
        });
      }

      if (UNPAID_STATUSES.includes(order.status)) {
        await this.addEvent(
          tx,
          order.id,
          EVENT.PAYMENT_CAPTURED,
          `Payment ${payment.providerPaymentId} captured`,
          {
            internal: true,
          },
        );
        await this.markPaidLocked(tx, order, after, null);
        return { order, changed: true };
      }

      // Late or duplicate capture: give the money back.
      const refund = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amount: payment.amount,
          reason:
            order.status === 'CANCELLED'
              ? 'Payment received after the order was cancelled'
              : 'Duplicate payment',
        },
      });
      await this.addEvent(
        tx,
        order.id,
        EVENT.REFUND_INITIATED,
        `Payment ${payment.providerPaymentId} captured while the order was ${order.status}; refunding it`,
        { internal: true },
      );
      after.refunds.push({ refundId: refund.id });
      return { order, changed: true };
    });
  }

  /** A gateway payment attempt failed. The order stays payable until its reservation expires. */
  async failGatewayPayment(input: {
    paymentRowId: string;
    providerPaymentId: string;
    reason?: string | null;
  }): Promise<{ order: Order; changed: boolean }> {
    return this.run(async (tx, after) => {
      const row = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentRowId } });
      const order = await this.lockOrder(tx, row.orderId);
      const existing = await tx.payment.findUnique({
        where: { providerPaymentId: input.providerPaymentId },
      });
      if (existing) return { order, changed: false }; // already recorded (failed or captured)
      if (row.status === 'CAPTURED' || row.status === 'REFUNDED') return { order, changed: false };
      await tx.payment.update({
        where: { id: row.id },
        data: {
          providerPaymentId: input.providerPaymentId,
          status: 'FAILED',
          raw: { id: input.providerPaymentId, status: 'failed' },
        },
      });
      await this.addEvent(tx, order.id, EVENT.PAYMENT_FAILED, 'Payment failed', {});
      if (input.reason) {
        await this.addEvent(tx, order.id, EVENT.PAYMENT_FAILED, `Gateway: ${input.reason}`, {
          internal: true,
        });
      }
      after.emit.push([
        ORDER_PAYMENT_FAILED_EVENT,
        { ...this.payload(order), providerPaymentId: input.providerPaymentId },
      ]);
      return { order, changed: true };
    });
  }

  /** Offline payment (bank transfer / PO): AWAITING_PAYMENT → PAID. */
  async markOfflinePaid(
    orderId: string,
    input: { reference: string; amount?: number; paidAt?: string; note?: string },
    actorId: string | null,
  ): Promise<void> {
    await this.run(async (tx, after) => {
      const order = await this.lockOrder(tx, orderId);
      if (order.status !== 'AWAITING_PAYMENT') throw invalidTransition(order.status, 'PAID');
      await tx.payment.create({
        data: {
          orderId,
          provider: 'BANK_TRANSFER',
          reference: input.reference,
          amount: input.amount ?? order.total,
          status: 'CAPTURED',
          raw: { reference: input.reference, paidAt: input.paidAt ?? null },
        },
      });
      await this.addEvent(
        tx,
        orderId,
        EVENT.PAYMENT_CAPTURED,
        `Offline payment recorded (ref ${input.reference})${input.note ? `: ${input.note}` : ''}`,
        { internal: true, actorId },
      );
      await this.markPaidLocked(tx, order, after, actorId);
    });
  }

  // ---------------------------------------------------------------- status changes

  /** Plain state-machine move (admin status endpoint) with the side effects of the target. */
  async changeStatus(
    orderId: string,
    to: OrderStatus,
    options: { actorId: string | null; note?: string; notifyCustomer?: boolean },
  ): Promise<void> {
    await this.run(async (tx, after) => {
      const order = await this.lockOrder(tx, orderId);
      await this.setStatus(tx, order, to, { actorId: options.actorId });
      if (options.note) {
        await this.addEvent(tx, orderId, EVENT.NOTE, options.note, {
          internal: true,
          actorId: options.actorId,
        });
      }
      const payload = this.payload(order, options.notifyCustomer);
      if (to === 'SHIPPED') after.emit.push([ORDER_SHIPPED_EVENT, payload]);
      if (to === 'DELIVERED') after.emit.push([ORDER_DELIVERED_EVENT, payload]);
      if (to === 'DELIVERED') {
        await tx.shipment.updateMany({
          where: { orderId, status: { notIn: ['DELIVERED', 'CANCELLED', 'RTO'] } },
          data: { status: 'DELIVERED', deliveredAt: new Date() },
        });
      }
    });
  }

  /** Manual ship (no Shiprocket): records the shipment, PAID/PROCESSING → SHIPPED. */
  async ship(
    orderId: string,
    input: { carrier: string; awb?: string; trackingUrl?: string; notifyCustomer?: boolean },
    actorId: string | null,
  ): Promise<void> {
    await this.run(async (tx, after) => {
      const order = await this.lockOrder(tx, orderId);
      if (!canTransition(order.status, 'SHIPPED')) throw invalidTransition(order.status, 'SHIPPED');
      const now = new Date();
      await tx.shipment.create({
        data: {
          orderId,
          carrier: input.carrier,
          awb: input.awb ?? null,
          trackingUrl: input.trackingUrl ?? null,
          status: 'SHIPPED',
          shippedAt: now,
          events: [
            { at: now.toISOString(), status: 'SHIPPED', location: null, description: 'Shipped' },
          ],
        },
      });
      await this.setStatus(tx, order, 'SHIPPED', {
        actorId,
        message: `Shipped via ${input.carrier}${input.awb ? ` (AWB ${input.awb})` : ''}`,
      });
      after.emit.push([ORDER_SHIPPED_EVENT, this.payload(order, input.notifyCustomer)]);
    });
  }

  /** Customer return / exchange request: DELIVERED → RETURN_REQUESTED. */
  async requestReturn(
    orderId: string,
    summary: string,
    details: string,
    actorId: string | null,
    canRequest: (order: OrderWithItems, tx: Tx) => Promise<void>,
  ): Promise<void> {
    await this.run(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      await canRequest(order, tx);
      await this.setStatus(tx, order, 'RETURN_REQUESTED', { actorId, message: summary });
      await this.addEvent(tx, orderId, EVENT.NOTE, details, { internal: true, actorId });
    });
  }

  /**
   * Cancel: unpaid → release the reservation (and give back the coupon use); paid → optionally
   * restock and refund every captured payment in full. Returns false when the expiry job finds
   * the order no longer expired.
   */
  async cancel(orderId: string, options: CancelOptions): Promise<boolean> {
    return this.run(async (tx, after) => {
      const order = await this.lockOrder(tx, orderId);
      if (options.expiredBefore) {
        if (
          !UNPAID_STATUSES.includes(order.status) ||
          !order.reservedUntil ||
          order.reservedUntil > options.expiredBefore
        ) {
          return false;
        }
      }
      if (!canTransition(order.status, 'CANCELLED')) {
        if (options.notCancellableCode) {
          throw new AppException(
            options.notCancellableCode,
            HttpStatus.CONFLICT,
            `Order is ${order.status} and can no longer be cancelled`,
            { status: order.status },
          );
        }
        throw invalidTransition(order.status, 'CANCELLED');
      }

      const wasPaid = !UNPAID_STATUSES.includes(order.status);
      let refunded = false;
      if (!wasPaid) {
        await this.moveStock(tx, order, 'release-reservation', options.actorId);
        if (order.couponCode) {
          await tx.$executeRaw`
            UPDATE "Coupon" SET "usedCount" = GREATEST("usedCount" - 1, 0), "updatedAt" = now()
            WHERE code = ${order.couponCode}`;
        }
      } else {
        if (options.restock) await this.moveStock(tx, order, 'restock', options.actorId);
        if (options.refund) {
          const plan = await this.refundablePayments(tx, order.id);
          for (const p of plan) {
            const refund = await tx.refund.create({
              data: { paymentId: p.payment.id, amount: p.refundable, reason: options.reason },
            });
            after.refunds.push({ refundId: refund.id });
            refunded = true;
          }
          if (refunded) {
            await this.addEvent(tx, order.id, EVENT.REFUND_INITIATED, 'Refund initiated', {
              actorId: options.actorId,
            });
          }
        }
      }
      await this.setStatus(tx, order, 'CANCELLED', {
        actorId: options.actorId,
        message: `Order cancelled: ${options.reason}`,
      });
      after.emit.push([
        ORDER_CANCELLED_EVENT,
        {
          ...this.payload(order, options.notifyCustomer),
          reason: options.reason,
          wasPaid,
          refunded,
        },
      ]);
      return true;
    });
  }

  // ---------------------------------------------------------------- refunds

  /** Captured payments with money left to refund (captured - non-failed refunds). */
  async refundablePayments(
    tx: Tx,
    orderId: string,
  ): Promise<{ payment: Payment; refundable: number }[]> {
    const payments = await tx.payment.findMany({
      where: { orderId, status: 'CAPTURED' },
      include: { refunds: true },
      orderBy: { createdAt: 'asc' },
    });
    return payments
      .map((payment) => ({
        payment,
        refundable:
          payment.amount -
          payment.refunds.filter((r) => r.status !== 'FAILED').reduce((s, r) => s + r.amount, 0),
      }))
      .filter((p) => p.refundable > 0);
  }

  /**
   * Admin refund (full or partial), optionally restocking returned items. The refund is spread over
   * captured payments, oldest first. Gateway failures surface as 502 PAYMENT_GATEWAY_ERROR.
   */
  async refund(
    orderId: string,
    input: {
      amount: number;
      reason: string;
      restockItems: { orderItemId: string; quantity: number; reason: InventoryReason }[];
    },
    actorId: string | null,
  ): Promise<void> {
    const refundIds = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, orderId);
      const plan = await this.refundablePayments(tx, orderId);
      const available = plan.reduce((s, p) => s + p.refundable, 0);
      if (available === 0) {
        throw new AppException(
          'NOT_REFUNDABLE',
          HttpStatus.CONFLICT,
          'No captured payment to refund',
        );
      }
      if (input.amount > available) {
        throw new AppException(
          'REFUND_EXCEEDS_CAPTURED',
          HttpStatus.CONFLICT,
          'Refund exceeds the captured amount still refundable',
          { refundable: available },
        );
      }
      for (const r of input.restockItems) {
        const item = order.items.find((i) => i.id === r.orderItemId);
        if (!item || !item.variantId || r.quantity > item.quantity) {
          throw new AppException(
            'INVALID_RESTOCK_ITEM',
            HttpStatus.UNPROCESSABLE_ENTITY,
            'Restock item does not match this order',
            { orderItemId: r.orderItemId },
          );
        }
        await tx.$executeRaw`
          UPDATE "Variant" SET stock = stock + ${r.quantity}, "updatedAt" = now()
          WHERE id = ${item.variantId}`;
        await this.movement(
          tx,
          item.variantId,
          r.quantity,
          r.reason,
          order,
          actorId,
          'Refund restock',
        );
      }
      let left = input.amount;
      const ids: string[] = [];
      for (const p of plan) {
        if (left === 0) break;
        const amount = Math.min(left, p.refundable);
        left -= amount;
        const refund = await tx.refund.create({
          data: { paymentId: p.payment.id, amount, reason: input.reason },
        });
        ids.push(refund.id);
      }
      await this.addEvent(tx, orderId, EVENT.REFUND_INITIATED, 'Refund initiated', { actorId });
      await this.addEvent(
        tx,
        orderId,
        EVENT.NOTE,
        `Refund ${input.amount} paise: ${input.reason}`,
        {
          internal: true,
          actorId,
        },
      );
      return ids;
    }, ORDER_TX);

    let failed: PaymentGatewayError | null = null;
    for (const id of refundIds) {
      const error = await this.submitRefund(id);
      failed ??= error;
    }
    if (failed) {
      throw new AppException('PAYMENT_GATEWAY_ERROR', HttpStatus.BAD_GATEWAY, failed.message);
    }
  }

  /** Sends a PENDING refund to the gateway (offline payments are recorded as processed). */
  private async submitRefund(refundId: string): Promise<PaymentGatewayError | null> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true },
    });
    if (refund.status !== 'PENDING' || refund.providerRefundId) return null;
    const payment = refund.payment;
    if (payment.provider !== 'RAZORPAY' || !payment.providerPaymentId) {
      await this.refundProcessed({ refundId, providerRefundId: null });
      return null;
    }
    try {
      const result = await this.gateway.refund(payment.providerPaymentId, {
        amount: refund.amount,
        notes: { refundId, orderId: payment.orderId },
      });
      try {
        await this.prisma.refund.update({
          where: { id: refundId },
          data: { providerRefundId: result.id },
        });
      } catch (err) {
        // The refund webhook beat us and recorded this provider refund as its own row.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          await this.prisma.refund.delete({ where: { id: refundId } });
          return null;
        }
        throw err;
      }
      if (result.status === 'processed') {
        await this.refundProcessed({ refundId, providerRefundId: result.id });
      } else if (result.status === 'failed') {
        await this.refundFailed(refundId, 'Gateway refused the refund');
      }
      return null;
    } catch (err) {
      const error =
        err instanceof PaymentGatewayError ? err : new PaymentGatewayError((err as Error).message);
      this.logger.error({ refundId, err: error.message }, 'refund failed at the gateway');
      await this.refundFailed(refundId, error.message);
      return error;
    }
  }

  async refundFailed(refundId: string, message: string): Promise<void> {
    await this.run(async (tx) => {
      const refund = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        include: { payment: true },
      });
      await this.lockOrder(tx, refund.payment.orderId);
      if (refund.status !== 'PENDING') return;
      await tx.refund.update({ where: { id: refundId }, data: { status: 'FAILED' } });
      await this.addEvent(
        tx,
        refund.payment.orderId,
        EVENT.REFUND_FAILED,
        `Refund failed: ${message}`,
        {
          internal: true,
        },
      );
    });
  }

  /**
   * Refund processed (gateway response or `refund.processed` webhook). Idempotent. When every
   * captured payment is fully refunded the payment(s) become REFUNDED and, where the state machine
   * allows, the order too.
   */
  async refundProcessed(input: {
    refundId: string;
    providerRefundId: string | null;
  }): Promise<boolean> {
    return this.run(async (tx) => {
      const found = await tx.refund.findUniqueOrThrow({
        where: { id: input.refundId },
        include: { payment: true },
      });
      const order = await this.lockOrder(tx, found.payment.orderId);
      const refund: Refund = await tx.refund.findUniqueOrThrow({ where: { id: input.refundId } });
      if (refund.status === 'PROCESSED') return false;
      await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: 'PROCESSED',
          ...(input.providerRefundId && !refund.providerRefundId
            ? { providerRefundId: input.providerRefundId }
            : {}),
        },
      });
      await this.addEvent(tx, order.id, EVENT.REFUND_PROCESSED, 'Refund processed', {});

      const processed = await tx.refund.aggregate({
        where: { paymentId: refund.paymentId, status: 'PROCESSED' },
        _sum: { amount: true },
      });
      if ((processed._sum.amount ?? 0) >= found.payment.amount) {
        await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
      }
      const stillCaptured = await tx.payment.count({
        where: { orderId: order.id, status: 'CAPTURED' },
      });
      const anyRefunded = await tx.payment.count({
        where: { orderId: order.id, status: 'REFUNDED' },
      });
      if (stillCaptured === 0 && anyRefunded > 0 && canTransition(order.status, 'REFUNDED')) {
        await this.setStatus(tx, order, 'REFUNDED', {});
      }
      return true;
    });
  }

  // ---------------------------------------------------------------- reservation expiry

  /**
   * COM-11: cancels unpaid (PENDING_PAYMENT / AWAITING_PAYMENT) orders whose reservation expired before `now`, releasing their
   * stock. Called by the cron job; safe to run concurrently (each order is re-checked under lock).
   */
  async releaseExpiredReservations(now: Date = new Date(), batch = 100): Promise<number> {
    const expired = await this.prisma.order.findMany({
      // Bank-transfer (AWAITING_PAYMENT) orders expire too when BANK_TRANSFER_HOLD_DAYS > 0.
      where: { status: { in: [...UNPAID_STATUSES] }, reservedUntil: { lte: now } },
      select: { id: true },
      orderBy: { reservedUntil: 'asc' },
      take: batch,
    });
    let cancelled = 0;
    for (const { id } of expired) {
      try {
        const done = await this.cancel(id, {
          reason: 'payment not received in time',
          restock: false,
          refund: false,
          actorId: null,
          expiredBefore: now,
        });
        if (done) cancelled += 1;
      } catch (err) {
        this.logger.error(
          { orderId: id, err: (err as Error).message },
          'reservation expiry failed',
        );
      }
    }
    return cancelled;
  }
}

function rawPayment(input: { providerPaymentId: string; amount: number; method?: string | null }) {
  return {
    id: input.providerPaymentId,
    amount: input.amount,
    method: input.method ?? null,
    status: 'captured',
  };
}
