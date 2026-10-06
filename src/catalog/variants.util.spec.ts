import {
  buildSku,
  cartesianVariants,
  countCombinations,
  optionsKey,
  productCodeFromSku,
  productCodeFromSlug,
  skuPart,
} from './variants.util';

describe('variants.util', () => {
  const size = { name: 'Size', values: ['S', 'M'] };
  const colour = { name: 'Colour', values: ['Black', 'Olive Green'] };

  it('cartesianVariants: first axis outermost, titles joined with " / "', () => {
    expect(cartesianVariants([size, colour])).toEqual([
      { title: 'S / Black', options: { Size: 'S', Colour: 'Black' }, sortOrder: 0 },
      { title: 'S / Olive Green', options: { Size: 'S', Colour: 'Olive Green' }, sortOrder: 1 },
      { title: 'M / Black', options: { Size: 'M', Colour: 'Black' }, sortOrder: 2 },
      { title: 'M / Olive Green', options: { Size: 'M', Colour: 'Olive Green' }, sortOrder: 3 },
    ]);
  });

  it('cartesianVariants: no options (or empty axes) → one Default variant', () => {
    const expected = [{ title: 'Default', options: {}, sortOrder: 0 }];
    expect(cartesianVariants([])).toEqual(expected);
    expect(cartesianVariants([{ name: 'Size', values: [] }])).toEqual(expected);
  });

  it('countCombinations multiplies non-empty axes', () => {
    expect(countCombinations([size, colour, { name: 'Fit', values: ['A', 'B', 'C'] }])).toBe(12);
    expect(countCombinations([])).toBe(1);
  });

  it('optionsKey ignores key order', () => {
    expect(optionsKey({ Size: 'M', Colour: 'Black' })).toBe(
      optionsKey({ Colour: 'Black', Size: 'M' }),
    );
    expect(optionsKey({ Size: 'M' })).not.toBe(optionsKey({ Size: 'L' }));
  });

  it('product codes follow the seed scheme', () => {
    expect(productCodeFromSlug('combat-performance-tshirt')).toBe('CPT');
    expect(productCodeFromSlug('rapid-20-tactical-backpack')).toBe('R20TB');
    expect(productCodeFromSku('KTX-CPT-M-BLACK')).toBe('CPT');
    expect(productCodeFromSku('KTX-R20TB')).toBe('R20TB');
    expect(productCodeFromSku('CUSTOM-1')).toBeNull();
  });

  it('buildSku: prefix + one A-Z0-9 part per axis, index fallback for symbol-only values', () => {
    expect(buildSku('KTX-CPT', [size, colour], { Size: 'M', Colour: 'Olive Green' })).toBe(
      'KTX-CPT-M-OLIVEGREEN',
    );
    expect(buildSku('KTX-R20TB', [], {})).toBe('KTX-R20TB');
    expect(buildSku('P', [{ name: 'Size', values: ['½', '1'] }], { Size: '½' })).toBe('P-1');
    expect(skuPart('9.5')).toBe('95');
  });
});
