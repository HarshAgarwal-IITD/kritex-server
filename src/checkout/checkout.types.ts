/** Same values as the cart DTO's `CART_LINE_ISSUES` (kept local so checkout doesn't import cart). */
export type CartLineIssue =
  'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'UNAVAILABLE' | 'NOT_PURCHASABLE';

/** Cookie that identifies a guest cart (same name as the cart module's GUEST_CART_COOKIE). */
export const GUEST_CART_COOKIE_NAME = 'kritex_cart';

/** Value of one cookie from a `Cookie` header, or undefined. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw) || undefined;
    } catch {
      return raw || undefined;
    }
  }
  return undefined;
}
