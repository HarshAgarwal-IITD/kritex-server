import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { addressInputSchema } from '../../common/dto/address';
import { isoDateTimeSchema } from '../../common/dto/common';
import {
  checkoutPaymentMethodSchema,
  orderStatusSchema,
  paymentMethodSchema,
} from '../../common/dto/enums';
import { emailInputSchema, gstinSchema, phoneSchema } from '../../common/dto/india';
import { gstRateSchema, moneySchema, totalsSchema } from '../../common/dto/money';

/** B2B invoice details: GSTIN + legal name, both or neither. */
const b2bShape = {
  gstin: gstinSchema.optional().meta({ description: 'For a B2B (input-tax-credit) invoice' }),
  businessName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .meta({ description: 'Legal name for the invoice; required with gstin' }),
};

function requireBusinessNameWithGstin(
  value: { gstin?: string; businessName?: string },
  ctx: z.RefinementCtx,
) {
  if (value.gstin && !value.businessName)
    ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'Required with gstin' });
}

// ---------- POST /checkout/quote ----------

export const checkoutQuoteRequestSchema = z
  .object({
    shippingAddress: addressInputSchema,
    billingAddress: addressInputSchema
      .optional()
      .meta({ description: 'Defaults to the shipping address' }),
    ...b2bShape,
  })
  .superRefine(requireBusinessNameWithGstin);
export class CheckoutQuoteRequestDto extends createZodDto(checkoutQuoteRequestSchema) {}

export const checkoutLineSchema = z.object({
  variantId: z.string(),
  productName: z.string(),
  variantTitle: z.string(),
  sku: z.string(),
  image: z.string().nullable(),
  unitPrice: moneySchema,
  quantity: z.number().int().min(1),
  gstRate: gstRateSchema,
  taxAmount: moneySchema.meta({
    description: 'GST included in netTotal (tax is computed after the coupon discount)',
  }),
  lineTotal: moneySchema.meta({ description: 'unitPrice × quantity, before the coupon' }),
  discount: moneySchema.meta({ description: "This line's share of the coupon discount" }),
  netTotal: moneySchema.meta({
    description: 'lineTotal - discount: the GST-inclusive amount taxAmount is part of',
  }),
});

export const checkoutQuoteSchema = z.object({
  items: z.array(checkoutLineSchema),
  couponCode: z.string().nullable(),
  totals: totalsSchema,
  interState: z
    .boolean()
    .meta({ description: 'true → IGST (shipping state ≠ seller state); false → CGST + SGST' }),
  paymentMethods: z
    .array(checkoutPaymentMethodSchema)
    .meta({ description: 'Methods this customer may use (BANK_TRANSFER: approved B2B only)' }),
});
export class CheckoutQuoteDto extends createZodDto(checkoutQuoteSchema) {}

// ---------- POST /checkout ----------

export const placeOrderSchema = z
  .object({
    email: emailInputSchema.meta({ description: 'Order contact; ignored for signed-in users' }),
    phone: phoneSchema,
    shippingAddress: addressInputSchema,
    billingAddress: addressInputSchema.optional(),
    ...b2bShape,
    paymentMethod: checkoutPaymentMethodSchema.default('RAZORPAY'),
    notes: z.string().trim().max(1000).optional(),
    saveAddress: z
      .boolean()
      .default(false)
      .meta({ description: 'Signed-in users: save the shipping address to the address book' }),
    expectedTotal: moneySchema.optional().meta({
      description:
        'Total the customer saw (from /checkout/quote). If the recomputed total differs the server returns 409 PRICE_CHANGED.',
    }),
  })
  .superRefine(requireBusinessNameWithGstin);
export class PlaceOrderDto extends createZodDto(placeOrderSchema) {}

export const razorpayCheckoutSchema = z.object({
  keyId: z.string().meta({ description: 'Public Razorpay key id for Checkout.js' }),
  orderId: z.string().meta({ description: 'Razorpay order id (order_...)' }),
  amount: moneySchema,
  currency: z.literal('INR'),
  name: z.string().meta({ example: 'Kritex' }),
  description: z.string(),
  prefill: z.object({ name: z.string(), email: z.string(), contact: z.string() }),
});

export const bankTransferInstructionsSchema = z.object({
  accountName: z.string(),
  accountNumber: z.string(),
  ifsc: z.string(),
  bankName: z.string(),
  reference: z.string().meta({ description: 'Quote this in the transfer (the order number)' }),
  amount: moneySchema,
});

/** Result of placing an order (POST /checkout and POST /me/quotes/{number}/accept). */
export const placedOrderSchema = z.object({
  orderNumber: z.string(),
  status: orderStatusSchema.meta({
    description: 'PENDING_PAYMENT (Razorpay) or AWAITING_PAYMENT (bank transfer)',
  }),
  paymentMethod: paymentMethodSchema,
  totals: totalsSchema,
  reservedUntil: isoDateTimeSchema.nullable(),
  razorpay: razorpayCheckoutSchema
    .nullable()
    .meta({ description: 'Set when paymentMethod = RAZORPAY' }),
  bankTransfer: bankTransferInstructionsSchema
    .nullable()
    .meta({ description: 'Set when paymentMethod = BANK_TRANSFER' }),
});
export type PlacedOrder = z.infer<typeof placedOrderSchema>;
export class PlacedOrderDto extends createZodDto(placedOrderSchema) {}

// ---------- POST /checkout/verify ----------

export const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(100),
  razorpay_payment_id: z.string().trim().min(1).max(100),
  razorpay_signature: z.string().trim().min(1).max(256),
});
export class VerifyPaymentDto extends createZodDto(verifyPaymentSchema) {}

export const paymentVerificationSchema = z.object({
  orderNumber: z.string(),
  status: orderStatusSchema,
  paid: z.boolean(),
});
export class PaymentVerificationDto extends createZodDto(paymentVerificationSchema) {}
