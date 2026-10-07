import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Order, Payment } from '@prisma/client';
import type { Address } from '../common/dto/address';
import { AppException } from '../common/exceptions/app.exception';
import { AppConfigService } from '../config/app-config.service';
import type { PlacedOrder } from '../checkout/dto/checkout.dto';
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
  PaymentGatewayError,
} from '../payments/gateway/payment-gateway';
import { PrismaService } from '../prisma/prisma.service';
import { EVENT } from './order-events';
import { ORDER_TX, OrderLifecycleService } from './order-lifecycle.service';
import { toTotals } from './orders.mappers';

export interface BankTransferConfig {
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
}

/**
 * Gateway orders for checkout and payment retry, and the `PlacedOrderDto` both return.
 * One RAZORPAY `Payment` row (status CREATED) per gateway order.
 */
@Injectable()
export class OrderPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly lifecycle: OrderLifecycleService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /** Bank transfer details, or null when not configured (then BANK_TRANSFER isn't offered). */
  get bankTransfer(): BankTransferConfig | null {
    const accountName = this.config.get('BANK_TRANSFER_ACCOUNT_NAME');
    const accountNumber = this.config.get('BANK_TRANSFER_ACCOUNT_NUMBER');
    const ifsc = this.config.get('BANK_TRANSFER_IFSC');
    const bankName = this.config.get('BANK_TRANSFER_BANK_NAME');
    if (!accountName || !accountNumber || !ifsc || !bankName) return null;
    return { accountName, accountNumber, ifsc, bankName };
  }

  /**
   * Returns the order's open gateway payment, creating a gateway order if there is none
   * (`forceNew`: always create one, for payment retry). Runs under the order row lock so
   * concurrent idempotent retries never create two gateway orders. Returns null (no new gateway
   * order) when the order is no longer PENDING_PAYMENT.
   */
  async ensureGatewayOrder(
    orderId: string,
    options: { forceNew?: boolean } = {},
  ): Promise<Payment | null> {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.lifecycle.lockOrder(tx, orderId);
      if (!options.forceNew) {
        const open = await tx.payment.findFirst({
          where: { orderId, provider: 'RAZORPAY', providerOrderId: { not: null } },
          orderBy: { createdAt: 'desc' },
        });
        if (open) return open;
      }
      if (order.status !== 'PENDING_PAYMENT' || order.paymentMethod !== 'RAZORPAY') return null;
      let gatewayOrder;
      try {
        gatewayOrder = await this.gateway.createOrder({
          amount: order.total,
          receipt: order.number,
          notes: { orderNumber: order.number },
        });
      } catch (err) {
        throw new AppException(
          'PAYMENT_GATEWAY_ERROR',
          HttpStatus.BAD_GATEWAY,
          'Could not start the payment. Please try again.',
          err instanceof PaymentGatewayError ? { provider: err.providerCode ?? null } : undefined,
        );
      }
      const payment = await tx.payment.create({
        data: {
          orderId,
          provider: 'RAZORPAY',
          providerOrderId: gatewayOrder.id,
          amount: gatewayOrder.amount,
          status: 'CREATED',
        },
      });
      if (options.forceNew) {
        await this.lifecycle.addEvent(
          tx,
          orderId,
          EVENT.PAYMENT_RETRY,
          `New payment attempt ${gatewayOrder.id}`,
          {
            internal: true,
          },
        );
      }
      return payment;
    }, ORDER_TX);
  }

  /** `PlacedOrderDto` for an order (checkout response, idempotent replay, payment retry). */
  placedOrder(order: Order, payment: Payment | null): PlacedOrder {
    const shipping = order.shippingAddress as unknown as Address;
    const bank = this.bankTransfer;
    return {
      orderNumber: order.number,
      status: order.status,
      paymentMethod: order.paymentMethod,
      totals: toTotals(order),
      reservedUntil: order.reservedUntil?.toISOString() ?? null,
      razorpay:
        order.paymentMethod === 'RAZORPAY' && payment?.providerOrderId
          ? {
              keyId: this.gateway.keyId,
              orderId: payment.providerOrderId,
              amount: payment.amount,
              currency: 'INR',
              name: 'Kritex',
              description: `Order ${order.number}`,
              prefill: { name: shipping.name, email: order.email, contact: order.phone },
            }
          : null,
      bankTransfer:
        order.paymentMethod === 'BANK_TRANSFER' && bank
          ? { ...bank, reference: order.number, amount: order.total }
          : null,
    };
  }
}
