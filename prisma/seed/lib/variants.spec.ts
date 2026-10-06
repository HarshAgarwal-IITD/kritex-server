import {
  assignProductCodes,
  buildSku,
  buildVariants,
  productCodeFromSku,
  skuPart,
} from './variants';

describe('buildVariants', () => {
  it('builds the Size x Colour cartesian product, sizes outermost', () => {
    const variants = buildVariants(['S', 'M'], ['Black', 'Olive Green']);
    expect(variants.map((v) => v.title)).toEqual([
      'S / Black',
      'S / Olive Green',
      'M / Black',
      'M / Olive Green',
    ]);
    expect(variants[1]).toEqual({
      title: 'S / Olive Green',
      options: { Size: 'S', Colour: 'Olive Green' },
      sortOrder: 1,
    });
  });

  it('handles a single axis', () => {
    expect(buildVariants(['6', '7', '8'], []).map((v) => v.options)).toEqual([
      { Size: '6' },
      { Size: '7' },
      { Size: '8' },
    ]);
    expect(buildVariants([], ['Black', 'Tan']).map((v) => v.title)).toEqual(['Black', 'Tan']);
  });

  it('creates one Default variant when there are no options', () => {
    expect(buildVariants([], [])).toEqual([{ title: 'Default', options: {}, sortOrder: 0 }]);
  });

  it('count = sizes x colours', () => {
    expect(buildVariants(['S', 'M', 'L', 'XL', 'XXL'], ['A', 'B', 'C', 'D', 'E'])).toHaveLength(25);
  });

  it('rejects duplicate option values', () => {
    expect(() => buildVariants(['M', 'M'], [])).toThrow(/Duplicate/);
  });
});

describe('SKU codes', () => {
  it('normalises option values to uppercase alphanumerics', () => {
    expect(skuPart('Olive Green')).toBe('OLIVEGREEN');
    expect(skuPart('xxl')).toBe('XXL');
    expect(skuPart('9.5')).toBe('95');
    expect(() => skuPart(' / ')).toThrow();
  });

  it('builds KTX-<PRODUCT>-<SIZE>-<COLOUR>, omitting missing parts', () => {
    expect(buildSku('CPT', { Size: 'M', Colour: 'Olive Green' })).toBe('KTX-CPT-M-OLIVEGREEN');
    expect(buildSku('SDB', { Size: '9' })).toBe('KTX-SDB-9');
    expect(buildSku('R20TB', {})).toBe('KTX-R20TB');
  });

  it('abbreviates slugs by initials, keeping numbers whole', () => {
    const codes = assignProductCodes(['combat-performance-tshirt', 'rapid-20-tactical-backpack']);
    expect(codes.get('combat-performance-tshirt')).toBe('CPT');
    expect(codes.get('rapid-20-tactical-backpack')).toBe('R20TB');
  });

  it('resolves collisions deterministically: first slug wins, later ones get longer codes', () => {
    const slugs = ['tactical-cargo-pants', 'tactical-cargo-parka', 'tactical-combat-pants'];
    const codes = assignProductCodes(slugs);
    expect([...codes.values()]).toEqual(['TCP', 'TACAPA', 'TACOPA']);
    expect(assignProductCodes(slugs)).toEqual(codes);
    expect(new Set(codes.values()).size).toBe(3);
  });

  it('avoids codes already taken in the database and falls back to a numeric suffix', () => {
    expect(assignProductCodes(['side-zip-boot'], ['SZB']).get('side-zip-boot')).toBe('SIZIBO');
    const taken = ['AB', 'AB2'];
    expect(assignProductCodes(['a-b'], taken).get('a-b')).toBe('AB3');
  });

  it('reads the product code back from a SKU', () => {
    expect(productCodeFromSku('KTX-CPT-M-BLACK')).toBe('CPT');
    expect(productCodeFromSku('KTX-R20TB')).toBe('R20TB');
    expect(productCodeFromSku('OTHER-1')).toBeNull();
  });
});
