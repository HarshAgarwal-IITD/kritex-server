import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { type MailMessage, MailService } from '../auth/mail/mail.service';
import { AppConfigService } from '../config/app-config.service';
import { InvoicesService } from '../invoices/invoices.service';
import {
  ORDER_CANCELLED_EVENT,
  ORDER_PAID_EVENT,
  ORDER_SHIPPED_EVENT,
  type OrderCancelledPayload,
  type OrderEventPayload,
} from '../orders/order-events';
import { PrismaService } from '../prisma/prisma.service';
import { ORDER_DELIVERED_EVENT } from '../shipping/shipping-events';
import { BackgroundTasks } from './background-tasks';
import {
  ORDER_PAYMENT_FAILED_EVENT,
  type OrderPaymentFailedPayload,
  QUOTE_RESPONDED_EVENT,
  type QuoteRespondedPayload,
} from './notification-events';
import type { RenderedEmail } from './templates/layout';
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  type OrderEmailData,
  orderDeliveredEmail,
  orderShippedEmail,
  paymentFailedEmail,
} from './templates/order-emails';
import { quoteRespondedEmail } from './templates/quote-emails';

/** Cancellation reasons used by the reservation-expiry job (gateway timeout / bank-transfer hold). */
const LAPSED_REASON = /not received in time|payment window|expired|lapsed/i;

/**
 * Admin actions take `notifyCustomer`; when the order lifecycle forwards it in the event payload
 * (follow-up in src/orders), `false` suppresses the email. Absent = notify.
 */
const optedOut = (p: object) => (p as { notifyCustomer?: unknown }).notifyCustomer === false;

interface Delivery {
  /** Idempotency key, e.g. `order.paid:<orderId>`. */
  key: string;
  template: string;
  to: string;
  orderId?: string;
  quoteId?: string;
}

/**
 * Customer emails for order and quote events (OPS-1). Every listener returns immediately and
 * sends in the background, so a slow or failing provider never affects the order flow. Each
 * email is claimed in the Notification table by a unique key first: duplicates of an event send
 * nothing, and a FAILED send is retried when the event comes again.
 */
@Injectable()
export class NotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly tasks = new BackgroundTasks(this.logger);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly invoices: InvoicesService,
    private readonly config: AppConfigService,
  ) {}

  /** Waits for in-flight emails (tests, shutdown). */
  drain(): Promise<void> {
    return this.tasks.drain();
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  // ------------------------------------------------------------------ listeners

  @OnEvent(ORDER_PAID_EVENT)
  onOrderPaid(p: OrderEventPayload): void {
    this.tasks.run(`order-confirmation ${p.number}`, () => this.sendOrderConfirmation(p));
  }

  @OnEvent(ORDER_PAYMENT_FAILED_EVENT)
  onPaymentFailed(p: OrderPaymentFailedPayload): void {
    this.tasks.run(`payment-failed ${p.number}`, () => this.sendPaymentFailed(p));
  }

  @OnEvent(ORDER_SHIPPED_EVENT)
  onOrderShipped(p: OrderEventPayload): void {
    if (optedOut(p)) return;
    this.tasks.run(`order-shipped ${p.number}`, () => this.sendShipped(p));
  }

  @OnEvent(ORDER_DELIVERED_EVENT)
  onOrderDelivered(p: OrderEventPayload): void {
    if (optedOut(p)) return;
    this.tasks.run(`order-delivered ${p.number}`, () => this.sendDelivered(p));
  }

  @OnEvent(ORDER_CANCELLED_EVENT)
  onOrderCancelled(p: OrderCancelledPayload): void {
    if (optedOut(p)) return;
    this.tasks.run(`order-cancelled ${p.number}`, () => this.sendCancelled(p));
  }

  @OnEvent(QUOTE_RESPONDED_EVENT)
  onQuoteResponded(p: QuoteRespondedPayload): void {
    this.tasks.run(`quote-responded ${p.number}`, () => this.sendQuoteResponded(p));
  }

  // ------------------------------------------------------------------ senders

  async sendOrderConfirmation(p: OrderEventPayload): Promise<boolean> {
    return this.deliver(
      {
        key: `order.paid:${p.orderId}`,
        template: 'order-confirmation',
        to: p.email,
        orderId: p.orderId,
      },
      async () => {
        const data = await this.orderData(p.orderId);
        let invoice: { number: string; pdf: Buffer | null } | null = null;
        try {
          const issued = await this.invoices.ensureInvoice(p.orderId);
          invoice = { number: issued.number, pdf: await this.invoices.renderPdf(issued) };
        } catch (err) {
          this.logger.error(
            { err: (err as Error).message, orderId: p.orderId },
            'invoice unavailable for the confirmation email',
          );
        }
        const email = await orderConfirmationEmail({
          ...data,
          invoiceNumber: invoice?.number ?? null,
          invoiceAttached: !!invoice?.pdf,
        });
        return this.message(
          'order-confirmation',
          p.email,
          email,
          invoice?.pdf
            ? [
                {
                  filename: `Kritex-invoice-${invoice.number.replace(/\//g, '-')}.pdf`,
                  content: invoice.pdf,
                  contentType: 'application/pdf',
                },
              ]
            : undefined,
        );
      },
    );
  }

  async sendPaymentFailed(p: OrderPaymentFailedPayload): Promise<boolean> {
    const attempt = p.providerPaymentId ?? 'latest';
    return this.deliver(
      {
        key: `order.payment_failed:${p.orderId}:${attempt}`,
        template: 'payment-failed',
        to: p.email,
        orderId: p.orderId,
      },
      async () => {
        const order = await this.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
        const web = this.web();
        const email = await paymentFailedEmail({
          number: order.number,
          customerName: await this.customerName(order.userId, order.shippingAddress),
          total: order.total,
          retryUrl: order.userId
            ? `${web}/account/orders/${order.number}`
            : `${web}/checkout/failure/${order.number}`,
        });
        return this.message('payment-failed', p.email, email);
      },
    );
  }

  async sendShipped(p: OrderEventPayload): Promise<boolean> {
    return this.deliver(
      {
        key: `order.shipped:${p.orderId}`,
        template: 'order-shipped',
        to: p.email,
        orderId: p.orderId,
      },
      async () => {
        const order = await this.prisma.order.findUniqueOrThrow({
          where: { id: p.orderId },
          include: { shipments: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        const shipment = order.shipments[0];
        const email = await orderShippedEmail({
          number: order.number,
          customerName: await this.customerName(order.userId, order.shippingAddress),
          carrier: shipment?.carrier ?? null,
          awb: shipment?.awb ?? null,
          carrierTrackingUrl: shipment?.trackingUrl ?? null,
          trackUrl: this.trackUrl(order.number, order.email),
        });
        return this.message('order-shipped', p.email, email);
      },
    );
  }

  async sendDelivered(p: OrderEventPayload): Promise<boolean> {
    return this.deliver(
      {
        key: `order.delivered:${p.orderId}`,
        template: 'order-delivered',
        to: p.email,
        orderId: p.orderId,
      },
      async () => {
        const order = await this.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
        const email = await orderDeliveredEmail({
          number: order.number,
          customerName: await this.customerName(order.userId, order.shippingAddress),
          orderUrl: this.orderUrl(order),
          returnsUrl: `${this.web()}/legal/returns`,
        });
        return this.message('order-delivered', p.email, email);
      },
    );
  }

  async sendCancelled(p: OrderCancelledPayload): Promise<boolean> {
    return this.deliver(
      {
        key: `order.cancelled:${p.orderId}`,
        template: 'order-cancelled',
        to: p.email,
        orderId: p.orderId,
      },
      async () => {
        const order = await this.prisma.order.findUniqueOrThrow({ where: { id: p.orderId } });
        const email = await orderCancelledEmail({
          number: order.number,
          customerName: await this.customerName(order.userId, order.shippingAddress),
          reason: p.reason,
          paymentLapsed: !p.wasPaid && LAPSED_REASON.test(p.reason),
          wasPaid: p.wasPaid,
          refunded: p.refunded,
          total: order.total,
          shopUrl: `${this.web()}/products`,
        });
        return this.message('order-cancelled', p.email, email);
      },
    );
  }

  async sendQuoteResponded(p: QuoteRespondedPayload): Promise<boolean> {
    // A re-response (new prices / validity) is a new email; a duplicate event is not.
    return this.deliver(
      {
        key: `quote.responded:${p.quoteId}:${p.validUntil}:${p.quotedTotal}`,
        template: 'quote-responded',
        to: p.email,
        quoteId: p.quoteId,
      },
      async () => {
        const email = await quoteRespondedEmail({
          number: p.number,
          contactName: p.contactName,
          organization: p.organization,
          quotedTotal: p.quotedTotal,
          validUntil: p.validUntil,
          quoteUrl: `${this.web()}/account/quotes/${p.number}`,
        });
        return this.message('quote-responded', p.email, email);
      },
    );
  }

  // ------------------------------------------------------------------ delivery

  /** Claims `key`, builds and sends the message. False when already sent / being sent. */
  async deliver(d: Delivery, build: () => Promise<MailMessage>): Promise<boolean> {
    if (!(await this.claim(d))) return false;
    try {
      await this.mail.send(await build());
      await this.prisma.notification.update({
        where: { key: d.key },
        data: { status: 'SENT', error: null },
      });
      return true;
    } catch (err) {
      const message = (err as Error).message.slice(0, 500);
      this.logger.error({ err: message, key: d.key }, `email ${d.template} failed`);
      await this.prisma.notification
        .update({ where: { key: d.key }, data: { status: 'FAILED', error: message } })
        .catch(() => undefined);
      return false;
    }
  }

  private async claim(d: Delivery): Promise<boolean> {
    try {
      await this.prisma.notification.create({
        data: {
          key: d.key,
          template: d.template,
          to: d.to,
          orderId: d.orderId ?? null,
          quoteId: d.quoteId ?? null,
        },
      });
      return true;
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
        throw err;
      }
      // Already claimed: retry only a failed send (one winner).
      const { count } = await this.prisma.notification.updateMany({
        where: { key: d.key, status: 'FAILED' },
        data: { status: 'PENDING', attempts: { increment: 1 } },
      });
      return count === 1;
    }
  }

  private message(
    tag: string,
    to: string,
    email: RenderedEmail,
    attachments?: MailMessage['attachments'],
  ): MailMessage {
    return { tag, to, subject: email.subject, html: email.html, text: email.text, attachments };
  }

  // ------------------------------------------------------------------ data

  private web(): string {
    return this.config.get('WEB_URL').replace(/\/+$/, '');
  }

  private trackUrl(number: string, email: string): string {
    return `${this.web()}/track/${number}?email=${encodeURIComponent(email)}`;
  }

  private orderUrl(order: { number: string; email: string; userId: string | null }): string {
    return order.userId
      ? `${this.web()}/account/orders/${order.number}`
      : this.trackUrl(order.number, order.email);
  }

  private async customerName(userId: string | null, shippingAddress: unknown): Promise<string> {
    const raw =
      shippingAddress && typeof shippingAddress === 'object'
        ? (shippingAddress as Record<string, unknown>).name
        : undefined;
    const name = typeof raw === 'string' ? raw : '';
    if (name) return name;
    if (!userId) return '';
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return user?.name ?? '';
  }

  private async orderData(orderId: string): Promise<OrderEmailData> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    const a = (order.shippingAddress ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === 'string' ? v : '');
    return {
      number: order.number,
      customerName: await this.customerName(order.userId, order.shippingAddress),
      placedAt: order.createdAt,
      items: order.items.map((i) => ({
        name: i.productName,
        variant: i.variantTitle,
        quantity: i.quantity,
        total: i.netTotal || i.lineTotal - i.discount,
      })),
      totals: {
        subtotal: order.subtotal,
        discount: order.discount,
        shipping: order.shipping,
        taxTotal: order.taxTotal,
        total: order.total,
      },
      shippingAddress: [
        s(a.name),
        s(a.line1),
        s(a.line2),
        [s(a.city), s(a.state), s(a.pincode)].filter(Boolean).join(', '),
      ].filter(Boolean),
      orderUrl: this.orderUrl(order),
    };
  }
}
