import {
  availableUnits,
  isPurchasable,
  type LineFacts,
  lineIssue,
  mergedQuantity,
  pickLineImage,
} from './cart-lines';
import { readCookie } from './cart.controller';

const facts = (over: Partial<LineFacts> = {}): LineFacts => ({
  variantActive: true,
  productStatus: 'ACTIVE',
  categoryActive: true,
  saleChannel: 'RETAIL',
  price: 129900,
  stock: 5,
  reserved: 0,
  ...over,
});

describe('cart line rules', () => {
  it('available = stock - reserved, never negative', () => {
    expect(availableUnits({ stock: 5, reserved: 2 })).toBe(3);
    expect(availableUnits({ stock: 1, reserved: 3 })).toBe(0);
  });

  it('purchasable: RETAIL with a price; B2B_ONLY only for approved B2B; never ENQUIRY_ONLY', () => {
    expect(isPurchasable(facts(), false)).toBe(true);
    expect(isPurchasable(facts({ price: null }), false)).toBe(false);
    expect(isPurchasable(facts({ saleChannel: 'B2B_ONLY' }), false)).toBe(false);
    expect(isPurchasable(facts({ saleChannel: 'B2B_ONLY' }), true)).toBe(true);
    expect(isPurchasable(facts({ saleChannel: 'ENQUIRY_ONLY' }), true)).toBe(false);
  });

  it('issue precedence: UNAVAILABLE > NOT_PURCHASABLE > OUT_OF_STOCK > INSUFFICIENT_STOCK', () => {
    expect(lineIssue(facts(), 5, false)).toBeNull();
    expect(lineIssue(facts(), 6, false)).toBe('INSUFFICIENT_STOCK');
    expect(lineIssue(facts({ reserved: 5 }), 1, false)).toBe('OUT_OF_STOCK');
    expect(lineIssue(facts({ stock: 0, saleChannel: 'ENQUIRY_ONLY' }), 1, false)).toBe(
      'NOT_PURCHASABLE',
    );
    expect(lineIssue(facts({ saleChannel: 'ENQUIRY_ONLY', variantActive: false }), 1, false)).toBe(
      'UNAVAILABLE',
    );
    expect(lineIssue(facts({ productStatus: 'ARCHIVED' }), 1, false)).toBe('UNAVAILABLE');
    expect(lineIssue(facts({ categoryActive: false }), 1, false)).toBe('UNAVAILABLE');
  });

  it('merge: sum capped by 999 and stock, never below either side', () => {
    expect(mergedQuantity(2, 3, 10)).toBe(5);
    expect(mergedQuantity(3, 4, 5)).toBe(5);
    expect(mergedQuantity(0, 3, 0)).toBe(3); // kept, shows OUT_OF_STOCK
    expect(mergedQuantity(4, 1, 2)).toBe(4);
    expect(mergedQuantity(900, 900, 5000)).toBe(999);
  });

  it('line image: colour-linked first, then unlinked, then any', () => {
    const a = { url: 'a', variantOptionValue: 'Black' };
    const b = { url: 'b', variantOptionValue: null };
    const c = { url: 'c', variantOptionValue: 'Olive' };
    expect(pickLineImage([a, b, c], { Colour: 'Olive' })).toBe(c);
    expect(pickLineImage([a, b, c], { Size: 'M' })).toBe(b);
    expect(pickLineImage([a], {})).toBe(a);
    expect(pickLineImage([], {})).toBeNull();
  });

  it('readCookie picks one cookie from the header', () => {
    expect(readCookie('a=1; kritex_cart=tok; b=2', 'kritex_cart')).toBe('tok');
    expect(readCookie('xkritex_cart=1', 'kritex_cart')).toBeUndefined();
    expect(readCookie(undefined, 'kritex_cart')).toBeUndefined();
    expect(readCookie('kritex_cart=%E0%A4', 'kritex_cart')).toBe('%E0%A4');
  });
});
