import type { OrderStatus } from '../common/dto/enums';

/**
 * Order state machine (COM-12). Every status change goes through `assertTransition`.
 *
 *   PENDING_PAYMENT ─┬─► PAID ─┬─► PROCESSING ─► SHIPPED ─► DELIVERED ─► RETURN_REQUESTED ─► RETURNED ─► REFUNDED
 *   AWAITING_PAYMENT ┘         │        │                        │              │
 *        │                     │        └─► CANCELLED / REFUNDED  └─► REFUNDED   └─► DELIVERED (request declined)
 *        └─► CANCELLED         └─► SHIPPED / CANCELLED / REFUNDED
 *
 * CANCELLED and REFUNDED are terminal.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['PAID', 'CANCELLED'],
  AWAITING_PAYMENT: ['PAID', 'CANCELLED'],
  PAID: ['PROCESSING', 'SHIPPED', 'CANCELLED', 'REFUNDED'],
  PROCESSING: ['SHIPPED', 'CANCELLED', 'REFUNDED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['RETURN_REQUESTED', 'REFUNDED'],
  RETURN_REQUESTED: ['RETURNED', 'DELIVERED'],
  RETURNED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

/**
 * Targets that need their own endpoint because they carry data or money:
 * PAID (gateway capture / POST mark-paid) and REFUNDED (POST refund, set when fully refunded).
 */
const NOT_VIA_STATUS_ENDPOINT: readonly OrderStatus[] = ['PAID', 'REFUNDED'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Statuses `POST /admin/orders/{id}/status` accepts next. */
export function adminStatusTransitions(from: OrderStatus): OrderStatus[] {
  return ORDER_TRANSITIONS[from].filter((s) => !NOT_VIA_STATUS_ENDPOINT.includes(s));
}

/** Payment not captured yet: cancelling releases the reservation (no refund, no restock). */
export const UNPAID_STATUSES: readonly OrderStatus[] = ['PENDING_PAYMENT', 'AWAITING_PAYMENT'];

/** Money received and the goods still with us: cancelling restocks and refunds. */
export const CUSTOMER_CANCELLABLE: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'AWAITING_PAYMENT',
  'PAID',
  'PROCESSING',
];

/** Statuses whose order total counts as revenue (paid and not cancelled/refunded). */
export const REVENUE_STATUSES: readonly OrderStatus[] = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'RETURN_REQUESTED',
  'RETURNED',
];
