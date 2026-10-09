import type { OrderEventPayload } from '../orders/order-events';

/**
 * Events NotificationsModule listens to that are not (yet) emitted by their owning module, with
 * local payload types (no imports from src/quotes, owned by server-b2b).
 */

/**
 * A gateway payment attempt failed. Not emitted by OrderLifecycleService yet (follow-up: emit it
 * after commit from `failGatewayPayment`); the listener is ready for it.
 */
export const ORDER_PAYMENT_FAILED_EVENT = 'order.payment_failed';
export interface OrderPaymentFailedPayload extends OrderEventPayload {
  /** Gateway payment id of the failed attempt (one email per attempt). */
  providerPaymentId?: string | null;
}

/** Quote events (server-b2b, src/quotes/quote-events.ts), emitted after commit. */
export const QUOTE_RESPONDED_EVENT = 'quote.responded';
export interface QuoteEventPayload {
  quoteId: string;
  /** e.g. KTQ-100001 */
  number: string;
  userId: string | null;
  email: string;
  contactName: string;
  organization: string;
}
export interface QuoteRespondedPayload extends QuoteEventPayload {
  /** Paise, GST-inclusive, before shipping. */
  quotedTotal: number;
  /** ISO date-time. */
  validUntil: string;
}
