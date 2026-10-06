import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { addressSchema } from '../../common/dto/address';
import { isoDateTimeSchema } from '../../common/dto/common';
import {
  orderStatusSchema,
  paymentMethodSchema,
  paymentStatusSchema,
} from '../../common/dto/enums';
import { gstRateSchema, moneySchema, totalsSchema } from '../../common/dto/money';
import { paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';
import { shipmentSchema } from '../../shipping/dto/shipment.dto';

/** Snapshot of a purchased line (prices frozen at order time). */
export const orderItemSchema = z.object({
  id: z.string(),
  variantId: z.string().nullable().meta({ description: 'null if the variant was since deleted' }),
  productSlug: z.string().nullable(),
  productName: z.string(),
  variantTitle: z.string(),
  sku: z.string(),
  hsnCode: z.string().nullable(),
  image: z.string().nullable(),
  unitPrice: moneySchema,
  quantity: z.number().int().min(1),
  gstRate: gstRateSchema,
  taxAmount: moneySchema.meta({ description: 'GST included in lineTotal' }),
  lineTotal: moneySchema,
});

export const orderEventSchema = z.object({
  type: z.string().meta({ example: 'PAID' }),
  message: z.string(),
  createdAt: isoDateTimeSchema,
});

export const orderSummarySchema = z.object({
  number: z.string(),
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  total: moneySchema,
  itemCount: z.number().int().nonnegative(),
  image: z.string().nullable().meta({ description: 'First item image' }),
  createdAt: isoDateTimeSchema,
});
export class OrderListDto extends createZodDto(paginatedSchema(orderSummarySchema)) {}

export const orderDetailSchema = z.object({
  number: z.string(),
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema
    .nullable()
    .meta({ description: 'Latest payment status; null before a payment record exists' }),
  email: z.string(),
  phone: z.string(),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  gstin: z.string().nullable(),
  businessName: z.string().nullable(),
  couponCode: z.string().nullable(),
  items: z.array(orderItemSchema),
  totals: totalsSchema,
  shipments: z.array(shipmentSchema),
  timeline: z.array(orderEventSchema).meta({ description: 'Customer-visible events, oldest first' }),
  invoice: z
    .object({ number: z.string(), issuedAt: isoDateTimeSchema })
    .nullable()
    .meta({ description: 'Download via GET /orders/{number}/invoice' }),
  quoteNumber: z.string().nullable(),
  reservedUntil: isoDateTimeSchema
    .nullable()
    .meta({ description: 'PENDING_PAYMENT: unpaid orders are cancelled after this' }),
  canCancel: z.boolean(),
  canRequestReturn: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type OrderDetail = z.infer<typeof orderDetailSchema>;
export class OrderDetailDto extends createZodDto(orderDetailSchema) {}

export const listMyOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  ...paginationQueryShape,
});
export class ListMyOrdersQueryDto extends createZodDto(listMyOrdersQuerySchema) {}

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export class CancelOrderDto extends createZodDto(cancelOrderSchema) {}

/** Return / exchange request (policy: 7-day size exchange, refunds only for defects; Q6). */
export const requestReturnSchema = z.object({
  type: z.enum(['RETURN', 'EXCHANGE']),
  reason: z.enum(['SIZE_ISSUE', 'DEFECTIVE', 'WRONG_ITEM', 'OTHER']),
  items: z
    .array(
      z.object({
        orderItemId: z.string().min(1).max(64),
        quantity: z.number().int().min(1),
        exchangeVariantId: z
          .string()
          .min(1)
          .max(64)
          .optional()
          .meta({ description: 'EXCHANGE: the variant (e.g. other size) wanted instead' }),
      }),
    )
    .min(1)
    .max(50),
  notes: z.string().trim().max(1000).optional(),
});
export class RequestReturnDto extends createZodDto(requestReturnSchema) {}
