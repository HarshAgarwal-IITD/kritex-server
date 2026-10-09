import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema } from '../../common/dto/common';

export const invoiceLinkSchema = z.object({
  number: z.string().meta({ example: 'KTX/2026-27/00001' }),
  issuedAt: isoDateTimeSchema,
  url: z.string().meta({ description: 'Short-lived signed URL to the PDF' }),
  expiresAt: isoDateTimeSchema,
});
export class InvoiceLinkDto extends createZodDto(invoiceLinkSchema) {}

/** Signed local-driver invoice link (dev): `/invoices/files/<file>?expires=&sig=`. */
export const invoiceFileParamSchema = z.object({
  file: z.string().regex(/^[a-f0-9]{32}\.pdf$/),
});
export class InvoiceFileParamDto extends createZodDto(invoiceFileParamSchema) {}

export const invoiceFileQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  sig: z.string().regex(/^[a-f0-9]{64}$/),
});
export class InvoiceFileQueryDto extends createZodDto(invoiceFileQuerySchema) {}
