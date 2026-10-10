import { createHash, randomInt } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, type Quote } from '@prisma/client';
import { CheckoutService, snapshot } from '../checkout/checkout.service';
import type { PlacedOrder } from '../checkout/dto/checkout.dto';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { idempotencyKeySchema } from '../common/dto/common';
import { AppException } from '../common/exceptions/app.exception';
import { EVENT } from '../orders/order-events';
import { ORDER_TX, OrderLifecycleService } from '../orders/order-lifecycle.service';
import { OrderPaymentsService } from '../orders/order-payments.service';
import { TotalsService, validateGstin } from '../pricing';
import { PrismaService } from '../prisma/prisma.service';
import type {
  AcceptQuoteDto,
  CreateQuoteDto,
  CreateQuoteResponseDto,
  ListMyQuotesQueryDto,
  QuoteDetailDto,
  QuoteListDto,
} from './dto/quote.dto';
import {
  QUOTE_ACCEPTED_EVENT,
  QUOTE_REQUESTED_EVENT,
  type QuoteAcceptedPayload,
  type QuoteEventPayload,
} from './quote-events';
import { quoteInclude, toQuoteDetail, toQuoteSummary } from './quotes.mappers';

type Tx = Prisma.TransactionClient;

export const quoteNotFound = () =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Quote not found');

const notAcceptable = (message: string, details: Record<string, unknown>) =>
  new AppException('QUOTE_NOT_ACCEPTABLE', HttpStatus.CONFLICT, message, details);

const isUniqueViolation = (err: unknown, field: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta?.target ?? '').includes(field);

export function quotePayload(quote: Quote): QuoteEventPayload {
  return {
    quoteId: quote.id,
    number: quote.number,
    userId: quote.userId,
    email: quote.email,
    contactName: quote.contactName,
    organization: quote.organization,
  };
}

/** Emits after commit; a failing listener never fails the request. */
export async function emitQuoteEvent(
  events: EventEmitter2,
  logger: Logger,
  name: string,
  payload: QuoteEventPayload,
): Promise<void> {
  try {
    await events.emitAsync(name, payload);
  } catch (err) {
    logger.error({ err, event: name, quoteId: payload.quoteId }, 'quote event listener failed');
  }
}

/**
 * B2B quotes (B2B-1). A user sees quotes they created while signed in, plus quotes whose email
 * matches their verified email. Anything else is 404 (no IDOR).
 *
 * Status flow: REQUESTED → QUOTED (staff respond; re-respond allowed) → CONVERTED (accepted: an
 * order exists at the quoted prices). REQUESTED/QUOTED → REJECTED (staff); QUOTED → EXPIRED
 * (validUntil passed; QuoteExpiryJob). A CONVERTED quote whose orders were all cancelled (e.g. the
 * payment window lapsed) can be accepted again while it is still valid.
 */
@Injectable()
export class QuotesService {
  private readonly logger = new Logger(QuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly totals: TotalsService,
    private readonly checkout: CheckoutService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly orderPayments: OrderPaymentsService,
    private readonly events: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------ RFQ

  /** RFQ by a signed-in, verified user (ADR-018); the quote's email is the account email. */
  async create(input: CreateQuoteDto, user: SessionUser): Promise<CreateQuoteResponseDto> {
    if (input.website) {
      // Honeypot: look like success, store nothing.
      return {
        number: `KTQ-${randomInt(100001, 999999)}`,
        status: 'REQUESTED',
        createdAt: new Date().toISOString(),
      };
    }
    let gstin: string | null = null;
    if (input.gstin) {
      const result = validateGstin(input.gstin);
      if (!result.valid) {
        throw new AppException('INVALID_GSTIN', HttpStatus.UNPROCESSABLE_ENTITY, result.message, {
          reason: result.reason,
        });
      }
      gstin = result.gstin;
    }
    await this.assertCatalogItems(input.items);

    const quote = await this.prisma.$transaction(async (tx) => {
      const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('quote_number_seq') AS n`;
      return tx.quote.create({
        data: {
          number: `KTQ-${n.toString()}`,
          userId: user.id,
          contactName: input.contactName,
          email: user.email.toLowerCase(),
          phone: input.phone,
          organization: input.organization,
          gstin,
          notes: input.notes || null,
          items: {
            create: input.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId ?? null,
              quantity: item.quantity,
              requestedNotes: item.notes || null,
            })),
          },
        },
      });
    });
    await emitQuoteEvent(this.events, this.logger, QUOTE_REQUESTED_EVENT, quotePayload(quote));
    return { number: quote.number, status: quote.status, createdAt: quote.createdAt.toISOString() };
  }

  /**
   * Every product must be live (ACTIVE in an active category; any sale channel, including
   * ENQUIRY_ONLY and B2B_ONLY) and a given variant must be an active variant of that product.
   */
  private async assertCatalogItems(items: CreateQuoteDto['items']): Promise<void> {
    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, status: 'ACTIVE', category: { isActive: true } },
      select: { id: true, variants: { where: { isActive: true }, select: { id: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, new Set(p.variants.map((v) => v.id))]));
    const missing = items.filter(
      (i) => !byId.has(i.productId) || (i.variantId && !byId.get(i.productId)?.has(i.variantId)),
    );
    if (missing.length) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Product or variant not found', {
        items: missing.map((i) => ({ productId: i.productId, variantId: i.variantId ?? null })),
      });
    }
  }

  // ------------------------------------------------------------------ customer reads

  /** Quotes the user may see: their own, plus RFQs sent with their verified email. */
  private visibleTo(user: SessionUser): Prisma.QuoteWhereInput {
    return {
      OR: [
        { userId: user.id },
        ...(user.emailVerified ? [{ email: user.email.toLowerCase() }] : []),
      ],
    };
  }

  async listMine(user: SessionUser, query: ListMyQuotesQueryDto): Promise<QuoteListDto> {
    const where: Prisma.QuoteWhereInput = {
      AND: [this.visibleTo(user), query.status ? { status: query.status } : {}],
    };
    const [quotes, total] = await this.prisma.$transaction([
      this.prisma.quote.findMany({
        where,
        include: quoteInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.quote.count({ where }),
    ]);
    return { items: quotes.map(toQuoteSummary), page: query.page, limit: query.limit, total };
  }

  async getMine(user: SessionUser, number: string): Promise<QuoteDetailDto> {
    const quote = await this.prisma.quote.findFirst({
      where: { AND: [{ number }, this.visibleTo(user)] },
      include: quoteInclude,
    });
    if (!quote) throw quoteNotFound();
    return toQuoteDetail(quote);
  }

  // ------------------------------------------------------------------ accept

  /**
   * Accept a QUOTED quote: one transaction locks the quote and its variants, checks validity and
   * stock, prices the lines at the quoted unit prices (GST-inclusive; tax split and the standard
   * shipping rule from TotalsService; no coupon, no tiers), reserves stock, creates the order
   * (linked by quoteId) and marks the quote CONVERTED. Razorpay → gateway order after commit
   * (fake gateway without keys); BANK_TRANSFER (approved B2B only) → AWAITING_PAYMENT.
   * Idempotent on `Idempotency-Key` exactly like POST /checkout.
   */
  async accept(
    user: SessionUser,
    number: string,
    idempotencyKey: string | undefined,
    input: AcceptQuoteDto,
  ): Promise<PlacedOrder> {
    if (!idempotencyKey) {
      throw new AppException(
        'IDEMPOTENCY_KEY_REQUIRED',
        HttpStatus.BAD_REQUEST,
        'The Idempotency-Key header is required',
      );
    }
    if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw new AppException(
        'VALIDATION_ERROR',
        HttpStatus.BAD_REQUEST,
        'Idempotency-Key must be 8-128 characters [A-Za-z0-9_-]',
        [{ path: 'Idempotency-Key', message: 'Invalid format' }],
      );
    }
    const hash = createHash('sha256')
      .update(JSON.stringify({ owner: `user:${user.id}`, quote: number, input }))
      .digest('hex');
    const replay = await this.replay(idempotencyKey, hash);
    if (replay) return replay;

    const visible = await this.prisma.quote.findFirst({
      where: { AND: [{ number }, this.visibleTo(user)] },
      select: { id: true, gstin: true, organization: true, phone: true },
    });
    if (!visible) throw quoteNotFound();

    const billing = input.billingAddress ?? input.shippingAddress;
    const rawGstin = input.gstin ?? visible.gstin;
    const gstin = rawGstin ? this.checkout.assertGstin(rawGstin, billing.stateCode) : null;
    const isB2B = await this.checkout.isApprovedB2B({ userId: user.id, role: user.role });
    if (!this.checkout.paymentMethods(isB2B).includes(input.paymentMethod)) {
      throw new AppException(
        'PAYMENT_METHOD_NOT_ALLOWED',
        HttpStatus.FORBIDDEN,
        'Bank transfer is available to approved business accounts only',
      );
    }

    let created: { orderId: string; quote: Quote };
    try {
      created = await this.prisma.$transaction(
        (tx) =>
          this.createOrder(tx, {
            quoteId: visible.id,
            user,
            input,
            gstin,
            businessName: gstin ? (input.businessName ?? visible.organization) : null,
            phone: input.phone ?? visible.phone,
            idempotencyKey,
            hash,
          }),
        ORDER_TX,
      );
    } catch (err) {
      // A concurrent request with the same key won the race: answer like a retry.
      if (isUniqueViolation(err, 'idempotencyKey')) {
        const again = await this.replay(idempotencyKey, hash);
        if (again) return again;
      }
      throw err;
    }

    const payment =
      input.paymentMethod === 'RAZORPAY'
        ? await this.orderPayments.ensureGatewayOrder(created.orderId)
        : null;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: created.orderId } });
    const payload: QuoteAcceptedPayload = {
      ...quotePayload(created.quote),
      orderId: order.id,
      orderNumber: order.number,
      paymentMethod: input.paymentMethod,
    };
    await emitQuoteEvent(this.events, this.logger, QUOTE_ACCEPTED_EVENT, payload);
    return this.orderPayments.placedOrder(order, payment);
  }

  /** Same key + same body → the original order; same key, different body → 409. */
  private async replay(idempotencyKey: string, hash: string): Promise<PlacedOrder | null> {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
    if (!existing) return null;
    if (existing.idempotencyHash !== hash) {
      throw new AppException(
        'IDEMPOTENCY_KEY_REUSED',
        HttpStatus.CONFLICT,
        'This Idempotency-Key was already used for a different request',
      );
    }
    const payment =
      existing.paymentMethod === 'RAZORPAY'
        ? await this.orderPayments.ensureGatewayOrder(existing.id)
        : null;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: existing.id } });
    return this.orderPayments.placedOrder(order, payment);
  }

  private async createOrder(
    tx: Tx,
    ctx: {
      quoteId: string;
      user: SessionUser;
      input: AcceptQuoteDto;
      gstin: string | null;
      businessName: string | null;
      phone: string;
      idempotencyKey: string;
      hash: string;
    },
  ): Promise<{ orderId: string; quote: Quote }> {
    const { input, user } = ctx;
    await tx.$queryRaw`SELECT id FROM "Quote" WHERE id = ${ctx.quoteId} FOR UPDATE`;
    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: ctx.quoteId },
      include: {
        items: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            product: { select: { name: true, hsnCode: true, gstRate: true } },
            variant: { select: { title: true, sku: true, isActive: true } },
          },
        },
        orders: { where: { status: { not: 'CANCELLED' } }, select: { number: true } },
      },
    });
    const now = new Date();
    const reacceptable = quote.status === 'CONVERTED' && quote.orders.length === 0;
    if (quote.status !== 'QUOTED' && !reacceptable) {
      throw notAcceptable(`Quote is ${quote.status} and cannot be accepted`, {
        status: quote.status,
        ...(quote.orders[0] ? { orderNumber: quote.orders[0].number } : {}),
      });
    }
    if (!quote.validUntil || quote.validUntil <= now) {
      throw notAcceptable('This quote has expired', { status: 'EXPIRED' });
    }

    const lines: {
      itemId: string;
      variantId: string;
      productId: string;
      quantity: number;
      unitPrice: number;
      product: (typeof quote.items)[number]['product'];
      variant: { title: string; sku: string };
    }[] = [];
    const unavailable: string[] = [];
    for (const item of quote.items) {
      if (!item.variantId || !item.variant?.isActive || item.quotedUnitPrice === null) {
        unavailable.push(item.id);
        continue;
      }
      lines.push({
        itemId: item.id,
        variantId: item.variantId,
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.quotedUnitPrice,
        product: item.product,
        variant: item.variant,
      });
    }
    if (unavailable.length) {
      throw notAcceptable('Some quoted items are no longer available', { itemIds: unavailable });
    }

    // Lock variants in id order (same as checkout, so no deadlocks) and check stock.
    const needed = new Map<string, number>();
    for (const l of lines) needed.set(l.variantId, (needed.get(l.variantId) ?? 0) + l.quantity);
    const variantIds = [...needed.keys()].sort();
    const locked = await tx.$queryRaw<{ id: string; stock: number; reserved: number }[]>`
      SELECT id, stock, reserved FROM "Variant"
      WHERE id IN (${Prisma.join(variantIds)})
      ORDER BY id
      FOR UPDATE`;
    const available = new Map(locked.map((v) => [v.id, v.stock - v.reserved]));
    const short = variantIds.filter((id) => (available.get(id) ?? 0) < (needed.get(id) ?? 0));
    if (short.length) {
      throw new AppException(
        'OUT_OF_STOCK',
        HttpStatus.CONFLICT,
        'Some quoted items are not in stock in the quoted quantity',
        { variantIds: short },
      );
    }

    const priced = this.totals.compute(
      lines.map((l) => ({
        variantId: l.variantId,
        productId: l.productId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        hsnCode: l.product.hsnCode,
        gstRate: l.product.gstRate,
      })),
      { stateCode: input.shippingAddress.stateCode },
      null,
      null, // quoted prices are final: no B2B tiers on top
    );
    const { totals } = priced;

    for (const variantId of variantIds) {
      await tx.$executeRaw`
        UPDATE "Variant" SET reserved = reserved + ${needed.get(variantId) ?? 0}, "updatedAt" = now()
        WHERE id = ${variantId}`;
    }

    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
    const order = await tx.order.create({
      data: {
        number: `KTX-${n.toString()}`,
        userId: user.id,
        email: user.email.toLowerCase(),
        phone: ctx.phone,
        status: input.paymentMethod === 'BANK_TRANSFER' ? 'AWAITING_PAYMENT' : 'PENDING_PAYMENT',
        paymentMethod: input.paymentMethod,
        shippingAddress: snapshot(input.shippingAddress),
        billingAddress: snapshot(input.billingAddress ?? input.shippingAddress),
        gstin: ctx.gstin,
        businessName: ctx.businessName,
        subtotal: totals.subtotal,
        discount: totals.discount,
        shipping: totals.shipping,
        taxTotal: totals.taxTotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        idempotencyKey: ctx.idempotencyKey,
        idempotencyHash: ctx.hash,
        quoteId: quote.id,
        reservedUntil: this.orderPayments.reservationExpiry(input.paymentMethod, now),
        items: {
          create: lines.map((l, idx) => {
            const line = priced.lines[idx];
            return {
              variantId: l.variantId,
              productName: l.product.name,
              variantTitle: l.variant.title,
              sku: l.variant.sku,
              hsnCode: l.product.hsnCode,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              gstRate: line.gstRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              discount: line.discount,
              netTotal: line.netTotal,
            };
          }),
        },
      },
    });

    await this.lifecycle.addEvent(
      tx,
      order.id,
      EVENT.PLACED,
      `Order placed from quote ${quote.number}`,
      { actorId: user.id },
    );
    if (input.poNumber) {
      await this.lifecycle.addEvent(tx, order.id, EVENT.NOTE, `Customer PO: ${input.poNumber}`, {
        internal: true,
        actorId: user.id,
      });
    }
    const updated = await tx.quote.update({
      where: { id: quote.id },
      data: { status: 'CONVERTED' },
    });
    return { orderId: order.id, quote: updated };
  }
}
