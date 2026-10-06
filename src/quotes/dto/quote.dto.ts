import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { addressInputSchema } from '../../common/dto/address';
import { idSchema, isoDateTimeSchema } from '../../common/dto/common';
import { paymentMethodSchema, quoteStatusSchema } from '../../common/dto/enums';
import { emailInputSchema, gstinSchema, phoneSchema } from '../../common/dto/india';
import { moneySchema } from '../../common/dto/money';
import { paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';

// ---------- POST /quotes (RFQ) ----------

export const createQuoteSchema = z.object({
  contactName: z.string().trim().min(1).max(200),
  email: emailInputSchema,
  phone: phoneSchema,
  organization: z.string().trim().min(1).max(200),
  gstin: gstinSchema.optional(),
  notes: z.string().trim().max(5000).optional(),
  items: z
    .array(
      z.object({
        productId: idSchema,
        variantId: idSchema.optional().meta({ description: 'Omit to quote the product generally' }),
        quantity: z.number().int().min(1).max(1_000_000),
        notes: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1)
    .max(50),
  website: z
    .string()
    .max(200)
    .optional()
    .meta({ description: 'Honeypot: must be empty. Bots that fill it get a fake 201.' }),
});
export class CreateQuoteDto extends createZodDto(createQuoteSchema) {}

export const createQuoteResponseSchema = z.object({
  number: z.string(),
  status: quoteStatusSchema,
  createdAt: isoDateTimeSchema,
});
export class CreateQuoteResponseDto extends createZodDto(createQuoteResponseSchema) {}

// ---------- Quote reads ----------

export const quoteItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  productSlug: z.string().nullable(),
  productName: z.string(),
  variantId: z.string().nullable(),
  variantTitle: z.string().nullable(),
  sku: z.string().nullable(),
  image: z.string().nullable(),
  quantity: z.number().int().min(1),
  requestedNotes: z.string().nullable(),
  quotedUnitPrice: moneySchema.nullable().meta({ description: 'GST-inclusive; set once QUOTED' }),
  lineTotal: moneySchema.nullable(),
});

export const quoteSummarySchema = z.object({
  number: z.string(),
  status: quoteStatusSchema,
  organization: z.string(),
  itemCount: z.number().int().nonnegative(),
  quotedTotal: moneySchema.nullable().meta({ description: 'Sum of quoted lines; null until QUOTED' }),
  validUntil: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export class QuoteListDto extends createZodDto(paginatedSchema(quoteSummarySchema)) {}

export const quoteDetailSchema = z.object({
  number: z.string(),
  status: quoteStatusSchema,
  contactName: z.string(),
  email: z.string(),
  phone: z.string(),
  organization: z.string(),
  gstin: z.string().nullable(),
  notes: z.string().nullable(),
  items: z.array(quoteItemSchema),
  quotedTotal: moneySchema.nullable(),
  responseMessage: z
    .string()
    .nullable()
    .meta({ description: "Kritex's message sent with the quote (Quote.adminNotes)" }),
  validUntil: isoDateTimeSchema.nullable(),
  respondedAt: isoDateTimeSchema.nullable(),
  orderNumber: z.string().nullable().meta({ description: 'Set once CONVERTED' }),
  createdAt: isoDateTimeSchema,
});
export class QuoteDetailDto extends createZodDto(quoteDetailSchema) {}

export const listMyQuotesQuerySchema = z.object({
  status: quoteStatusSchema.optional(),
  ...paginationQueryShape,
});
export class ListMyQuotesQueryDto extends createZodDto(listMyQuotesQuerySchema) {}

// ---------- POST /me/quotes/:number/accept ----------

export const acceptQuoteSchema = z.object({
  paymentMethod: paymentMethodSchema.meta({
    description: 'RAZORPAY → pay now; BANK_TRANSFER → AWAITING_PAYMENT (approved B2B only)',
  }),
  phone: phoneSchema.optional().meta({ description: 'Defaults to the quote phone' }),
  shippingAddress: addressInputSchema,
  billingAddress: addressInputSchema.optional(),
  gstin: gstinSchema.optional().meta({ description: 'Defaults to the quote GSTIN' }),
  businessName: z.string().trim().min(1).max(200).optional(),
  poNumber: z.string().trim().max(100).optional().meta({ description: 'Customer PO reference' }),
});
export class AcceptQuoteDto extends createZodDto(acceptQuoteSchema) {}

// ---------- Admin ----------

export const listAdminQuotesQuerySchema = z.object({
  status: quoteStatusSchema.optional(),
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Number, email, organization' }),
  ...paginationQueryShape,
});
export class ListAdminQuotesQueryDto extends createZodDto(listAdminQuotesQuerySchema) {}

export const adminQuoteSummarySchema = quoteSummarySchema.extend({
  id: z.string(),
  contactName: z.string(),
  email: z.string(),
});
export class AdminQuoteListDto extends createZodDto(paginatedSchema(adminQuoteSummarySchema)) {}

export const adminQuoteDetailSchema = quoteDetailSchema.extend({
  id: z.string(),
  userId: z.string().nullable(),
  orderId: z.string().nullable(),
});
export class AdminQuoteDetailDto extends createZodDto(adminQuoteDetailSchema) {}

export const respondQuoteSchema = z.object({
  items: z
    .array(
      z.object({
        itemId: idSchema,
        quotedUnitPrice: moneySchema.meta({ description: 'GST-inclusive unit price, paise' }),
        variantId: idSchema
          .optional()
          .meta({ description: 'Pin a variant when the RFQ line had none' }),
      }),
    )
    .min(1)
    .meta({ description: 'Every quote item must be priced' }),
  validUntil: isoDateTimeSchema,
  message: z.string().trim().max(5000).optional(),
});
export class RespondQuoteDto extends createZodDto(respondQuoteSchema) {}

export const rejectQuoteSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});
export class RejectQuoteDto extends createZodDto(rejectQuoteSchema) {}
