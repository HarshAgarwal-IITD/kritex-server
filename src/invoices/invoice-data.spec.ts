import type { Order, OrderItem } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { buildInvoiceData, SHIPPING_SAC } from './invoice-data';
import { renderInvoicePdf } from './invoice-pdf';

const seller = {
  legalName: 'Kritex Pvt Ltd',
  gstin: '27AAPFU0939F1ZV',
  addressLines: ['Unit 1', 'Mumbai'],
  stateCode: '27',
  email: null,
  phone: null,
};

const address = (stateCode: string, state: string) => ({
  name: 'Asha Rao',
  phone: '+919876543210',
  line1: '12 MG Road',
  city: 'Mumbai',
  state,
  stateCode,
  pincode: '400001',
});

function item(over: Partial<OrderItem>): OrderItem {
  return {
    id: 'i',
    orderId: 'o',
    variantId: 'v',
    productName: 'Combat Shirt',
    variantTitle: 'M',
    sku: 'KTX-CS-M',
    hsnCode: '6205',
    unitPrice: 129900,
    quantity: 2,
    gstRate: new Prisma.Decimal(5),
    taxAmount: 12371,
    lineTotal: 259800,
    discount: 0,
    netTotal: 259800,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    ...over,
  };
}

function order(over: Partial<Order>, items: OrderItem[]): Order & { items: OrderItem[] } {
  return {
    id: 'o',
    number: 'KTX-100001',
    userId: null,
    email: 'a@b.co',
    phone: '9876543210',
    status: 'PAID',
    paymentMethod: 'RAZORPAY',
    shippingAddress: address('27', 'Maharashtra'),
    billingAddress: address('27', 'Maharashtra'),
    gstin: null,
    businessName: null,
    subtotal: 0,
    discount: 0,
    shipping: 0,
    taxTotal: 0,
    cgst: 0,
    sgst: 0,
    igst: 0,
    total: 0,
    couponCode: null,
    idempotencyKey: null,
    idempotencyHash: null,
    cartId: null,
    reservedUntil: null,
    quoteId: null,
    createdAt: new Date('2026-10-09T10:00:00Z'),
    updatedAt: new Date('2026-10-09T10:00:00Z'),
    ...over,
    items,
  };
}

describe('buildInvoiceData', () => {
  it('intra-state: CGST/SGST per line (odd paisa to CGST), shipping line, HSN summary = order', () => {
    const items = [
      item({}),
      item({
        id: 'i2',
        productName: 'Field Kit',
        variantTitle: 'Default',
        sku: 'KTX-FK',
        hsnCode: '9020',
        unitPrice: 999900,
        quantity: 1,
        gstRate: new Prisma.Decimal(18),
        taxAmount: 152527,
        lineTotal: 999900,
        netTotal: 999900,
      }),
    ];
    // Shipping 99.00 incl. 18% → 1510 tax.
    const o = order(
      {
        subtotal: 1259700,
        shipping: 9900,
        taxTotal: 12371 + 152527 + 1510,
        cgst: 6186 + 76264 + 755,
        sgst: 6185 + 76263 + 755,
        total: 1269600,
      },
      items,
    );
    const data = buildInvoiceData({
      number: 'KTX/2026-27/00001',
      issuedAt: new Date(),
      order: o,
      seller,
    });
    expect(data.interState).toBe(false);
    expect(data.lines.map((l) => [l.description, l.hsn, l.cgst, l.sgst, l.igst])).toEqual([
      ['Combat Shirt (M)', '6205', 6186, 6185, 0],
      ['Field Kit', '9020', 76264, 76263, 0],
      ['Shipping & handling', SHIPPING_SAC, 755, 755, 0],
    ]);
    expect(data.lines[2].rate).toBe(18);
    expect(data.totals).toEqual({
      taxableValue: o.total - o.taxTotal,
      cgst: o.cgst,
      sgst: o.sgst,
      igst: 0,
      taxTotal: o.taxTotal,
      grandTotal: o.total,
    });
    expect(data.hsnSummary).toHaveLength(3);
    expect(data.placeOfSupply).toBe('Maharashtra (27)');
    expect(data.amountInWords).toBe('Rupees Twelve Thousand Six Hundred Ninety Six Only');
  });

  it('inter-state B2B: IGST only, buyer is the business with its GSTIN, discount kept', () => {
    const items = [item({ discount: 25980, netTotal: 233820, taxAmount: 11134 })];
    const o = order(
      {
        shippingAddress: address('29', 'Karnataka'),
        billingAddress: address('29', 'Karnataka'),
        gstin: '29AAPFU0939F1ZX',
        businessName: 'Rao Traders',
        subtotal: 259800,
        discount: 25980,
        taxTotal: 11134,
        igst: 11134,
        total: 233820,
      },
      items,
    );
    const data = buildInvoiceData({ number: 'X', issuedAt: new Date(), order: o, seller });
    expect(data.interState).toBe(true);
    expect(data.lines).toEqual([
      expect.objectContaining({
        discount: 25980,
        taxableValue: 222686,
        igst: 11134,
        cgst: 0,
        total: 233820,
      }),
    ]);
    expect(data.buyer).toEqual(
      expect.objectContaining({ name: 'Rao Traders', gstin: '29AAPFU0939F1ZX', stateCode: '29' }),
    );
    expect(data.buyer.lines[0]).toBe('Attn: Asha Rao');
  });

  it('renders a PDF', async () => {
    const o = order({ subtotal: 259800, taxTotal: 12371, cgst: 6186, sgst: 6185, total: 259800 }, [
      item({}),
    ]);
    const pdf = await renderInvoicePdf(
      buildInvoiceData({ number: 'KTX/2026-27/00001', issuedAt: new Date(), order: o, seller }),
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
