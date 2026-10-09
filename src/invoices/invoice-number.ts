/** IST is UTC+5:30 with no DST. */
const IST_OFFSET_MS = 330 * 60_000;

/**
 * Indian financial year (1 April – 31 March, in IST) of `date`, as `2026-27` (ADR-006).
 * 31 March 2027 23:59 IST → "2026-27"; 1 April 2027 00:00 IST → "2027-28".
 */
export function financialYear(date: Date): string {
  const ist = new Date(date.getTime() + IST_OFFSET_MS);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1; // getUTCMonth: 3 = April
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** `KTX/2026-27/00001`. Sequences past 99999 simply get longer. */
export function formatInvoiceNumber(prefix: string, fy: string, sequence: number): string {
  return `${prefix}/${fy}/${String(sequence).padStart(5, '0')}`;
}
