import { z } from 'zod';

/** Money is always an integer number of paise (₹1 = 100). Format only in the UI. */
export const moneySchema = z
  .number()
  .int()
  .nonnegative()
  .meta({ description: 'Integer paise (₹1 = 100)', example: 129900 });

/** GST rate as a percentage, e.g. 5, 12, 18. */
export const gstRateSchema = z.number().min(0).max(28).meta({ description: 'GST rate in percent' });

/** Inclusive price range of a product's purchasable variants. */
export const priceRangeSchema = z.object({
  min: moneySchema,
  max: moneySchema,
});

/**
 * Totals breakdown used by the cart, checkout quote, orders and quotes.
 * Prices are GST-inclusive (ADR-006): `total = subtotal - discount + shipping`, and
 * `taxTotal` (= cgst + sgst + igst) is the GST already included in that total.
 */
export const totalsSchema = z.object({
  subtotal: moneySchema.meta({ description: 'Sum of line totals (GST-inclusive), paise' }),
  discount: moneySchema.meta({ description: 'Coupon / quote discount, paise' }),
  shipping: moneySchema.meta({ description: 'Shipping fee (GST-inclusive), paise' }),
  taxTotal: moneySchema.meta({ description: 'GST included in total = cgst + sgst + igst, paise' }),
  cgst: moneySchema,
  sgst: moneySchema,
  igst: moneySchema,
  total: moneySchema.meta({ description: 'Amount payable, paise' }),
  currency: z.literal('INR'),
});
export type Totals = z.infer<typeof totalsSchema>;
