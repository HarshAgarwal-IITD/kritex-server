import { z } from 'zod';
import { pincodeSchema, phoneSchema, stateCodeSchema } from './india';

/** India only at launch (Q5). */
export const countrySchema = z.literal('IN');

/** Address fields sent by the client (checkout, quotes, saved addresses). */
export const addressInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: phoneSchema,
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100).meta({ description: 'State name, e.g. Maharashtra' }),
  stateCode: stateCodeSchema,
  pincode: pincodeSchema,
  country: countrySchema.default('IN'),
});
export type AddressInput = z.infer<typeof addressInputSchema>;

/** Address as returned by the API (also the order snapshot shape). */
export const addressSchema = z.object({
  name: z.string(),
  phone: z.string(),
  line1: z.string(),
  line2: z.string().nullable(),
  city: z.string(),
  state: z.string(),
  stateCode: stateCodeSchema,
  pincode: z.string(),
  country: countrySchema,
});
export type Address = z.infer<typeof addressSchema>;

/** A customer's saved address (`/me/addresses`). */
export const savedAddressSchema = addressSchema.extend({
  id: z.string(),
  isDefault: z.boolean(),
});
export type SavedAddress = z.infer<typeof savedAddressSchema>;
