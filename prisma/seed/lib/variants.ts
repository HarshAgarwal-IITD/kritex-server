/**
 * Variant generation (Size x Colour cartesian product) and deterministic SKU codes.
 *
 * SKU format: KTX-<PRODUCT>-<SIZE>-<COLOUR>, uppercase, missing parts omitted:
 *   combat-performance-tshirt, M, Olive Green -> KTX-CPT-M-OLIVEGREEN
 *   sega-dms-boot, 9                          -> KTX-SDB-9
 *   rapid-20-tactical-backpack (no options)   -> KTX-R20TB
 */

export const SIZE_OPTION = 'Size';
export const COLOUR_OPTION = 'Colour';
export const DEFAULT_VARIANT_TITLE = 'Default';

export interface VariantSpec {
  /** "M / Olive Green", "9", or "Default". Unique within a product. */
  title: string;
  /** {"Size":"M","Colour":"Olive Green"}; {} for the Default variant. */
  options: Record<string, string>;
  sortOrder: number;
}

/** Size x Colour, sizes outermost (S/Black, S/Navy, M/Black, ...). One "Default" variant if neither. */
export function buildVariants(sizes: readonly string[], colours: readonly string[]): VariantSpec[] {
  const sizeAxis: (string | null)[] = sizes.length ? [...sizes] : [null];
  const colourAxis: (string | null)[] = colours.length ? [...colours] : [null];
  const variants: VariantSpec[] = [];
  for (const size of sizeAxis) {
    for (const colour of colourAxis) {
      const options: Record<string, string> = {};
      if (size !== null) options[SIZE_OPTION] = size;
      if (colour !== null) options[COLOUR_OPTION] = colour;
      const parts = [size, colour].filter((v): v is string => v !== null);
      variants.push({
        title: parts.length ? parts.join(' / ') : DEFAULT_VARIANT_TITLE,
        options,
        sortOrder: variants.length,
      });
    }
  }
  const titles = new Set(variants.map((v) => v.title));
  if (titles.size !== variants.length) {
    throw new Error(
      `Duplicate option values in sizes [${sizes.join(', ')}] / colours [${colours.join(', ')}]`,
    );
  }
  return variants;
}

/** Uppercase A-Z0-9 only: "Olive Green" -> "OLIVEGREEN", "9.5" -> "95". */
export function skuPart(value: string): string {
  const code = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) throw new Error(`Cannot derive a SKU code from "${value}"`);
  return code;
}

/**
 * Abbreviation candidates for a product slug, shortest first. Numeric segments stay whole,
 * word segments contribute 1, then 2, then 3... leading letters:
 *   "combat-performance-tshirt" -> CPT, COPETS, COMPERTSH, ...
 */
function abbreviationCandidates(slug: string): string[] {
  const segments = slug
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  if (!segments.length) throw new Error(`Cannot abbreviate product slug "${slug}"`);
  const longest = Math.max(...segments.map((s) => s.length));
  const candidates: string[] = [];
  for (let n = 1; n <= longest; n++) {
    const abbrev = segments.map((s) => (/^\d+$/.test(s) ? s : s.slice(0, n))).join('');
    if (!candidates.includes(abbrev)) candidates.push(abbrev);
  }
  return candidates;
}

/**
 * Assigns each slug a unique product code, in the given order (first come, first served), skipping
 * codes in `taken`. Later slugs that collide get a longer abbreviation, then a numeric suffix.
 * Deterministic for a given order, so re-running over the same catalog yields the same codes.
 */
export function assignProductCodes(
  slugs: readonly string[],
  taken: Iterable<string> = [],
): Map<string, string> {
  const used = new Set(taken);
  const codes = new Map<string, string>();
  for (const slug of slugs) {
    if (codes.has(slug)) continue;
    const candidates = abbreviationCandidates(slug);
    let code = candidates.find((c) => !used.has(c));
    if (!code) {
      const base = candidates[0];
      for (let i = 2; !code; i++) if (!used.has(`${base}${i}`)) code = `${base}${i}`;
    }
    used.add(code);
    codes.set(slug, code);
  }
  return codes;
}

export function buildSku(productCode: string, options: Record<string, string>): string {
  const parts = ['KTX', productCode];
  if (options[SIZE_OPTION] !== undefined) parts.push(skuPart(options[SIZE_OPTION]));
  if (options[COLOUR_OPTION] !== undefined) parts.push(skuPart(options[COLOUR_OPTION]));
  return parts.join('-');
}

/** Extracts the product code from a SKU we generated: "KTX-CPT-M-BLACK" -> "CPT". */
export function productCodeFromSku(sku: string): string | null {
  const match = /^KTX-([A-Z0-9]+)(?:-|$)/.exec(sku);
  return match ? match[1] : null;
}
