import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { addressInputSchema, savedAddressSchema } from '../../common/dto/address';
import { isoDateTimeSchema } from '../../common/dto/common';
import { businessProfileStatusSchema, roleSchema } from '../../common/dto/enums';
import { gstinSchema, phoneSchema } from '../../common/dto/india';
import { listSchema } from '../../common/dto/pagination';

export const businessProfileSchema = z.object({
  id: z.string(),
  legalName: z.string(),
  gstin: z.string(),
  status: businessProfileStatusSchema,
  rejectionReason: z
    .string()
    .nullable()
    .meta({ description: 'Set when REJECTED (shown to the customer)' }),
  createdAt: isoDateTimeSchema,
  reviewedAt: isoDateTimeSchema
    .nullable()
    .meta({ description: 'When approved/rejected (BusinessProfile.approvedAt)' }),
});
export class BusinessProfileDto extends createZodDto(businessProfileSchema) {}

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  name: z.string(),
  phone: z.string().nullable(),
  role: roleSchema,
  businessProfile: businessProfileSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export class MeDto extends createZodDto(meSchema) {}

export const updateMeSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  phone: phoneSchema.nullable().optional(),
});
export class UpdateMeDto extends createZodDto(updateMeSchema) {}

// ---------- Addresses ----------

export class SavedAddressDto extends createZodDto(savedAddressSchema) {}
export class SavedAddressListDto extends createZodDto(listSchema(savedAddressSchema)) {}

export const createAddressSchema = addressInputSchema.extend({
  isDefault: z.boolean().default(false),
});
export class CreateAddressDto extends createZodDto(createAddressSchema) {}

export const updateAddressSchema = addressInputSchema.partial().extend({
  isDefault: z.boolean().optional(),
});
export class UpdateAddressDto extends createZodDto(updateAddressSchema) {}

// ---------- Business profile ----------

export const applyBusinessProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(200),
  gstin: gstinSchema,
});
export class ApplyBusinessProfileDto extends createZodDto(applyBusinessProfileSchema) {}
