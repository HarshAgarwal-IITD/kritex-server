import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Prisma, QuoteStatus } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AdminQuoteDetailDto,
  AdminQuoteListDto,
  ListAdminQuotesQueryDto,
  RejectQuoteDto,
  RespondQuoteDto,
} from '../dto/quote.dto';
import { QUOTE_RESPONDED_EVENT, type QuoteRespondedPayload } from '../quote-events';
import {
  quoteInclude,
  quotedTotal,
  type QuoteWithRelations,
  toAdminQuoteDetail,
  toAdminQuoteSummary,
} from '../quotes.mappers';
import { emitQuoteEvent, quoteNotFound, quotePayload } from '../quotes.service';

type Tx = Prisma.TransactionClient;

const OPEN: readonly QuoteStatus[] = ['REQUESTED', 'QUOTED'];

const invalidStatus = (status: QuoteStatus, action: string) =>
  new AppException('INVALID_STATUS', HttpStatus.CONFLICT, `A ${status} quote cannot be ${action}`, {
    status,
  });

const validation = (path: string, message: string) =>
  new AppException('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, message, [{ path, message }]);

/** Admin quotes inbox (B2B-1). */
@Injectable()
export class AdminQuotesService {
  private readonly logger = new Logger(AdminQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  async list(query: ListAdminQuotesQueryDto): Promise<AdminQuoteListDto> {
    const where: Prisma.QuoteWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { number: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { organization: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
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
    return { items: quotes.map(toAdminQuoteSummary), page: query.page, limit: query.limit, total };
  }

  async get(id: string): Promise<AdminQuoteDetailDto> {
    return toAdminQuoteDetail(await this.find(this.prisma, id));
  }

  /**
   * Prices every item (GST-inclusive paise >= 1), optionally pins a variant of the item's
   * product, sets validUntil (future) and the customer message, status → QUOTED, emits
   * `quote.responded` after commit.
   */
  async respond(
    id: string,
    input: RespondQuoteDto,
    actorId?: string,
  ): Promise<AdminQuoteDetailDto> {
    const validUntil = new Date(input.validUntil);
    if (validUntil <= new Date()) throw validation('validUntil', 'Must be in the future');
    input.items.forEach((item, i) => {
      if (item.quotedUnitPrice < 1) {
        throw validation(`items.${i}.quotedUnitPrice`, 'Must be at least 1 paisa');
      }
    });

    const quote = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (!OPEN.includes(current.status)) throw invalidStatus(current.status, 'quoted');

      const byId = new Map(input.items.map((i) => [i.itemId, i]));
      if (byId.size !== input.items.length) throw validation('items', 'Duplicate itemId');
      const known = new Set(current.items.map((i) => i.id));
      const unknown = input.items.findIndex((i) => !known.has(i.itemId));
      if (unknown !== -1) throw validation(`items.${unknown}.itemId`, 'Not an item of this quote');

      const unpriced = current.items
        .filter((item) => {
          const priced = byId.get(item.id);
          return !priced || !(priced.variantId ?? item.variantId);
        })
        .map((item) => item.id);
      if (unpriced.length) {
        throw new AppException(
          'QUOTE_ITEMS_UNPRICED',
          HttpStatus.UNPROCESSABLE_ENTITY,
          'Every item needs a price and a variant',
          { itemIds: unpriced },
        );
      }

      const pinned = input.items.filter((i) => i.variantId);
      if (pinned.length) {
        const variants = await tx.variant.findMany({
          where: { id: { in: pinned.map((i) => i.variantId as string) } },
          select: { id: true, productId: true },
        });
        const productOf = new Map(variants.map((v) => [v.id, v.productId]));
        const productOfItem = new Map(current.items.map((i) => [i.id, i.productId]));
        const bad = pinned.filter(
          (i) => productOf.get(i.variantId as string) !== productOfItem.get(i.itemId),
        );
        if (bad.length) {
          throw new AppException(
            'INVALID_VARIANT',
            HttpStatus.UNPROCESSABLE_ENTITY,
            "A pinned variant does not belong to the item's product",
            { itemIds: bad.map((i) => i.itemId) },
          );
        }
      }

      for (const item of input.items) {
        await tx.quoteItem.update({
          where: { id: item.itemId },
          data: {
            quotedUnitPrice: item.quotedUnitPrice,
            ...(item.variantId ? { variantId: item.variantId } : {}),
          },
        });
      }
      await tx.quote.update({
        where: { id },
        data: {
          status: 'QUOTED',
          validUntil,
          respondedAt: new Date(),
          ...(input.message !== undefined ? { adminNotes: input.message || null } : {}),
        },
      });
      this.logger.log({ quoteId: id, actorId }, 'quote responded');
      return this.find(tx, id);
    });

    const payload: QuoteRespondedPayload = {
      ...quotePayload(quote),
      quotedTotal: quotedTotal(quote.items) ?? 0,
      validUntil: validUntil.toISOString(),
    };
    await emitQuoteEvent(this.events, this.logger, QUOTE_RESPONDED_EVENT, payload);
    return toAdminQuoteDetail(quote);
  }

  /** Decline an open RFQ; the reason is shown to the customer as `responseMessage`. */
  async reject(id: string, input: RejectQuoteDto, actorId?: string): Promise<AdminQuoteDetailDto> {
    const quote = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, id);
      if (!OPEN.includes(current.status)) throw invalidStatus(current.status, 'rejected');
      await tx.quote.update({
        where: { id },
        data: { status: 'REJECTED', adminNotes: input.reason },
      });
      this.logger.log({ quoteId: id, actorId }, 'quote rejected');
      return this.find(tx, id);
    });
    return toAdminQuoteDetail(quote);
  }

  private async lock(tx: Tx, id: string): Promise<QuoteWithRelations> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Quote" WHERE id = ${id} FOR UPDATE`;
    if (rows.length === 0) throw quoteNotFound();
    return this.find(tx, id);
  }

  private async find(db: Tx, id: string): Promise<QuoteWithRelations> {
    const quote = await db.quote.findUnique({ where: { id }, include: quoteInclude });
    if (!quote) throw quoteNotFound();
    return quote;
  }
}
