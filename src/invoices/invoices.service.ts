import { HttpStatus, Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { type Invoice, Prisma } from '@prisma/client';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import type { OrderStatus } from '../common/dto/enums';
import { AppException } from '../common/exceptions/app.exception';
import { AppConfigService } from '../config/app-config.service';
import { BackgroundTasks } from '../notifications/background-tasks';
import { ORDER_PAID_EVENT, type OrderEventPayload } from '../orders/order-events';
import { PrismaService } from '../prisma/prisma.service';
import type { InvoiceLinkDto } from './dto/invoice.dto';
import { buildInvoiceData, type SellerConfig } from './invoice-data';
import { financialYear, formatInvoiceNumber } from './invoice-number';
import { renderInvoicePdf } from './invoice-pdf';
import {
  INVOICE_LINK_TTL_SECONDS,
  INVOICE_STORAGE,
  type InvoiceStorage,
  newInvoiceKey,
} from './invoice-storage';

/**
 * Statuses in which an order has been paid and not cancelled/refunded: an invoice is issued for
 * these (on `order.paid`, or lazily when asked for). Cancelled/refunded orders keep the invoice
 * they already have (credit notes are a follow-up).
 */
const INVOICEABLE: readonly OrderStatus[] = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
];

const STAFF_ROLES = ['STAFF', 'ADMIN'];

const noInvoice = () =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'No invoice has been issued for this order');

/**
 * GST tax invoices (OPS-2, ADR-006). One invoice per paid order, numbered `<prefix>/<FY>/<seq>`
 * gap-free per financial year: the counter row is incremented in the same transaction that inserts
 * the invoice, so a losing concurrent attempt (unique orderId) rolls its increment back.
 * The PDF is rendered from the order snapshot and stored privately (InvoiceStorage); `pdfUrl`
 * holds the storage key.
 */
@Injectable()
export class InvoicesService implements OnModuleDestroy {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly tasks = new BackgroundTasks(this.logger);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    @Inject(INVOICE_STORAGE) private readonly storage: InvoiceStorage,
  ) {}

  @OnEvent(ORDER_PAID_EVENT)
  onOrderPaid(payload: OrderEventPayload): void {
    this.tasks.run(`invoice for ${payload.number}`, () => this.ensureInvoice(payload.orderId));
  }

  /** Waits for background invoice work (tests, shutdown). */
  drain(): Promise<void> {
    return this.tasks.drain();
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  seller(): SellerConfig {
    return {
      legalName: this.config.get('SELLER_LEGAL_NAME'),
      gstin: this.config.get('SELLER_GSTIN') ?? null,
      addressLines: this.config
        .get('SELLER_ADDRESS')
        .split('|')
        .map((l) => l.trim())
        .filter(Boolean),
      stateCode: this.config.get('BUSINESS_STATE_CODE'),
      email: this.config.get('SELLER_EMAIL') ?? null,
      phone: this.config.get('SELLER_PHONE') ?? null,
    };
  }

  /** Issues the order's invoice (once) and stores its PDF (once). Idempotent and concurrency-safe. */
  async ensureInvoice(orderId: string, now: Date = new Date()): Promise<Invoice> {
    const invoice = await this.issue(orderId, now);
    return invoice.pdfUrl ? invoice : this.storePdf(invoice);
  }

  /** Allocates the number and inserts the Invoice row (no PDF yet). */
  async issue(orderId: string, now: Date = new Date()): Promise<Invoice> {
    const existing = await this.prisma.invoice.findUnique({ where: { orderId } });
    if (existing) return existing;
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!order) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Order not found');
    if (!INVOICEABLE.includes(order.status)) throw noInvoice();

    const fy = financialYear(now);
    const prefix = this.config.get('INVOICE_PREFIX');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const [{ last }] = await tx.$queryRaw<{ last: number }[]>`
          INSERT INTO "InvoiceCounter" (fy, last) VALUES (${fy}, 1)
          ON CONFLICT (fy) DO UPDATE SET last = "InvoiceCounter".last + 1
          RETURNING last`;
        return tx.invoice.create({
          data: { orderId, fy, number: formatInvoiceNumber(prefix, fy, last), issuedAt: now },
        });
      });
    } catch (err) {
      // Another request issued it first (unique orderId): its number stands, ours rolled back.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return this.prisma.invoice.findUniqueOrThrow({ where: { orderId } });
      }
      throw err;
    }
  }

  /** Renders the PDF for an issued invoice. Deterministic for the same order snapshot. */
  async renderPdf(invoice: Invoice): Promise<Buffer> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: invoice.orderId },
      include: { items: { orderBy: { createdAt: 'asc' } } },
    });
    return renderInvoicePdf(
      buildInvoiceData({
        number: invoice.number,
        issuedAt: invoice.issuedAt,
        order,
        seller: this.seller(),
      }),
    );
  }

  private async storePdf(invoice: Invoice): Promise<Invoice> {
    const pdf = await this.renderPdf(invoice);
    const key = newInvoiceKey();
    await this.storage.put(key, pdf);
    const { count } = await this.prisma.invoice.updateMany({
      where: { id: invoice.id, pdfUrl: null },
      data: { pdfUrl: key },
    });
    if (count === 0) {
      // A concurrent call stored its copy first; keep that one.
      return this.prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    }
    return { ...invoice, pdfUrl: key };
  }

  /** `GET /orders/:number/invoice`: the order owner, or STAFF/ADMIN. Others get 404. */
  async getInvoiceLink(
    user: SessionUser | undefined,
    orderNumber: string,
    now: Date = new Date(),
  ): Promise<InvoiceLinkDto> {
    const order = await this.prisma.order.findUnique({
      where: { number: orderNumber },
      select: { id: true, userId: true, status: true, invoice: true },
    });
    const allowed =
      !!user && !!order && (STAFF_ROLES.includes(user.role) || order.userId === user.id);
    if (!order || !allowed) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Order not found');
    }
    if (!order.invoice && !INVOICEABLE.includes(order.status)) throw noInvoice();
    let invoice = order.invoice ?? (await this.issue(order.id, now));
    if (!invoice.pdfUrl) invoice = await this.storePdf(invoice);

    const expiresAt = new Date(now.getTime() + INVOICE_LINK_TTL_SECONDS * 1000);
    return {
      number: invoice.number,
      issuedAt: invoice.issuedAt.toISOString(),
      url: this.storage.signedUrl(invoice.pdfUrl!, expiresAt),
      expiresAt: expiresAt.toISOString(),
    };
  }
}
