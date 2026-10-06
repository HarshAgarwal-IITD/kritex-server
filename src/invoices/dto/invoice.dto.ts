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
