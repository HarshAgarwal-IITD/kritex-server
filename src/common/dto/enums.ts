import { z } from 'zod';

/**
 * Shared enums for the v1 contract. Values mirror the Prisma enums (ARCHITECTURE.md §3).
 * `/api/v1` is additive-only: values may be added, never renamed or removed.
 */

/** ADR-011: RETAIL = anyone can buy; B2B_ONLY = approved B2B accounts only; ENQUIRY_ONLY = no price, enquiry form. */
export const SALE_CHANNELS = ['RETAIL', 'B2B_ONLY', 'ENQUIRY_ONLY'] as const;
export const saleChannelSchema = z.enum(SALE_CHANNELS);
export type SaleChannel = z.infer<typeof saleChannelSchema>;

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export type ProductStatus = z.infer<typeof productStatusSchema>;

/** ADR-004. B2B_CUSTOMER = customer with an APPROVED business profile. */
export const ROLES = ['CUSTOMER', 'B2B_CUSTOMER', 'STAFF', 'ADMIN'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/**
 * PENDING_PAYMENT: Razorpay order created, stock reserved (released after 30 min if unpaid).
 * AWAITING_PAYMENT: offline payment (BANK_TRANSFER / PO), waiting for an admin to mark it paid.
 *   (Contract-only until a migration adds it to the Prisma enum, B2B-4.)
 */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'AWAITING_PAYMENT',
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
  'REFUNDED',
] as const;
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof orderStatusSchema>;

/**
 * Payment methods as stored (Prisma `PaymentMethod`, also `Payment.provider`). Used in responses.
 * COD exists in the schema but is not offered at launch (Q4).
 */
export const PAYMENT_METHODS = ['RAZORPAY', 'COD', 'BANK_TRANSFER'] as const;
export const paymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Methods a customer may choose at checkout / quote accept (request bodies). No COD at launch;
 * BANK_TRANSFER is for approved B2B accounts only (ADR-003).
 */
export const CHECKOUT_PAYMENT_METHODS = ['RAZORPAY', 'BANK_TRANSFER'] as const;
export const checkoutPaymentMethodSchema = z.enum(CHECKOUT_PAYMENT_METHODS);
export type CheckoutPaymentMethod = z.infer<typeof checkoutPaymentMethodSchema>;

export const PAYMENT_STATUSES = ['CREATED', 'CAPTURED', 'FAILED', 'REFUNDED'] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const REFUND_STATUSES = ['PENDING', 'PROCESSED', 'FAILED'] as const;
export const refundStatusSchema = z.enum(REFUND_STATUSES);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

/** Prisma `ShipmentStatus`; Shiprocket statuses are normalised to these. */
export const SHIPMENT_STATUSES = [
  'PENDING',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'RTO',
  'CANCELLED',
] as const;
export const shipmentStatusSchema = z.enum(SHIPMENT_STATUSES);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;

export const QUOTE_STATUSES = [
  'REQUESTED',
  'QUOTED',
  'ACCEPTED',
  'EXPIRED',
  'REJECTED',
  'CONVERTED',
] as const;
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);
export type QuoteStatus = z.infer<typeof quoteStatusSchema>;

export const COUPON_TYPES = ['PERCENT', 'FLAT', 'FREE_SHIPPING'] as const;
export const couponTypeSchema = z.enum(COUPON_TYPES);
export type CouponType = z.infer<typeof couponTypeSchema>;

export const INVENTORY_REASONS = ['ORDER', 'RELEASE', 'RESTOCK', 'ADJUST', 'RETURN'] as const;
export const inventoryReasonSchema = z.enum(INVENTORY_REASONS);
export type InventoryReason = z.infer<typeof inventoryReasonSchema>;

/** Reasons an admin may use for a manual stock change (ORDER/RELEASE are system-only). */
export const MANUAL_INVENTORY_REASONS = ['RESTOCK', 'ADJUST', 'RETURN'] as const;
export const manualInventoryReasonSchema = z.enum(MANUAL_INVENTORY_REASONS);

export const BUSINESS_PROFILE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const businessProfileStatusSchema = z.enum(BUSINESS_PROFILE_STATUSES);
export type BusinessProfileStatus = z.infer<typeof businessProfileStatusSchema>;

/** Existing enquiry statuses (Prisma `QueryStatus`), repeated here so admin DTOs need no Prisma import. */
export const QUERY_STATUSES = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;
export const queryStatusEnumSchema = z.enum(QUERY_STATUSES);
