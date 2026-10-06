import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { savedAddressSchema } from '../../common/dto/address';
import { isoDateTimeSchema } from '../../common/dto/common';
import {
  businessProfileStatusSchema,
  orderStatusSchema,
  roleSchema,
} from '../../common/dto/enums';
import { moneySchema } from '../../common/dto/money';
import { paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';
import { businessProfileSchema } from './account.dto';

export const listCustomersQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Name, email or phone' }),
  role: z.enum(['CUSTOMER', 'B2B_CUSTOMER']).optional(),
  businessStatus: businessProfileStatusSchema.optional(),
  ...paginationQueryShape,
});
export class ListCustomersQueryDto extends createZodDto(listCustomersQuerySchema) {}

export const adminCustomerSummarySchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string(),
  phone: z.string().nullable(),
  role: roleSchema,
  businessStatus: businessProfileStatusSchema.nullable(),
  orderCount: z.number().int().nonnegative(),
  totalSpent: moneySchema.meta({ description: 'Sum of paid order totals, paise' }),
  createdAt: isoDateTimeSchema,
});
export class AdminCustomerListDto extends createZodDto(
  paginatedSchema(adminCustomerSummarySchema),
) {}

export const adminCustomerDetailSchema = adminCustomerSummarySchema.extend({
  businessProfile: businessProfileSchema.nullable(),
  addresses: z.array(savedAddressSchema),
  recentOrders: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      status: orderStatusSchema,
      total: moneySchema,
      createdAt: isoDateTimeSchema,
    }),
  ),
});
export class AdminCustomerDetailDto extends createZodDto(adminCustomerDetailSchema) {}

// ---------- Business profiles (B2B approvals) ----------

export const listBusinessProfilesQuerySchema = z.object({
  status: businessProfileStatusSchema.optional().meta({ description: 'Default: all' }),
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Legal name, GSTIN, email' }),
  ...paginationQueryShape,
});
export class ListBusinessProfilesQueryDto extends createZodDto(listBusinessProfilesQuerySchema) {}

export const adminBusinessProfileSchema = businessProfileSchema.extend({
  user: z.object({ id: z.string(), email: z.string(), name: z.string() }),
  reviewedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export class AdminBusinessProfileDto extends createZodDto(adminBusinessProfileSchema) {}
export class AdminBusinessProfileListDto extends createZodDto(
  paginatedSchema(adminBusinessProfileSchema),
) {}

export const rejectBusinessProfileSchema = z.object({
  reason: z.string().trim().min(1).max(500).meta({ description: 'Shown to the customer' }),
});
export class RejectBusinessProfileDto extends createZodDto(rejectBusinessProfileSchema) {}
