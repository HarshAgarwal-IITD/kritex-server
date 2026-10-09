import { Column, Row, Section, Text } from '@react-email/components';
import { createElement as h } from 'react';
import {
  A,
  brand,
  Cta,
  Divider,
  formatDate,
  KeyValue,
  Layout,
  money,
  Muted,
  P,
  renderEmail,
  type RenderedEmail,
  Title,
} from './layout';

export interface OrderEmailLine {
  name: string;
  variant: string;
  quantity: number;
  /** Paise, GST-inclusive, after the line's discount share. */
  total: number;
}

export interface OrderEmailData {
  number: string;
  customerName: string;
  placedAt: Date;
  items: OrderEmailLine[];
  totals: { subtotal: number; discount: number; shipping: number; taxTotal: number; total: number };
  shippingAddress: string[];
  /** Order page (account) or public tracking page (guests). */
  orderUrl: string;
}

const greeting = (name: string) => `Hi ${name.split(' ')[0] || 'there'},`;

function itemsTable(items: OrderEmailLine[]) {
  return h(
    Section,
    null,
    ...items.map((item) =>
      h(
        Row,
        null,
        h(
          Column,
          null,
          h(Text, { style: { margin: '4px 0 0', fontSize: '14px', color: brand.ink } }, item.name),
          h(
            Text,
            { style: { margin: '0 0 6px', fontSize: '12px', color: brand.muted } },
            `${item.variant === 'Default' ? '' : `${item.variant} · `}Qty ${item.quantity}`,
          ),
        ),
        h(
          Column,
          { align: 'right' },
          h(Text, { style: { fontSize: '14px', color: brand.ink } }, money(item.total)),
        ),
      ),
    ),
  );
}

export function orderConfirmationEmail(
  data: OrderEmailData & { invoiceNumber: string | null; invoiceAttached: boolean },
): Promise<RenderedEmail> {
  const t = data.totals;
  return renderEmail(
    `Order ${data.number} confirmed`,
    Layout({
      preview: `Thanks for your order. We've received your payment for ${data.number}.`,
      children: [
        Title('Thank you for your order'),
        P(greeting(data.customerName)),
        P(
          `We've received your payment for order ${data.number} (placed ${formatDate(data.placedAt)}). `,
          "We'll email you again when it ships.",
        ),
        Cta(data.orderUrl, 'View your order'),
        Divider(),
        itemsTable(data.items),
        Divider(),
        KeyValue('Subtotal', money(t.subtotal)),
        t.discount > 0 ? KeyValue('Discount', `−${money(t.discount)}`) : null,
        KeyValue('Shipping', t.shipping === 0 ? 'Free' : money(t.shipping)),
        KeyValue('Total', money(t.total), true),
        Muted(`Includes ${money(t.taxTotal)} GST.`),
        Divider(),
        Muted('Shipping to'),
        P(...data.shippingAddress.flatMap((line, i) => (i ? [h('br', { key: i }), line] : [line]))),
        data.invoiceNumber
          ? Muted(
              `Your GST tax invoice ${data.invoiceNumber} is ${
                data.invoiceAttached ? 'attached to this email' : 'available on your order page'
              }.`,
            )
          : null,
      ],
    }),
  );
}

export function paymentFailedEmail(data: {
  number: string;
  customerName: string;
  total: number;
  retryUrl: string;
}): Promise<RenderedEmail> {
  return renderEmail(
    `Payment for order ${data.number} didn't go through`,
    Layout({
      preview: `Your payment of ${money(data.total)} for ${data.number} failed.`,
      children: [
        Title("Your payment didn't go through"),
        P(greeting(data.customerName)),
        P(
          `The payment of ${money(data.total)} for order ${data.number} failed, so the order is not confirmed yet. `,
          'No money was taken; if your bank shows a debit it is reversed automatically.',
        ),
        P('Your items are held for a short while. You can try again with another payment method:'),
        Cta(data.retryUrl, 'Retry payment'),
        Muted('If you need help, reply to this email.'),
      ],
    }),
  );
}

export function orderShippedEmail(data: {
  number: string;
  customerName: string;
  carrier: string | null;
  awb: string | null;
  carrierTrackingUrl: string | null;
  trackUrl: string;
}): Promise<RenderedEmail> {
  const via = data.carrier ? ` with ${data.carrier}` : '';
  return renderEmail(
    `Your order ${data.number} has shipped`,
    Layout({
      preview: `Order ${data.number} is on its way${via}.`,
      children: [
        Title('Your order is on its way'),
        P(greeting(data.customerName)),
        P(`Order ${data.number} has shipped${via}.`),
        data.awb ? P('Tracking number (AWB): ', h('strong', null, data.awb)) : null,
        Cta(data.trackUrl, 'Track your order'),
        data.carrierTrackingUrl
          ? Muted(
              'Or follow it on the courier site: ',
              A(data.carrierTrackingUrl, 'courier tracking'),
            )
          : null,
      ],
    }),
  );
}

export function orderDeliveredEmail(data: {
  number: string;
  customerName: string;
  orderUrl: string;
  returnsUrl: string;
}): Promise<RenderedEmail> {
  return renderEmail(
    `Your order ${data.number} was delivered`,
    Layout({
      preview: `Order ${data.number} has been delivered.`,
      children: [
        Title('Delivered'),
        P(greeting(data.customerName)),
        P(`Order ${data.number} has been delivered. We hope your gear serves you well.`),
        Cta(data.orderUrl, 'View your order'),
        Muted(
          'Wrong size or something not right? See our ',
          A(data.returnsUrl, 'returns and exchange policy'),
          '.',
        ),
      ],
    }),
  );
}

export function orderCancelledEmail(data: {
  number: string;
  customerName: string;
  reason: string;
  /** Unpaid order whose payment window lapsed (gateway timeout or bank-transfer hold). */
  paymentLapsed: boolean;
  wasPaid: boolean;
  refunded: boolean;
  total: number;
  shopUrl: string;
}): Promise<RenderedEmail> {
  const why = data.paymentLapsed
    ? "we didn't receive the payment in time"
    : data.reason.replace(/\.$/, '');
  const money_ = money(data.total);
  return renderEmail(
    `Order ${data.number} has been cancelled`,
    Layout({
      preview: `Order ${data.number} was cancelled.`,
      children: [
        Title('Your order was cancelled'),
        P(greeting(data.customerName)),
        P(`Order ${data.number} (${money_}) has been cancelled: ${why}.`),
        data.wasPaid
          ? P(
              data.refunded
                ? 'A full refund has been started. It usually reaches your account within 5–7 working days.'
                : 'Our team will contact you about the amount you paid.',
            )
          : P('No payment was taken for this order and the items have been released.'),
        data.paymentLapsed ? P('You are welcome to place the order again:') : null,
        data.paymentLapsed ? Cta(data.shopUrl, 'Shop again') : null,
        Muted('Questions? Just reply to this email.'),
      ],
    }),
  );
}
