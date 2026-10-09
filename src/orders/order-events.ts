/** Events emitted (EventEmitter2) after the order change has committed. */
export const ORDER_PAID_EVENT = 'order.paid';
export const ORDER_CANCELLED_EVENT = 'order.cancelled';
export const ORDER_SHIPPED_EVENT = 'order.shipped';
export const ORDER_DELIVERED_EVENT = 'order.delivered';

export interface OrderEventPayload {
  orderId: string;
  number: string;
  /** User id, null for guest orders. */
  userId: string | null;
  email: string;
  /** Admin actions can opt out of the customer email (`notifyCustomer: false`); absent = notify. */
  notifyCustomer?: boolean;
}

export interface OrderCancelledPayload extends OrderEventPayload {
  reason: string;
  /** The order had been paid (a refund was started when `refunded`). */
  wasPaid: boolean;
  refunded: boolean;
}

/** OrderEvent.type values. Status changes use the target status name (e.g. "PAID"). */
export const EVENT = {
  PLACED: 'PLACED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CAPTURED: 'PAYMENT_CAPTURED',
  PAYMENT_RETRY: 'PAYMENT_RETRY',
  REFUND_INITIATED: 'REFUND_INITIATED',
  REFUND_PROCESSED: 'REFUND_PROCESSED',
  REFUND_FAILED: 'REFUND_FAILED',
  RESTOCKED: 'RESTOCKED',
  NOTE: 'NOTE',
} as const;
