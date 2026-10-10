import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { buildInvoiceData } from '../src/invoices/invoice-data';
import { gstinCheckChar } from '../src/pricing/gstin';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createSignedInUser, signInAsStaff, TEST_ORIGIN } from './auth';
import { KARNATAKA, seedCheckoutCatalog } from './checkout-fixtures';
import { placeOrder, settle } from './ops-fixtures';
import { createTestApp, resetDatabase, resetThrottler } from './utils';

const KA_GSTIN = `29AAPFU0939F1Z${gstinCheckChar('29AAPFU0939F1Z')}`;

describe('Invoices (e2e): GST invoice on order.paid, numbering, signed link', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let invoices: InvoicesService;
  let v: Awaited<ReturnType<typeof seedCheckoutCatalog>>;
  let customer: { user: { id: string; email: string }; cookie: string };

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    invoices = app.get(InvoicesService);
  });

  beforeEach(async () => {
    await settle(app);
    await resetDatabase(prisma);
    resetThrottler(app);
    v = await seedCheckoutCatalog(prisma);
    customer = await createSignedInUser(app, { name: 'Asha Rao' });
  });

  afterAll(async () => {
    await settle(app);
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it('issues one invoice per paid order, sequential in the financial year', async () => {
    const a = await placeOrder(app, [{ variantId: v.shirtM.id, quantity: 1 }], {
      user: customer,
    });
    await settle(app);
    const b = await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], { user: customer });
    await settle(app);

    const rows = await prisma.invoice.findMany({ orderBy: { number: 'asc' } });
    expect(rows.map((r) => [r.orderId, r.number])).toEqual([
      [a.id, expect.stringMatching(/^KTX\/\d{4}-\d{2}\/00001$/)],
      [b.id, expect.stringMatching(/^KTX\/\d{4}-\d{2}\/00002$/)],
    ]);
    expect(rows.every((r) => r.pdfUrl && /^invoices\/[a-f0-9]{32}\.pdf$/.test(r.pdfUrl))).toBe(
      true,
    );

    // Idempotent: asking again changes nothing.
    const again = await invoices.ensureInvoice(a.id);
    expect(again.number).toBe(rows[0].number);
    expect(await prisma.invoice.count()).toBe(2);
  });

  it('does not invoice unpaid orders', async () => {
    const o = await placeOrder(app, [{ variantId: v.shirtM.id, quantity: 1 }], {
      user: customer,
      pay: false,
    });
    await settle(app);
    expect(await prisma.invoice.count()).toBe(0);
    const res = await http()
      .get(`/api/v1/orders/${o.number}/invoice`)
      .set('Cookie', customer.cookie)
      .expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('numbers by financial year (IST) and rolls over on 1 April', async () => {
    const orders = [];
    for (let i = 0; i < 3; i += 1) {
      orders.push(
        await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], {
          user: customer,
          pay: false,
        }),
      );
    }
    await prisma.order.updateMany({ data: { status: 'PAID' } });
    // 31 Mar 2027 23:59 IST and 1 Apr 2027 00:00 IST.
    const march = await invoices.issue(orders[0].id, new Date('2027-03-31T18:29:00Z'));
    const april = await invoices.issue(orders[1].id, new Date('2027-03-31T18:30:00Z'));
    const april2 = await invoices.issue(orders[2].id, new Date('2027-06-01T10:00:00Z'));
    expect([march.number, april.number, april2.number]).toEqual([
      'KTX/2026-27/00001',
      'KTX/2027-28/00001',
      'KTX/2027-28/00002',
    ]);
    expect([march.fy, april.fy]).toEqual(['2026-27', '2027-28']);
  });

  it('is concurrency-safe: parallel issues get distinct gap-free numbers, one per order', async () => {
    const orders = [];
    for (let i = 0; i < 6; i += 1) {
      orders.push(
        // One buyer per order: a retail customer may hold only 5 unpaid orders (RL-2).
        await placeOrder(app, [{ variantId: v.kit.id, quantity: 1 }], {
          email: `invoice-race-${i}@example.com`,
          pay: false,
        }),
      );
    }
    await prisma.order.updateMany({ data: { status: 'PAID' } });
    const now = new Date('2026-11-01T10:00:00Z');
    // Every order three times at once.
    const issued = await Promise.all(
      [...orders, ...orders, ...orders].map((o) => invoices.issue(o.id, now)),
    );
    const byOrder = new Map<string, Set<string>>();
    for (const inv of issued) {
      byOrder.set(inv.orderId, (byOrder.get(inv.orderId) ?? new Set()).add(inv.number));
    }
    expect([...byOrder.values()].every((s) => s.size === 1)).toBe(true);
    const numbers = (await prisma.invoice.findMany()).map((i) => i.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5, 6].map((n) => `KTX/2026-27/0000${n}`));
    expect(await prisma.invoiceCounter.findUnique({ where: { fy: '2026-27' } })).toEqual({
      fy: '2026-27',
      last: 6,
    });
  });

  it('invoice totals match the order (intra-state CGST/SGST and inter-state IGST)', async () => {
    const intra = await placeOrder(
      app,
      [
        { variantId: v.shirtM.id, quantity: 2 },
        { variantId: v.kit.id, quantity: 1 },
      ],
      { user: customer },
    );
    const inter = await placeOrder(app, [{ variantId: v.shirtL.id, quantity: 1 }], {
      user: customer,
      address: KARNATAKA,
      gstin: KA_GSTIN,
      businessName: 'Rao Traders',
    });
    await settle(app);
    for (const order of [intra, inter]) {
      const full = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { items: true, invoice: true },
      });
      const data = buildInvoiceData({
        number: full.invoice!.number,
        issuedAt: full.invoice!.issuedAt,
        order: full,
        seller: invoices.seller(),
      });
      expect(data.totals).toEqual({
        taxableValue: full.total - full.taxTotal,
        cgst: full.cgst,
        sgst: full.sgst,
        igst: full.igst,
        taxTotal: full.taxTotal,
        grandTotal: full.total,
      });
      const hsnTax = data.hsnSummary.reduce((s, r) => s + r.totalTax, 0);
      expect(hsnTax).toBe(full.taxTotal);
    }
    const interData = await prisma.order.findUniqueOrThrow({ where: { id: inter.id } });
    expect(interData.igst).toBeGreaterThan(0);
    expect(interData.gstin).toBe(KA_GSTIN);
  });

  it('GET /orders/:number/invoice: owner and staff get a signed link that serves the PDF', async () => {
    const o = await placeOrder(app, [{ variantId: v.shirtM.id, quantity: 1 }], {
      user: customer,
    });
    await settle(app);

    const res = await http()
      .get(`/api/v1/orders/${o.number}/invoice`)
      .set('Cookie', customer.cookie)
      .expect(200);
    expect(res.body).toEqual({
      number: expect.stringMatching(/^KTX\/\d{4}-\d{2}\/00001$/),
      issuedAt: expect.any(String),
      url: expect.stringMatching(
        /^\/api\/v1\/invoices\/files\/[a-f0-9]{32}\.pdf\?expires=\d+&sig=[a-f0-9]{64}$/,
      ),
      expiresAt: expect.any(String),
    });
    const ttl = new Date(res.body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000);

    const pdf = await http().get(res.body.url).buffer(true).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    expect(
      Buffer.from(pdf.body as Buffer)
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');

    // Tampered or unknown links are 404, never the file.
    const tampered = (res.body.url as string).replace(/sig=[a-f0-9]{4}/, 'sig=0000');
    await http().get(tampered).expect(404);
    await http()
      .get(`/api/v1/invoices/files/${'a'.repeat(32)}.pdf?expires=9999999999&sig=${'0'.repeat(64)}`)
      .expect(404);

    const staff = await signInAsStaff(app);
    await http().get(`/api/v1/orders/${o.number}/invoice`).set('Cookie', staff.cookie).expect(200);

    const other = await createSignedInUser(app);
    await http()
      .get(`/api/v1/orders/${o.number}/invoice`)
      .set('Cookie', other.cookie)
      .set('Origin', TEST_ORIGIN)
      .expect(404);
    await http().get(`/api/v1/orders/${o.number}/invoice`).expect(401);
  });

  it('issues the invoice on demand when the order.paid work never ran', async () => {
    const o = await placeOrder(app, [{ variantId: v.shirtM.id, quantity: 1 }], {
      user: customer,
    });
    await settle(app);
    await prisma.invoice.deleteMany();
    await prisma.invoiceCounter.deleteMany();
    const res = await http()
      .get(`/api/v1/orders/${o.number}/invoice`)
      .set('Cookie', customer.cookie)
      .expect(200);
    expect(res.body.number).toMatch(/\/00001$/);
  });
});
