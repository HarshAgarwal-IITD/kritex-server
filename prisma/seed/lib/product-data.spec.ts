import { parseCsv, toCsv } from './csv';
import { PRODUCT_DATA_COLUMNS, paiseToRupees, parseProductData } from './product-data';

const HEADER = PRODUCT_DATA_COLUMNS.join(',');
type Row = Partial<Record<(typeof PRODUCT_DATA_COLUMNS)[number], string>>;
const csv = (...rows: Row[]) =>
  toCsv([
    [...PRODUCT_DATA_COLUMNS],
    ...rows.map((row) => PRODUCT_DATA_COLUMNS.map((c) => row[c] ?? '')),
  ]);
const base = { sku: 'KTX-CPT-M-BLACK', productSlug: 'combat-performance-tshirt' };

describe('CSV', () => {
  it('round-trips quotes, commas and newlines', () => {
    const rows = [
      ['a', 'b "quoted"', 'c,d'],
      ['line\nbreak', '', 'x'],
    ];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('handles CRLF, a BOM and blank lines', () => {
    expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseProductData', () => {
  it('parses a valid row; blank cells mean "unchanged"', () => {
    const { rows, errors } = parseProductData(
      csv({
        ...base,
        variantTitle: 'M / Black',
        price_inr: '2,499.5',
        hsn: '6109',
        gst_rate: '5%',
        stock: '10',
        sale_channel: 'retail',
      }),
    );
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      expect.objectContaining({
        line: 2,
        sku: 'KTX-CPT-M-BLACK',
        price_inr: 249950,
        hsn: '6109',
        gst_rate: '5',
        stock: 10,
        sale_channel: 'RETAIL',
        compare_at_inr: undefined,
        weight_grams: undefined,
      }),
    ]);
  });

  it('reports every invalid cell with its line number', () => {
    const { errors } = parseProductData(
      csv(
        { ...base, price_inr: '12.345', stock: '-1' },
        { sku: '', productSlug: 'x', hsn: '61', gst_rate: '7', sale_channel: 'SHOP' },
        { ...base, sku: 'KTX-OK', weight_grams: '0', length_cm: '1.5' },
      ),
    );
    const messages = errors.map((e) => `${e.line} ${e.message}`);
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^2 price_inr: must be an amount in rupees/),
        expect.stringMatching(/^2 stock: must be a whole number/),
        expect.stringMatching(/^3 sku: is required/),
        expect.stringMatching(/^3 hsn: must be a 4, 6 or 8 digit HSN code/),
        expect.stringMatching(/^3 gst_rate: must be one of/),
        expect.stringMatching(/^3 sale_channel: must be one of RETAIL, B2B_ONLY, ENQUIRY_ONLY/),
        expect.stringMatching(/^4 weight_grams: must be between 1/),
        expect.stringMatching(/^4 length_cm: must be a whole number/),
      ]),
    );
    expect(errors).toHaveLength(8);
  });

  it('rejects duplicate SKUs and compare-at below price', () => {
    const { errors } = parseProductData(
      csv({ ...base, price_inr: '999', compare_at_inr: '899' }, { ...base }),
    );
    expect(errors).toEqual([
      { line: 2, message: 'compare_at_inr must be >= price_inr' },
      { line: 3, message: 'duplicate sku KTX-CPT-M-BLACK (first on line 2)' },
    ]);
  });

  it('requires product-level columns to agree across a product', () => {
    const { errors } = parseProductData(
      csv(
        { ...base, hsn: '6109' },
        { ...base, sku: 'KTX-CPT-L-BLACK', hsn: '6203' },
        { ...base, sku: 'KTX-CPT-XL-BLACK' },
      ),
    );
    expect(errors).toEqual([
      {
        line: 2,
        message:
          'hsn must be the same on every row of product combat-performance-tshirt: "6109" (line 2) vs "6203" (line 3)',
      },
    ]);
  });

  it('checks the header', () => {
    const { errors } = parseProductData('sku,productSlug,colour\n');
    expect(errors.map((e) => e.message)).toEqual([
      expect.stringMatching(/^missing column\(s\): variantTitle, price_inr/),
      'unknown column(s): colour',
    ]);
  });

  it('flags rows with the wrong number of cells', () => {
    const { errors } = parseProductData(`${HEADER}\nKTX-1,slug`);
    expect(errors).toEqual([{ line: 2, message: 'expected 13 cells, found 2' }]);
  });
});

describe('paiseToRupees', () => {
  it('formats paise for the CSV', () => {
    expect(paiseToRupees(249900)).toBe('2499');
    expect(paiseToRupees(249950)).toBe('2499.50');
    expect(paiseToRupees(5)).toBe('0.05');
    expect(paiseToRupees(null)).toBe('');
  });
});
