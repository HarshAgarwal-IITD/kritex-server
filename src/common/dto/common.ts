import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Opaque database id (cuid). */
export const idSchema = z.string().min(1).max(64);

/** Human-facing order number, e.g. `KTX-100001`. */
export const orderNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/)
  .meta({ example: 'KTX-100001' });

/** Human-facing quote number, e.g. `KTQ-100001`. */
export const quoteNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/)
  .meta({ example: 'KTQ-100001' });

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120)
  .meta({ example: 'combat-shirt-olive' });

export const isoDateTimeSchema = z.iso.datetime();

/** Boolean in a query string: `true` / `false`. */
export const queryBooleanSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

/** An image reference (R2/CDN URL or a site-relative path during migration). */
export const imageSchema = z.object({
  url: z.string(),
  alt: z.string().nullable(),
});

/** `:id` path parameter. */
export const idParamSchema = z.object({ id: idSchema });
export class IdParamDto extends createZodDto(idParamSchema) {}

/** `:number` path parameter (order number). */
export const orderNumberParamSchema = z.object({ number: orderNumberSchema });
export class OrderNumberParamDto extends createZodDto(orderNumberParamSchema) {}

/** `:number` path parameter (quote number). */
export const quoteNumberParamSchema = z.object({ number: quoteNumberSchema });
export class QuoteNumberParamDto extends createZodDto(quoteNumberParamSchema) {}

/** `Idempotency-Key` request header (checkout, quote accept): 8-128 chars, e.g. a UUID v4. */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const idempotencyKeySchema = z.string().regex(/^[\w-]{8,128}$/);
