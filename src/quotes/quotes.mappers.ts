import type { Prisma } from '@prisma/client';
import { pickImage } from '../orders/orders.mappers';
import type {
  AdminQuoteDetailDto,
  AdminQuoteListDto,
  QuoteDetailDto,
  QuoteListDto,
} from './dto/quote.dto';

/** Relations every quote read needs (items with catalog info, and the latest order). */
export const quoteInclude = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      product: {
        select: {
          slug: true,
          name: true,
          images: {
            orderBy: { sortOrder: 'asc' },
            select: { url: true, variantOptionValue: true },
          },
        },
      },
      variant: { select: { title: true, sku: true, options: true } },
    },
  },
  orders: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 1,
    select: { id: true, number: true },
  },
} satisfies Prisma.QuoteInclude;

export type QuoteWithRelations = Prisma.QuoteGetPayload<{ include: typeof quoteInclude }>;

type QuoteItemRow = QuoteWithRelations['items'][number];

const lineTotal = (item: { quotedUnitPrice: number | null; quantity: number }) =>
  item.quotedUnitPrice === null ? null : item.quotedUnitPrice * item.quantity;

/** Sum of quoted lines once every line is priced, else null. */
export function quotedTotal(
  items: readonly { quotedUnitPrice: number | null; quantity: number }[],
): number | null {
  if (items.length === 0 || items.some((i) => i.quotedUnitPrice === null)) return null;
  return items.reduce((sum, i) => sum + (lineTotal(i) ?? 0), 0);
}

function toItem(item: QuoteItemRow) {
  return {
    id: item.id,
    productId: item.productId,
    productSlug: item.product.slug,
    productName: item.product.name,
    variantId: item.variantId,
    variantTitle: item.variant?.title ?? null,
    sku: item.variant?.sku ?? null,
    image: pickImage(item.product.images, item.variant?.options ?? null),
    quantity: item.quantity,
    requestedNotes: item.requestedNotes,
    quotedUnitPrice: item.quotedUnitPrice,
    lineTotal: lineTotal(item),
  };
}

export function toQuoteDetail(quote: QuoteWithRelations): QuoteDetailDto {
  return {
    number: quote.number,
    status: quote.status,
    contactName: quote.contactName,
    email: quote.email,
    phone: quote.phone,
    organization: quote.organization,
    gstin: quote.gstin,
    notes: quote.notes,
    items: quote.items.map(toItem),
    quotedTotal: quotedTotal(quote.items),
    responseMessage: quote.adminNotes,
    validUntil: quote.validUntil?.toISOString() ?? null,
    respondedAt: quote.respondedAt?.toISOString() ?? null,
    orderNumber: quote.orders[0]?.number ?? null,
    createdAt: quote.createdAt.toISOString(),
  };
}

export function toAdminQuoteDetail(quote: QuoteWithRelations): AdminQuoteDetailDto {
  return {
    ...toQuoteDetail(quote),
    id: quote.id,
    userId: quote.userId,
    orderId: quote.orders[0]?.id ?? null,
  };
}

export function toQuoteSummary(quote: QuoteWithRelations): QuoteListDto['items'][number] {
  return {
    number: quote.number,
    status: quote.status,
    organization: quote.organization,
    itemCount: quote.items.length,
    quotedTotal: quotedTotal(quote.items),
    validUntil: quote.validUntil?.toISOString() ?? null,
    createdAt: quote.createdAt.toISOString(),
  };
}

export function toAdminQuoteSummary(quote: QuoteWithRelations): AdminQuoteListDto['items'][number] {
  return {
    ...toQuoteSummary(quote),
    id: quote.id,
    contactName: quote.contactName,
    email: quote.email,
  };
}
