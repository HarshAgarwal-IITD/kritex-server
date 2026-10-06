import {
  escapeLike,
  parseSpecs,
  parseSwatches,
  parseVariantOptions,
  priceRange,
  publicPrice,
} from './catalog.mappers';

describe('catalog.mappers', () => {
  it('publicPrice: variant override, else base price; never for ENQUIRY_ONLY', () => {
    expect(publicPrice('RETAIL', 150000, 129900)).toBe(150000);
    expect(publicPrice('RETAIL', null, 129900)).toBe(129900);
    expect(publicPrice('B2B_ONLY', null, null)).toBeNull();
    expect(publicPrice('ENQUIRY_ONLY', 150000, 129900)).toBeNull();
  });

  it('priceRange ignores unpriced entries', () => {
    expect(priceRange([300, null, 100, 200])).toEqual({ min: 100, max: 300 });
    expect(priceRange([null])).toBeNull();
    expect(priceRange([])).toBeNull();
  });

  it('parses JSON columns defensively', () => {
    expect(parseSpecs([{ label: 'Fabric', value: 'Cotton' }, { label: 1 }, 'x'])).toEqual([
      { label: 'Fabric', value: 'Cotton' },
    ]);
    expect(parseSpecs({})).toEqual([]);
    expect(parseSwatches({ Black: '#000' })).toEqual({ Black: '#000' });
    expect(parseSwatches(null)).toBeNull();
    expect(parseSwatches([1])).toBeNull();
    expect(parseVariantOptions({ Size: 'M' })).toEqual({ Size: 'M' });
    expect(parseVariantOptions('bad')).toEqual({});
  });

  it('escapeLike escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
