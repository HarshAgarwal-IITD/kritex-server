import { paiseToWords, numberToIndianWords } from './amount-in-words';
import { financialYear, formatInvoiceNumber } from './invoice-number';

describe('financialYear (IST, April–March)', () => {
  it.each([
    ['2026-04-01T00:00:00+05:30', '2026-27'],
    ['2026-03-31T23:59:59+05:30', '2025-26'],
    ['2027-03-31T18:29:59Z', '2026-27'], // 23:59:59 IST
    ['2027-03-31T18:30:00Z', '2027-28'], // 00:00 IST on 1 April
    ['2026-12-31T20:00:00Z', '2026-27'], // already 1 Jan 2027 in IST
    ['2099-06-01T00:00:00Z', '2099-00'],
  ])('%s → %s', (iso, fy) => {
    expect(financialYear(new Date(iso))).toBe(fy);
  });

  it('formats zero-padded sequence numbers', () => {
    expect(formatInvoiceNumber('KTX', '2026-27', 1)).toBe('KTX/2026-27/00001');
    expect(formatInvoiceNumber('KTX', '2026-27', 123456)).toBe('KTX/2026-27/123456');
  });
});

describe('amount in words (Indian system)', () => {
  it.each([
    [0, 'Zero'],
    [7, 'Seven'],
    [19, 'Nineteen'],
    [45, 'Forty Five'],
    [100, 'One Hundred'],
    [1299, 'One Thousand Two Hundred Ninety Nine'],
    [125000, 'One Lakh Twenty Five Thousand'],
    [10_00_00_000, 'Ten Crore'],
    [12_34_56_789, 'Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine'],
  ])('%d → %s', (n, words) => {
    expect(numberToIndianWords(n)).toBe(words);
  });

  it('adds paise', () => {
    expect(paiseToWords(129950)).toBe(
      'Rupees One Thousand Two Hundred Ninety Nine and Fifty Paise Only',
    );
    expect(paiseToWords(100)).toBe('Rupees One Only');
  });
});
