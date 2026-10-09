import PDFDocument from 'pdfkit';
import type { InvoiceData, InvoiceParty } from './invoice-data';

type Doc = InstanceType<typeof PDFDocument>;

const num = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Paise → "1,299.00" (the built-in PDF fonts have no ₹ glyph; the header says INR). */
const amt = (paise: number) => num.format(paise / 100);
const pct = (rate: number) => `${Number.isInteger(rate) ? rate : rate.toFixed(2)}%`;
const date = (d: Date) =>
  new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(d);

const INK = '#0e1611';
const MUTED = '#5b6b62';
const RULE = '#c9d3cd';
const FILL = '#eef2ef';

interface Column {
  label: string;
  width: number;
  align: 'left' | 'right' | 'center';
}

/**
 * Renders the GST tax invoice (ADR-006) as an A4 PDF. Layout only: all numbers come from
 * `buildInvoiceData`. Deterministic for a given input (creation date = issue date).
 */
export function renderInvoicePdf(data: InvoiceData): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    info: {
      Title: `Tax invoice ${data.number}`,
      Author: data.seller.name,
      Subject: `Order ${data.orderNumber}`,
      CreationDate: data.issuedAt,
      ModDate: data.issuedAt,
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // ---- Title + seller / invoice meta
  doc.fillColor(INK).font('Helvetica-Bold').fontSize(16).text('TAX INVOICE', left, 36);
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Original for recipient', left, 56);

  let y = 76;
  const half = width / 2 - 8;
  const sellerBottom = party(doc, 'Sold by', data.seller, left, y, half, true);
  const meta: [string, string][] = [
    ['Invoice number', data.number],
    ['Invoice date', date(data.issuedAt)],
    ['Order number', data.orderNumber],
    ['Order date', date(data.orderDate)],
    ['Place of supply', data.placeOfSupply || '-'],
    ['Reverse charge', 'No'],
    ['Payment', data.paymentMethod === 'BANK_TRANSFER' ? 'Bank transfer' : 'Online (prepaid)'],
  ];
  let my = y;
  for (const [label, value] of meta) {
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(MUTED)
      .text(label, left + half + 16, my, {
        width: 90,
      });
    doc
      .font('Helvetica-Bold')
      .fillColor(INK)
      .text(value, left + half + 106, my, { width: half - 90 });
    my += 12;
  }
  y = Math.max(sellerBottom, my) + 10;
  rule(doc, left, y, width);
  y += 10;

  const billBottom = party(doc, 'Bill to', data.buyer, left, y, half, false);
  const shipBottom = party(doc, 'Ship to', data.shipTo, left + half + 16, y, half, false);
  y = Math.max(billBottom, shipBottom) + 12;

  // ---- Line items
  const taxCols: Column[] = data.interState
    ? [{ label: 'IGST', width: 84, align: 'right' }]
    : [
        { label: 'CGST', width: 42, align: 'right' },
        { label: 'SGST', width: 42, align: 'right' },
      ];
  const fixed: Column[] = [
    { label: '#', width: 14, align: 'left' },
    { label: 'Description', width: 0, align: 'left' },
    { label: 'HSN/SAC', width: 42, align: 'left' },
    { label: 'Qty', width: 24, align: 'right' },
    { label: 'Unit price', width: 50, align: 'right' },
    { label: 'Discount', width: 38, align: 'right' },
    { label: 'Taxable', width: 52, align: 'right' },
    { label: 'GST', width: 28, align: 'right' },
    ...taxCols,
    { label: 'Amount', width: 54, align: 'right' },
  ];
  fixed[1].width = width - fixed.reduce((s, c) => s + c.width, 0);

  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text('Amounts in INR', left, y, {
    width,
    align: 'right',
  });
  y += 11;
  y = header(doc, fixed, left, y, width);

  data.lines.forEach((line, i) => {
    const cells = [
      String(i + 1),
      line.sku ? `${line.description}\nSKU ${line.sku}` : line.description,
      line.hsn,
      String(line.quantity),
      amt(line.unitPrice),
      line.discount ? amt(line.discount) : '-',
      amt(line.taxableValue),
      pct(line.rate),
      ...(data.interState ? [amt(line.igst)] : [amt(line.cgst), amt(line.sgst)]),
      amt(line.total),
    ];
    doc.font('Helvetica').fontSize(7.5);
    const height =
      Math.max(...cells.map((c, idx) => doc.heightOfString(c, { width: fixed[idx].width - 4 }))) +
      6;
    if (y + height > doc.page.height - 160) {
      doc.addPage();
      y = header(doc, fixed, left, 36, width);
    }
    row(doc, fixed, cells, left, y);
    y += height;
    rule(doc, left, y, width, RULE);
  });

  // ---- Totals
  y += 6;
  const totals: [string, string, boolean][] = [
    ['Taxable value', amt(data.totals.taxableValue), false],
    ...(data.interState
      ? ([['IGST', amt(data.totals.igst), false]] as [string, string, boolean][])
      : ([
          ['CGST', amt(data.totals.cgst), false],
          ['SGST', amt(data.totals.sgst), false],
        ] as [string, string, boolean][])),
    ['Invoice total (INR)', amt(data.totals.grandTotal), true],
  ];
  for (const [label, value, strong] of totals) {
    doc
      .font(strong ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(strong ? 9.5 : 8)
      .fillColor(INK)
      .text(label, left + width - 230, y, { width: 140, align: 'right' })
      .text(value, left + width - 90, y, { width: 90, align: 'right' });
    y += strong ? 14 : 11;
  }
  doc
    .font('Helvetica-Oblique')
    .fontSize(8)
    .fillColor(INK)
    .text(`Amount in words: ${data.amountInWords}`, left, y + 2, { width });
  y = doc.y + 12;

  // ---- HSN summary
  if (y > doc.page.height - 200) {
    doc.addPage();
    y = 36;
  }
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK).text('HSN/SAC summary', left, y);
  y += 12;
  const hsnCols: Column[] = [
    { label: 'HSN/SAC', width: 90, align: 'left' },
    { label: 'GST rate', width: 60, align: 'right' },
    { label: 'Taxable value', width: 100, align: 'right' },
    ...(data.interState
      ? [{ label: 'IGST', width: 90, align: 'right' } as Column]
      : [
          { label: 'CGST', width: 90, align: 'right' } as Column,
          { label: 'SGST', width: 90, align: 'right' } as Column,
        ]),
    { label: 'Total tax', width: 0, align: 'right' },
  ];
  hsnCols[hsnCols.length - 1].width = width - hsnCols.reduce((s, c) => s + c.width, 0);
  y = header(doc, hsnCols, left, y, width);
  for (const r of data.hsnSummary) {
    row(
      doc,
      hsnCols,
      [
        r.hsn,
        pct(r.rate),
        amt(r.taxableValue),
        ...(data.interState ? [amt(r.igst)] : [amt(r.cgst), amt(r.sgst)]),
        amt(r.totalTax),
      ],
      left,
      y,
    );
    y += 13;
    rule(doc, left, y, width, RULE);
  }

  // ---- Footer
  y += 18;
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text(
      'Prices are inclusive of GST. Goods once sold are subject to the Kritex returns and exchange policy. ' +
        'This is a computer-generated invoice and does not require a physical signature.',
      left,
      y,
      { width: width - 170 },
    );
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .fillColor(INK)
    .text(`For ${data.seller.name}`, left + width - 160, y, { width: 160, align: 'right' });
  doc
    .font('Helvetica')
    .fontSize(7.5)
    .fillColor(MUTED)
    .text('Authorised signatory', left + width - 160, y + 28, { width: 160, align: 'right' });

  doc.end();
  return done;
}

function party(
  doc: Doc,
  title: string,
  p: InvoiceParty,
  x: number,
  y: number,
  width: number,
  seller: boolean,
): number {
  doc.font('Helvetica').fontSize(7.5).fillColor(MUTED).text(title.toUpperCase(), x, y, { width });
  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .fillColor(INK)
    .text(p.name || '-', x, y + 11, { width });
  doc.font('Helvetica').fontSize(8);
  const extra = [
    ...p.lines,
    p.stateCode && !seller ? `State code: ${p.stateCode}` : null,
    seller || p.gstin ? `GSTIN: ${p.gstin ?? 'TBC'}` : 'Unregistered (B2C)',
    seller && p.stateCode ? `State code: ${p.stateCode}` : null,
    p.email ? p.email : null,
    p.phone ? p.phone : null,
  ].filter((l): l is string => !!l);
  doc.text(extra.join('\n'), x, doc.y + 1, { width });
  return doc.y;
}

function header(doc: Doc, cols: Column[], x: number, y: number, width: number): number {
  doc.rect(x, y, width, 14).fill(FILL);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK);
  let cx = x;
  for (const c of cols) {
    doc.text(c.label, cx + 2, y + 4, { width: c.width - 4, align: c.align, lineBreak: false });
    cx += c.width;
  }
  return y + 17;
}

function row(doc: Doc, cols: Column[], cells: string[], x: number, y: number): void {
  doc.font('Helvetica').fontSize(7.5).fillColor(INK);
  let cx = x;
  cols.forEach((c, i) => {
    doc.text(cells[i] ?? '', cx + 2, y + 2, { width: c.width - 4, align: c.align });
    cx += c.width;
  });
}

function rule(doc: Doc, x: number, y: number, width: number, color = INK): void {
  doc
    .moveTo(x, y)
    .lineTo(x + width, y)
    .lineWidth(0.5)
    .strokeColor(color)
    .stroke();
}
