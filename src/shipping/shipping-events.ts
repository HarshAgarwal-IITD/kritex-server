import type { OrderEventPayload } from '../orders/order-events';

/**
 * Emitted by ShippingService after a carrier update moved the order to DELIVERED (the order
 * lifecycle only emits paid / cancelled / shipped). Same payload as the order events.
 */
export const ORDER_DELIVERED_EVENT = 'order.delivered';
export type OrderDeliveredPayload = OrderEventPayload;
