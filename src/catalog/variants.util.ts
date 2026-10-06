/**
 * Variant generation helpers (CAT-5). Mirrors the seed's SKU scheme (prisma/seed/lib/variants.ts):
 * `KTX-<PRODUCT>-<SIZE>-<COLOUR>`, uppercase, A-Z0-9 per part. Kept separate because the build only
 * compiles `src/`.
 */

export const DEFAULT_VARIANT_TITLE = 'Default';
/** Upper bound on generated combinations, so a typo in the options can't create thousands of rows. */
export const MAX_GENERATED_VARIANTS = 500;

export interface OptionAxis {
  name: string;
  values: readonly string[];
}

export interface VariantCombination {
  /** "M / Olive Green" or "Default". */
  title: string;
  /** {"Size":"M","Colour":"Olive Green"}; {} for the Default variant. */
  options: Record<string, string>;
  sortOrder: number;
}

/** Cartesian product of the option axes, first axis outermost. No axes → one "Default" combination. */
export function cartesianVariants(axes: readonly OptionAxis[]): VariantCombination[] {
  const used = axes.filter((axis) => axis.values.length > 0);
  let combos: Record<string, string>[] = [{}];
  for (const axis of used) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of axis.values) next.push({ ...combo, [axis.name]: value });
    }
    combos = next;
  }
  return combos.map((options, index) => {
    const parts = used.map((axis) => options[axis.name]);
    return {
      title: parts.length ? parts.join(' / ') : DEFAULT_VARIANT_TITLE,
      options,
      sortOrder: index,
    };
  });
}

/** Number of combinations `cartesianVariants` would produce (without building them). */
export function countCombinations(axes: readonly OptionAxis[]): number {
  return axes
    .filter((axis) => axis.values.length > 0)
    .reduce((total, axis) => total * axis.values.length, 1);
}

/** Order-insensitive key for an options object, used to match existing variants to combinations. */
export function optionsKey(options: Record<string, string>): string {
  return JSON.stringify(
    Object.keys(options)
      .sort()
      .map((key) => [key, options[key]]),
  );
}

/** Uppercase A-Z0-9 only: "Olive Green" → "OLIVEGREEN", "9.5" → "95". Empty if nothing is left. */
export function skuPart(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Product code from a slug: first letter of each word segment, numeric segments whole.
 * "combat-performance-tshirt" → "CPT", "rapid-20-tactical-backpack" → "R20TB".
 */
export function productCodeFromSlug(slug: string): string {
  const code = slug
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => (/^\d+$/.test(segment) ? segment : segment[0]))
    .join('');
  return code || 'P';
}

/** Product code of a SKU we generated: "KTX-CPT-M-BLACK" → "CPT". */
export function productCodeFromSku(sku: string): string | null {
  const match = /^KTX-([A-Z0-9]+)(?:-|$)/.exec(sku);
  return match ? match[1] : null;
}

/**
 * SKU for a combination: `<prefix>-<part>-<part>…` in option-axis order. Values that yield no
 * A-Z0-9 characters fall back to their 1-based position in the axis (e.g. "½" → "3").
 */
export function buildSku(
  prefix: string,
  axes: readonly OptionAxis[],
  options: Record<string, string>,
): string {
  const parts = [prefix];
  for (const axis of axes) {
    const value = options[axis.name];
    if (value === undefined) continue;
    parts.push(skuPart(value) || String(axis.values.indexOf(value) + 1));
  }
  return parts.join('-');
}
