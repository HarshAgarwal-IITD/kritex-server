import { type INestApplication } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import type { App } from 'supertest/types';
import { MailService } from '../src/auth/mail/mail.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { seedCheckoutCatalog } from './checkout-fixtures';
import { outbox, placeOrder, settle } from './ops-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

describe('Notifications (e2e): order / quote emails, once per event', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let events: EventEmitter2;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let customer: { user: { id: string; email: string }; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    events = app.get(EventEmitter2);
  });

  beforeEach(async () => {
    await settle(app);
    await resetDatabase(prisma);
    resetThrottler(app);
    outbox(app).length = 0;
    v = await seedCheckoutCatalog(prisma);
    customer = await createSignedInUser(app, { name: 'Asha Rao' });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await settle(app);
    await app.close();
  });

  const mails = (tag: string) => outbox(app).filter((m) => m.tag === tag);

  it('order confirmation: once per paid order, with the GST invoice attached', async () => {
    const o = await placeOrder(app, [{ variantId: v.shirtM.id, quantity: 2 }], { user: customer });
    await settle(app);

    const sent = mails('order-confirmation');
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail.to).toBe(customer.user.email);
    expect(mail.subject).toBe(`Order ${o.number} confirmed`);
    expect(mail.html).toContain(o.number);
    expect(mail.html).toContain('href="http://localhost:8080/account/orders/' + o.number + '"');
    expect(mail.text).toContain('Combat Shirt');
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { orderId: o.id } });
    expect(mail.attachments).toEqual([
      {
        filename: `Kritex-invoice-${invoice.number.replace(/\//g, '-')}.pdf`,
        content: expect.any(Buffer),
        contentType: 'application/pdf',
      },
    ]);
    expect(mail.attachments![0].content.subarray(0, 5).toString()).toBe('%PDF-');

    // The same event again (e.g. a redelivered webhook) sends nothing new.
    events.emit('order.paid', {
      orderId: o.id,
      number: o.number,
      userId: o.userId,
      email: o.email,
    });
    await settle(app);
    expect(mails('order-confirmation')).toHaveLength(1);
    expect(await prisma.notification.findMany({ where: { orderId: o.id } })).toEqual([
      expect.objectContaining({
        key: `order.paid:${o.id}`,
        template: 'order-confirmation',
        status: 'SENT',
        attempts: 1,
      }),
    ]);
  });

  it('guests get a tracking link instead of the account page', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], {
      email: 'guest@example.com',
    });
    await settle(app);
    const [mail] = mails('order-confirmation');
    expect(mail.to).toBe('guest@example.com');
    expect(mail.html).toContain(
      `http://localhost:8080/track/${o.number}?email=guest%40example.com`,
    );
  });

  it('a failed send never breaks the order flow, is recorded, and is retried on the next event', async () => {
    const mail = app.get(MailService);
    const spy = jest.spyOn(mail, 'send').mockRejectedValueOnce(new Error('provider down'));
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    await settle(app);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: o.id } })).status).toBe('PAID');
    expect(
      await prisma.notification.findUniqueOrThrow({ where: { key: `order.paid:${o.id}` } }),
    ).toEqual(expect.objectContaining({ status: 'FAILED', error: 'provider down' }));

    spy.mockRestore();
    const sent = await app.get(NotificationsService).sendOrderConfirmation({
      orderId: o.id,
      number: o.number,
      userId: o.userId,
      email: o.email,
    });
    expect(sent).toBe(true);
    expect(
      await prisma.notification.findUniqueOrThrow({ where: { key: `order.paid:${o.id}` } }),
    ).toEqual(expect.objectContaining({ status: 'SENT', attempts: 2, error: null }));
    expect(mails('order-confirmation')).toHaveLength(1);
  });

  it('concurrent deliveries of one event send a single email', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    await settle(app);
    outbox(app).length = 0;
    await prisma.notification.deleteMany();
    const payload = { orderId: o.id, number: o.number, userId: o.userId, email: o.email };
    const service = app.get(NotificationsService);
    const results = await Promise.all([1, 2, 3, 4].map(() => service.sendShipped(payload)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(mails('order-shipped')).toHaveLength(1);
  });

  it('manual ship → shipped email with tracking; cancellation emails', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    const staff = await signInAsStaff(app);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${o.id}/ship`)
      .set('Cookie', staff.cookie)
      .set('Origin', TEST_ORIGIN)
      .send({
        carrier: 'Delhivery',
        awb: 'DL123456',
        trackingUrl: 'https://track.example/DL123456',
        notifyCustomer: true,
      })
      .expect(200);
    await settle(app);
    const [shipped] = mails('order-shipped');
    expect(shipped.subject).toBe(`Your order ${o.number} has shipped`);
    expect(shipped.text).toContain('DL123456');
    expect(shipped.html).toContain('https://track.example/DL123456');

    // Unpaid order expired by the reservation job → "payment window lapsed" email.
    const unpaid = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], {
      user: customer,
      pay: false,
    });
    events.emit('order.cancelled', {
      orderId: unpaid.id,
      number: unpaid.number,
      userId: unpaid.userId,
      email: unpaid.email,
      reason: 'payment not received in time',
      wasPaid: false,
      refunded: false,
    });
    await settle(app);
    const [cancelled] = mails('order-cancelled');
    expect(cancelled.text).toContain("we didn't receive the payment in time");
    expect(cancelled.text).toContain('No payment was taken');
  });

  it('customer cancel of a paid order → cancellation email mentioning the refund', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    await request(app.getHttpServer())
      .post(`/api/v1/me/orders/${o.number}/cancel`)
      .set('Cookie', customer.cookie)
      .set('Origin', TEST_ORIGIN)
      .send({ reason: 'Changed my mind' })
      .expect(200);
    await settle(app);
    const [mail] = mails('order-cancelled');
    expect(mail.to).toBe(customer.user.email);
    expect(mail.text).toContain('refund');
  });

  it('payment failed and quote responded events (emitted by other modules)', async () => {
    const o = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], {
      user: customer,
      pay: false,
    });
    const failed = {
      orderId: o.id,
      number: o.number,
      userId: o.userId,
      email: o.email,
      providerPaymentId: 'pay_fake_fail_1',
    };
    events.emit('order.payment_failed', failed);
    events.emit('order.payment_failed', failed);
    await settle(app);
    expect(mails('payment-failed')).toHaveLength(1);
    expect(mails('payment-failed')[0].html).toContain(`/account/orders/${o.number}`);

    const quote = {
      quoteId: 'q1',
      number: 'KTQ-100001',
      userId: null,
      email: 'buyer@unit.example',
      contactName: 'Major Singh',
      organization: '21 Para',
      quotedTotal: 12_500_000,
      validUntil: '2026-11-30T18:29:59.000Z',
    };
    events.emit('quote.responded', quote);
    events.emit('quote.responded', quote);
    await settle(app);
    const quoteMails = mails('quote-responded');
    expect(quoteMails).toHaveLength(1);
    expect(quoteMails[0].subject).toBe('Your Kritex quote KTQ-100001 is ready');
    expect(quoteMails[0].html).toContain('http://localhost:8080/account/quotes/KTQ-100001');
    expect(quoteMails[0].text).toContain('1,25,000.00');

    // A re-response with new prices is a new email.
    events.emit('quote.responded', { ...quote, quotedTotal: 12_000_000 });
    await settle(app);
    expect(mails('quote-responded')).toHaveLength(2);
  });
});
