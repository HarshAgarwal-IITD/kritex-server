import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MailService } from '../src/auth/mail/mail.service';
import { InvoicesService } from '../src/invoices/invoices.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser, signIn, TEST_ORIGIN } from './auth';
import { ADDRESS, createCart } from './checkout-fixtures';

let keyN = 0;

/** Waits for background invoice + email work started by order events. */
export async function settle(app: INestApplication): Promise<void> {
  // Notifications may issue invoices and vice versa: drain until both are idle.
  for (let i = 0; i < 3; i += 1) {
    await app.get(InvoicesService).drain();
    await app.get(NotificationsService).drain();
  }
}

export const outbox = (app: INestApplication) => app.get(MailService).outbox;

/**
 * A signed-in, verified customer with this email: reused when it already exists. Checkout needs an
 * account (no guest orders, ADR-020).
 */
export async function buyerWithEmail(app: INestApplication, email: string) {
  const prisma = app.get(PrismaService);
  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) return { user: existing, cookie: await signIn(app, existing.email) };
  return createSignedInUser(app, { email });
}

/**
 * Checks out `lines` as `options.user`, or else as a customer with `options.email` (default
 * guest.buyer@example.com), and, when `pay`, pays through the fake gateway. Returns the order row.
 */
export async function placeOrder(
  app: INestApplication<App>,
  lines: { variantId: string; quantity: number }[],
  options: {
    /** A signed-in customer from createSignedInUser. */
    user?: { user: { id: string }; cookie: string };
    email?: string;
    address?: typeof ADDRESS;
    pay?: boolean;
    gstin?: string;
    businessName?: string;
  } = {},
) {
  const prisma = app.get(PrismaService);
  const buyer =
    options.user ?? (await buyerWithEmail(app, options.email ?? 'guest.buyer@example.com'));
  await prisma.cart.deleteMany({ where: { userId: buyer.user.id } });
  await createCart(prisma, lines, { userId: buyer.user.id });
  const cookie = buyer.cookie;
  const placed = await request(app.getHttpServer())
    .post('/api/v1/checkout')
    .set('Cookie', cookie)
    .set('Origin', TEST_ORIGIN)
    .set('Idempotency-Key', `ops-key-${++keyN}-${Date.now()}`)
    .send({
      email: options.email ?? 'guest.buyer@example.com',
      phone: '9876543210',
      shippingAddress: options.address ?? ADDRESS,
      ...(options.gstin ? { gstin: options.gstin, businessName: options.businessName } : {}),
    });
  if (placed.status !== 201) {
    throw new Error(`checkout failed: ${placed.status} ${JSON.stringify(placed.body)}`);
  }
  if (options.pay ?? true) {
    await request(app.getHttpServer())
      .post('/api/v1/checkout/verify')
      .send({
        razorpay_order_id: placed.body.razorpay.orderId,
        razorpay_payment_id: `pay_fake_ops_${keyN}`,
        razorpay_signature: 'fake',
      })
      .expect(200);
  }
  return prisma.order.findUniqueOrThrow({
    where: { number: placed.body.orderNumber as string },
    include: { items: true },
  });
}
