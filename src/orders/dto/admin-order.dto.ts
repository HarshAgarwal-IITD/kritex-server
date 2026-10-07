import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema } from '../../common/dto/common';
import {
  manualInventoryReasonSchema,
  orderStatusSchema,
  paymentMethodSchema,
  paymentStatusSchema,
  refundStatusSchema,
} from '../../common/dto/enums';
import { moneySchema } from '../../common/dto/money';
import { paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';
import { adminShipmentSchema } from '../../shipping/dto/shipment.dto';
import { orderDetailSchema } from './order.dto';

const orderFilterShape = {
  status: orderStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  paymentStatus: paymentStatusSchema
    .optional()
    .meta({ description: 'Orders with at least one payment in this status' }),
  userId: z.string().min(1).max(64).optional().meta({ description: "A customer's orders" }),
  q: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .meta({ description: 'Order number, email, phone or customer name' }),
  from: isoDateTimeSchema.optional().meta({ description: 'createdAt >= from' }),
  to: isoDateTimeSchema.optional().meta({ description: 'createdAt < to' }),
};

export const listAdminOrdersQuerySchema = z.object({
  ...orderFilterShape,
  sort: z.enum(['newest', 'oldest', 'total_desc']).default('newest'),
  ...paginationQueryShape,
});
export class ListAdminOrdersQueryDto extends createZodDto(listAdminOrdersQuerySchema) {}

export const exportOrdersQuerySchema = z.object(orderFilterShape);
export class ExportOrdersQueryDto extends createZodDto(exportOrdersQuerySchema) {}

export const adminOrderSummarySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: orderStatusSchema,
  paymentMethod: paymentMethodSchema,
  paymentStatus: paymentStatusSchema.nullable(),
  customerName: z.string(),
  email: z.string(),
  phone: z.string(),
  isGuest: z.boolean(),
  isB2B: z.boolean().meta({ description: 'Has a GSTIN' }),
  itemCount: z.number().int().nonnegative(),
  total: moneySchema,
  createdAt: isoDateTimeSchema,
});
export class AdminOrderListDto extends createZodDto(paginatedSchema(adminOrderSummarySchema)) {}

export const adminPaymentSchema = z.object({
  id: z.string(),
  provider: paymentMethodSchema,
  providerOrderId: z.string().nullable(),
  providerPaymentId: z.string().nullable(),
  amount: moneySchema,
  status: paymentStatusSchema,
  reference: z.string().nullable().meta({ description: 'Bank transfer UTR / PO number' }),
  createdAt: isoDateTimeSchema,
});

export const adminRefundSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  amount: moneySchema,
  reason: z.string().nullable(),
  providerRefundId: z.string().nullable(),
  status: refundStatusSchema,
  createdAt: isoDateTimeSchema,
});

export const adminOrderEventSchema = z.object({
  id: z.string(),
  type: z.string(),
  message: z.string(),
  actor: z.object({ id: z.string(), name: z.string() }).nullable(),
  internal: z.boolean().meta({ description: 'Hidden from the customer (e.g. notes)' }),
  createdAt: isoDateTimeSchema,
});

export const adminOrderDetailSchema = orderDetailSchema
  .omit({ shipments: true, timeline: true })
  .extend({
    id: z.string(),
    userId: z.string().nullable(),
    shipments: z.array(adminShipmentSchema),
    payments: z.array(adminPaymentSchema),
    refunds: z.array(adminRefundSchema),
    events: z.array(adminOrderEventSchema).meta({ description: 'Full timeline incl. notes' }),
    refundableAmount: moneySchema.meta({
      description: 'Captured payments minus refunds that are not FAILED, paise',
    }),
    allowedTransitions: z
      .array(orderStatusSchema)
      .meta({ description: 'Statuses POST /admin/orders/{id}/status accepts next' }),
  });
export class AdminOrderDetailDto extends createZodDto(adminOrderDetailSchema) {}

export const updateOrderStatusSchema = z.object({
  status: orderStatusSchema,
  note: z.string().trim().max(1000).optional(),
  notifyCustomer: z.boolean().default(true),
});
export class UpdateOrderStatusDto extends createZodDto(updateOrderStatusSchema) {}

/** Manual ship fallback (no Shiprocket): records carrier + AWB, status → SHIPPED. */
export const shipOrderSchema = z.object({
  carrier: z.string().trim().min(1).max(100),
  awb: z.string().trim().min(1).max(100).optional(),
  trackingUrl: z.string().trim().url().max(500).optional(),
  notifyCustomer: z.boolean().default(true),
});
export class ShipOrderDto extends createZodDto(shipOrderSchema) {}

export const adminCancelOrderSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  restock: z.boolean().default(true),
  refund: z.boolean().default(true).meta({ description: 'Refund captured payments in full' }),
  notifyCustomer: z.boolean().default(true),
});
export class AdminCancelOrderDto extends createZodDto(adminCancelOrderSchema) {}

export const refundOrderSchema = z.object({
  amount: moneySchema
    .refine((value) => value > 0, 'amount must be > 0')
    .meta({ description: 'Paise; at most the captured amount minus prior refunds' }),
  reason: z.string().trim().min(1).max(500),
  restockItems: z
    .array(
      z.object({
        orderItemId: z.string().min(1).max(64),
        quantity: z.number().int().min(1),
        reason: manualInventoryReasonSchema.default('RETURN'),
      }),
    )
    .default([]),
});
export class RefundOrderDto extends createZodDto(refundOrderSchema) {}

/** Offline payment (BANK_TRANSFER / PO) received: AWAITING_PAYMENT → PAID. */
export const markOrderPaidSchema = z.object({
  reference: z.string().trim().min(1).max(100).meta({ description: 'UTR / cheque / PO number' }),
  amount: moneySchema.optional().meta({ description: 'Defaults to the order total' }),
  paidAt: isoDateTimeSchema.optional(),
  note: z.string().trim().max(1000).optional(),
});
export class MarkOrderPaidDto extends createZodDto(markOrderPaidSchema) {}

export const addOrderNoteSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  internal: z.boolean().default(true),
});
export class AddOrderNoteDto extends createZodDto(addOrderNoteSchema) {}
