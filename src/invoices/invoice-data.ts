import type { Order, OrderItem } from '@prisma/client';
import { paiseToWords } from './amount-in-words';

/** SAC for courier / goods transport services, used for the shipping line (CA to confirm). */
export const SHIPPING_SAC = '996812';

export interface InvoiceParty {
  name: string;
  lines: string[];
  gstin: string | null;
  stateCode: string | null;
  stateName: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface InvoiceLine {
  description: string;
  sku: string | null;
  hsn: string;
  quantity: number;
  /** GST-inclusive unit price, paise. */
  unitPrice: number;
  /** Coupon share, paise. */
  discount: number;
  /** Ex-GST value, paise. */
  taxableValue: number;
  /** Percent, e.g. 5 or 18. */
  rate: number;
  cgst: number;
  sgst: number;
  igst: number;
  /** taxableValue + tax = GST-inclusive amount after discount. */
  total: number;
}

export interface HsnSummaryRow {
  hsn: string;
  rate: number;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
}

export interface InvoiceData {
  number: string;
  issuedAt: Date;
  orderNumber: string;
  orderDate: Date;
  seller: InvoiceParty;
  buyer: InvoiceParty;
  shipTo: InvoiceParty;
  placeOfSupply: string;
  interState: boolean;
  lines: InvoiceLine[];
  hsnSummary: HsnSummaryRow[];
  totals: {
    taxableValue: number;
    cgst: number;
    sgst: number;
    igst: number;
    taxTotal: number;
    /** = order.total */
    grandTotal: number;
  };
  amountInWords: string;
  paymentMethod: string;
}

export interface SellerConfig {
  legalName: string;
  gstin: string | null;
  addressLines: string[];
  stateCode: string;
  email: string | null;
  phone: string | null;
}

interface AddressJson {
  name?: unknown;
  phone?: unknown;
  line1?: unknown;
  line2?: unknown;
  city?: unknown;
  state?: unknown;
  stateCode?: unknown;
  pincode?: unknown;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

export function addressLines(address: unknown): {
  name: string;
  lines: string[];
  stateCode: string | null;
  stateName: string | null;
  phone: string | null;
} {
  const a = (address && typeof address === 'object' ? address : {}) as AddressJson;
  return {
    name: str(a.name),
    lines: [
      str(a.line1),
      str(a.line2),
      [str(a.city), [str(a.state), str(a.pincode)].filter(Boolean).join(' ')]
        .filter(Boolean)
        .join(', '),
    ].filter(Boolean),
    stateCode: str(a.stateCode) || null,
    stateName: str(a.state) || null,
    phone: str(a.phone) || null,
  };
}

/** Same rule as TaxService.splitTax: the odd paisa goes to CGST. */
function split(tax: number, interState: boolean) {
  if (interState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.ceil(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

/**
 * Builds the invoice content from the order snapshot. Everything comes from what checkout stored
 * (per-line netTotal / taxAmount, order cgst/sgst/igst), so the invoice always matches the order:
 * Σ lines + shipping = order.total and the tax columns sum to the order's tax split.
 */
export function buildInvoiceData(input: {
  number: string;
  issuedAt: Date;
  order: Order & { items: OrderItem[] };
  seller: SellerConfig;
}): InvoiceData {
  const { order, seller } = input;
  const ship = addressLines(order.shippingAddress);
  const bill = addressLines(order.billingAddress);
  const interState =
    order.igst > 0 ||
    (order.taxTotal > 0 && order.cgst === 0 && order.sgst === 0) ||
    (order.taxTotal === 0 && !!ship.stateCode && ship.stateCode !== seller.stateCode);

  const lines: InvoiceLine[] = order.items.map((item) => {
    const net = item.netTotal || item.lineTotal - item.discount;
    const tax = item.taxAmount;
    return {
      description:
        item.variantTitle && item.variantTitle !== 'Default'
          ? `${item.productName} (${item.variantTitle})`
          : item.productName,
      sku: item.sku,
      hsn: item.hsnCode ?? '-',
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
      taxableValue: net - tax,
      rate: Number(item.gstRate),
      ...split(tax, interState),
      total: net,
    };
  });

  if (order.shipping > 0) {
    const itemsTax = order.items.reduce((sum, i) => sum + i.taxAmount, 0);
    const tax = Math.max(0, order.taxTotal - itemsTax);
    lines.push({
      description: 'Shipping & handling',
      sku: null,
      hsn: SHIPPING_SAC,
      quantity: 1,
      unitPrice: order.shipping,
      discount: 0,
      taxableValue: order.shipping - tax,
      rate: Math.max(0, ...order.items.map((i) => Number(i.gstRate))),
      ...split(tax, interState),
      total: order.shipping,
    });
  }

  const summary = new Map<string, HsnSummaryRow>();
  for (const line of lines) {
    const key = `${line.hsn}|${line.rate}`;
    const row = summary.get(key) ?? {
      hsn: line.hsn,
      rate: line.rate,
      taxableValue: 0,
      cgst: 0,
      sgst: 0,
      igst: 0,
      totalTax: 0,
    };
    row.taxableValue += line.taxableValue;
    row.cgst += line.cgst;
    row.sgst += line.sgst;
    row.igst += line.igst;
    row.totalTax += line.cgst + line.sgst + line.igst;
    summary.set(key, row);
  }

  const sum = (pick: (l: InvoiceLine) => number) => lines.reduce((s, l) => s + pick(l), 0);
  const totals = {
    taxableValue: sum((l) => l.taxableValue),
    cgst: sum((l) => l.cgst),
    sgst: sum((l) => l.sgst),
    igst: sum((l) => l.igst),
    taxTotal: sum((l) => l.cgst + l.sgst + l.igst),
    grandTotal: sum((l) => l.total),
  };

  return {
    number: input.number,
    issuedAt: input.issuedAt,
    orderNumber: order.number,
    orderDate: order.createdAt,
    seller: {
      name: seller.legalName,
      lines: seller.addressLines,
      gstin: seller.gstin,
      stateCode: seller.stateCode,
      stateName: null,
      email: seller.email,
      phone: seller.phone,
    },
    buyer: {
      name: order.businessName || bill.name || ship.name,
      lines: order.businessName && bill.name ? [`Attn: ${bill.name}`, ...bill.lines] : bill.lines,
      gstin: order.gstin,
      stateCode: bill.stateCode,
      stateName: bill.stateName,
      email: order.email,
      phone: order.phone,
    },
    shipTo: {
      name: ship.name,
      lines: ship.lines,
      gstin: null,
      stateCode: ship.stateCode,
      stateName: ship.stateName,
      phone: ship.phone,
    },
    placeOfSupply: [ship.stateName, ship.stateCode ? `(${ship.stateCode})` : null]
      .filter(Boolean)
      .join(' '),
    interState,
    lines,
    hsnSummary: [...summary.values()],
    totals,
    amountInWords: paiseToWords(totals.grandTotal),
    paymentMethod: order.paymentMethod,
  };
}
