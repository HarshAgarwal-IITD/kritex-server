import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { OrderLifecycleService } from '../orders/order-lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import type { WebhookAckDto } from '../shipping/dto/shipment.dto';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';

interface PaymentEntity {
  id?: string;
  order_id?: string | null;
  amount?: number;
  method?: string | null;
  error_description?: string | null;
}
interface RefundEntity {
  id?: string;
  payment_id?: string;
  amount?: number;
}
interface RazorpayEvent {
  event?: string;
  payload?: {
    payment?: { entity?: PaymentEntity };
    refund?: { entity?: RefundEntity };
  };
}

const ACK: WebhookAckDto = { received: true };

/** Razorpay webhooks (COM-10): the source of truth for captures, failures and refunds (ADR-003). */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: OrderLifecycleService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  /**
   * Verifies `x-razorpay-signature` (HMAC-SHA256 of the raw body with the webhook secret), then
   * applies the event. Every handler is idempotent (keyed by provider payment / refund id), so
   * replays and out-of-order deliveries are acknowledged without double effects.
   */
  async handleRazorpayWebhook(
    rawBody: Buffer | undefined,
    signature: string | undefined,
    eventId: string | undefined,
  ): Promise<WebhookAckDto> {
    if (!rawBody || !signature || !this.gateway.verifyWebhookSignature(rawBody, signature)) {
      throw new AppException(
        'SIGNATURE_INVALID',
        HttpStatus.BAD_REQUEST,
        'Invalid webhook signature',
      );
    }
    let body: RazorpayEvent;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as RazorpayEvent;
    } catch {
      throw new AppException('BAD_REQUEST', HttpStatus.BAD_REQUEST, 'Webhook body is not JSON');
    }
    const event = body.event ?? 'unknown';
    this.logger.log({ event, eventId }, 'razorpay webhook');

    switch (event) {
      case 'payment.captured':
      case 'payment.failed': {
        const p = body.payload?.payment?.entity;
        if (!p?.id || !p.order_id) return ACK;
        const row = await this.prisma.payment.findFirst({
          where: { providerOrderId: p.order_id },
          orderBy: { createdAt: 'asc' },
        });
        if (!row) {
          this.logger.warn({ event, providerOrderId: p.order_id }, 'webhook for an unknown order');
          return ACK;
        }
        if (event === 'payment.captured') {
          await this.lifecycle.confirmGatewayPayment({
            paymentRowId: row.id,
            providerPaymentId: p.id,
            amount: p.amount ?? row.amount,
            method: p.method ?? null,
          });
        } else {
          await this.lifecycle.failGatewayPayment({
            paymentRowId: row.id,
            providerPaymentId: p.id,
            reason: p.error_description ?? null,
          });
        }
        return ACK;
      }
      case 'refund.processed':
      case 'refund.failed': {
        const r = body.payload?.refund?.entity;
        if (!r?.id || !r.payment_id) return ACK;
        const refundId = await this.findOrCreateRefund(r.id, r.payment_id, r.amount ?? 0);
        if (!refundId) return ACK;
        if (event === 'refund.processed') {
          await this.lifecycle.refundProcessed({ refundId, providerRefundId: r.id });
        } else {
          await this.lifecycle.refundFailed(refundId, 'Razorpay reported the refund as failed');
        }
        return ACK;
      }
      default:
        return ACK;
    }
  }

  /** Our Refund row for a provider refund; created for refunds started on the Razorpay dashboard. */
  private async findOrCreateRefund(
    providerRefundId: string,
    providerPaymentId: string,
    amount: number,
  ): Promise<string | null> {
    const existing = await this.prisma.refund.findUnique({ where: { providerRefundId } });
    if (existing) return existing.id;
    const payment = await this.prisma.payment.findUnique({ where: { providerPaymentId } });
    if (!payment) {
      this.logger.warn({ providerRefundId }, 'refund webhook for an unknown payment');
      return null;
    }
    try {
      const created = await this.prisma.refund.create({
        data: {
          paymentId: payment.id,
          amount,
          providerRefundId,
          reason: 'Refund issued on the Razorpay dashboard',
        },
      });
      return created.id;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const again = await this.prisma.refund.findUnique({ where: { providerRefundId } });
        return again?.id ?? null;
      }
      throw err;
    }
  }
}
