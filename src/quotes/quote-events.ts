/**
 * Quote events (EventEmitter2), emitted after the change has committed. Notifications (OPS-1)
 * listen for them; listeners must not throw back into the request (errors are logged).
 */
export const QUOTE_REQUESTED_EVENT = 'quote.requested';
export const QUOTE_RESPONDED_EVENT = 'quote.responded';
export const QUOTE_ACCEPTED_EVENT = 'quote.accepted';

export interface QuoteEventPayload {
  quoteId: string;
  /** Human quote number, e.g. KTQ-100001. */
  number: string;
  /** Linked user (signed in when requesting), null for guest RFQs. */
  userId: string | null;
  /** Contact email from the RFQ. */
  email: string;
  contactName: string;
  organization: string;
}

export interface QuoteRespondedPayload extends QuoteEventPayload {
  /** Sum of quoted line totals, paise (GST-inclusive, before shipping). */
  quotedTotal: number;
  validUntil: string;
}

export interface QuoteAcceptedPayload extends QuoteEventPayload {
  orderId: string;
  orderNumber: string;
  paymentMethod: 'RAZORPAY' | 'BANK_TRANSFER';
}
