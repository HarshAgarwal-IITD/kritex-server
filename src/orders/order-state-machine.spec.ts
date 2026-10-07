import { ORDER_STATUSES, type OrderStatus } from '../common/dto/enums';
import {
  adminStatusTransitions,
  canTransition,
  CUSTOMER_CANCELLABLE,
  ORDER_TRANSITIONS,
} from './order-state-machine';

describe('order state machine', () => {
  it('defines transitions for every status, only to known statuses, never to itself', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual([...ORDER_STATUSES].sort());
    for (const [from, targets] of Object.entries(ORDER_TRANSITIONS)) {
      for (const to of targets) {
        expect(ORDER_STATUSES).toContain(to);
        expect(to).not.toBe(from);
      }
    }
  });

  it.each<[OrderStatus, OrderStatus, boolean]>([
    ['PENDING_PAYMENT', 'PAID', true],
    ['PENDING_PAYMENT', 'CANCELLED', true],
    ['PENDING_PAYMENT', 'SHIPPED', false],
    ['AWAITING_PAYMENT', 'PAID', true],
    ['PAID', 'PROCESSING', true],
    ['PAID', 'SHIPPED', true],
    ['PAID', 'PENDING_PAYMENT', false],
    ['PROCESSING', 'SHIPPED', true],
    ['SHIPPED', 'CANCELLED', false],
    ['SHIPPED', 'DELIVERED', true],
    ['DELIVERED', 'RETURN_REQUESTED', true],
    ['DELIVERED', 'CANCELLED', false],
    ['RETURN_REQUESTED', 'RETURNED', true],
    ['RETURN_REQUESTED', 'DELIVERED', true],
    ['RETURNED', 'REFUNDED', true],
    ['CANCELLED', 'PAID', false],
    ['REFUNDED', 'PAID', false],
  ])('%s → %s allowed: %s', (from, to, allowed) => {
    expect(canTransition(from, to)).toBe(allowed);
  });

  it('CANCELLED and REFUNDED are terminal', () => {
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
    expect(ORDER_TRANSITIONS.REFUNDED).toEqual([]);
  });

  it('every non-terminal status can eventually reach a terminal one', () => {
    const terminal = new Set<OrderStatus>(['CANCELLED', 'REFUNDED']);
    for (const start of ORDER_STATUSES) {
      const seen = new Set<OrderStatus>([start]);
      const queue = [start];
      while (queue.length) {
        for (const next of ORDER_TRANSITIONS[queue.shift()!]) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      expect([...seen].some((s) => terminal.has(s))).toBe(true);
    }
  });

  it('the admin status endpoint never offers PAID or REFUNDED (they need mark-paid / refund)', () => {
    expect(adminStatusTransitions('PENDING_PAYMENT')).toEqual(['CANCELLED']);
    expect(adminStatusTransitions('AWAITING_PAYMENT')).toEqual(['CANCELLED']);
    expect(adminStatusTransitions('PAID')).toEqual(['PROCESSING', 'SHIPPED', 'CANCELLED']);
    expect(adminStatusTransitions('RETURNED')).toEqual([]);
  });

  it('customers may cancel only before shipping', () => {
    for (const s of CUSTOMER_CANCELLABLE) expect(canTransition(s, 'CANCELLED')).toBe(true);
    expect(CUSTOMER_CANCELLABLE).not.toContain('SHIPPED');
  });
});
