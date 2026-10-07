import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema } from '../../common/dto/common';
import { orderStatusSchema } from '../../common/dto/enums';
import { moneySchema } from '../../common/dto/money';

export const dashboardQuerySchema = z.object({
  threshold: z.coerce
    .number()
    .int()
    .min(0)
    .max(20)
    .default(5)
    .meta({ description: 'Low stock: available units at or below this (default 5)' }),
});
export class DashboardQueryDto extends createZodDto(dashboardQuerySchema) {}

export const dashboardSchema = z.object({
  generatedAt: isoDateTimeSchema,
  revenue: z.object({
    today: moneySchema.meta({ description: 'Paid order totals since 00:00 IST, paise' }),
    last7Days: moneySchema.meta({ description: 'Paid order totals, rolling 7 days, paise' }),
    last30Days: moneySchema.meta({ description: 'Paid order totals, rolling 30 days, paise' }),
  }),
  orders: z.object({
    today: z.number().int().nonnegative(),
    last7Days: z.number().int().nonnegative(),
    last30Days: z.number().int().nonnegative(),
    byStatus: z
      .array(z.object({ status: orderStatusSchema, count: z.number().int().nonnegative() }))
      .meta({ description: 'Every status, including zero counts' }),
  }),
  lowStock: z
    .array(
      z.object({
        variantId: z.string(),
        productId: z.string(),
        productName: z.string(),
        sku: z.string(),
        title: z.string(),
        available: z.number().int(),
      }),
    )
    .meta({ description: 'Active variants with available <= threshold (max 20)' }),
  pendingQuotes: z.number().int().nonnegative().meta({ description: 'Status REQUESTED' }),
  newEnquiries: z.number().int().nonnegative().meta({ description: 'Query status NEW' }),
  pendingBusinessProfiles: z.number().int().nonnegative(),
  awaitingPaymentOrders: z
    .number()
    .int()
    .nonnegative()
    .meta({ description: 'Bank-transfer orders waiting to be marked paid' }),
});
export class DashboardDto extends createZodDto(dashboardSchema) {}
