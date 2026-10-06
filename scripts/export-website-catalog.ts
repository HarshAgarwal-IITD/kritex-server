/**
 * One-time export of the website's hard-coded catalog (kritex-website/src/data/*.ts)
 * into prisma/seed/data/catalog.json (committed; the seed reads only that JSON).
 *
 *   npx ts-node --transpile-only scripts/export-website-catalog.ts [/path/to/kritex-website]
 *
 * The website files are only read. Each one is transpiled to CommonJS in a temp dir with the
 * TypeScript compiler, and the Vite-only imports are replaced:
 *   - `@/assets/<file>`  -> the string "/assets/<file>" (no Vite asset pipeline here)
 *   - `@/lib/asset`      -> identity `asset(path)` (keeps the website's relative /products/... paths)
 *   - `@/data/<name>`    -> the sibling transpiled module
 * Type-only imports are erased by the transpiler.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import ts from 'typescript';
import type { Catalog, CatalogProduct } from '../prisma/seed/lib/catalog';

const WEBSITE_DIR = resolve(process.argv[2] ?? join(__dirname, '..', '..', 'kritex-website'));
const OUTPUT = resolve(__dirname, '..', 'prisma', 'seed', 'data', 'catalog.json');
const DATA_FILES = ['tacticalFootwear', 'combatApparel', 'loadBearing', 'productCategories'];

/** Website product-list export name -> category slug. */
const PRODUCT_SOURCES: Record<string, { module: string; exportName: string }> = {
  'tactical-footwear': { module: 'tacticalFootwear', exportName: 'tacticalFootwearProducts' },
  'combat-apparel': { module: 'combatApparel', exportName: 'combatApparelProducts' },
  'load-bearing': { module: 'loadBearing', exportName: 'loadBearingProducts' },
};

interface WebsiteProduct {
  id: string;
  name: string;
  category: string;
  description: string;
  images: string[];
  specs: { label: string; value: string }[];
  sizes?: string[];
  colorVariants?: { label: string; image?: string; swatch?: string }[];
  specSheets?: { title: string; image: string }[];
}

interface WebsiteCategory {
  slug: string;
  title: string;
  description: string;
  image: string;
  available: boolean;
}

function transpileTo(dir: string): void {
  for (const name of DATA_FILES) {
    const source = readFileSync(join(WEBSITE_DIR, 'src', 'data', `${name}.ts`), 'utf8');
    let js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    js = js
      .replace(/require\("@\/assets\/([^"]+)"\)/g, (_m, file: string) =>
        JSON.stringify({ default: `/assets/${file}` }),
      )
      .replace(/require\("@\/lib\/asset"\)/g, '({ asset: (p) => p })')
      .replace(/require\("@\/data\/([^"]+)"\)/g, (_m, mod: string) => `require("./${mod}.cjs")`);
    if (/require\("@\//.test(js)) {
      throw new Error(`Unhandled "@/..." import left in ${name}.ts`);
    }
    writeFileSync(join(dir, `${name}.cjs`), js);
  }
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), 'kritex-catalog-'));
  try {
    transpileTo(dir);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const load = (mod: string) => require(join(dir, `${mod}.cjs`)) as Record<string, unknown>;

    const websiteCategories = load('productCategories').productCategories as WebsiteCategory[];
    const categories: Catalog['categories'] = websiteCategories.map((c, i) => ({
      slug: c.slug,
      title: c.title,
      description: c.description,
      image: c.image,
      available: c.available,
      sortOrder: i,
    }));

    const products: CatalogProduct[] = [];
    for (const [categorySlug, src] of Object.entries(PRODUCT_SOURCES)) {
      const list = load(src.module)[src.exportName] as WebsiteProduct[];
      list.forEach((p, i) =>
        products.push({
          slug: p.id,
          categorySlug,
          sortOrder: i,
          name: p.name,
          subCategory: p.category,
          description: p.description,
          images: p.images,
          specs: p.specs,
          sizes: p.sizes ?? [],
          colorVariants: (p.colorVariants ?? []).map((cv) => ({
            label: cv.label,
            swatch: cv.swatch ?? null,
            image: cv.image ?? null,
          })),
          specSheets: (p.specSheets ?? []).map((s) => ({ title: s.title, url: s.image })),
        }),
      );
    }

    const catalog: Catalog = {
      source:
        'kritex-website/src/data/{tacticalFootwear,combatApparel,loadBearing,productCategories}.ts',
      categories,
      products,
    };
    mkdirSync(dirname(OUTPUT), { recursive: true });
    writeFileSync(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`);
    console.log(
      `Wrote ${OUTPUT}: ${categories.length} categories, ${products.length} products (from ${WEBSITE_DIR})`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
