import { ORDER_DELIVERED_EVENT, type OrderEventPayload } from '../orders/order-events';

/**
 * Emitted by ShippingService after a carrier update moved the order to DELIVERED (the order
 * lifecycle also emits it for a manual DELIVERED status change). Same payload as the order events.
 */
export { ORDER_DELIVERED_EVENT };
export type OrderDeliveredPayload = OrderEventPayload;
