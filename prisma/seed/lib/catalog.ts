import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Shape of prisma/seed/data/catalog.json (exported once from the website's src/data/*.ts). */
const specSchema = z.object({ label: z.string().min(1), value: z.string().min(1) });

export const catalogProductSchema = z.object({
  /** The website product `id`; becomes Product.slug. */
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  categorySlug: z.string().min(1),
  sortOrder: z.number().int().min(0),
  name: z.string().min(1),
  /** The website's per-product "category" label, e.g. "Jungle Boots". */
  subCategory: z.string().min(1),
  description: z.string(),
  images: z.array(z.string().min(1)),
  specs: z.array(specSchema),
  sizes: z.array(z.string().min(1)),
  colorVariants: z.array(
    z.object({
      label: z.string().min(1),
      swatch: z.string().min(1).nullable(),
      image: z.string().min(1).nullable(),
    }),
  ),
  specSheets: z.array(z.object({ title: z.string().min(1), url: z.string().min(1) })),
});

export const catalogSchema = z
  .object({
    source: z.string(),
    categories: z.array(
      z.object({
        slug: z.string().min(1),
        title: z.string().min(1),
        description: z.string(),
        image: z.string().min(1),
        available: z.boolean(),
        sortOrder: z.number().int().min(0),
      }),
    ),
    products: z.array(catalogProductSchema),
  })
  .superRefine((catalog, ctx) => {
    const categories = new Set(catalog.categories.map((c) => c.slug));
    const seen = new Set<string>();
    catalog.products.forEach((p, i) => {
      if (!categories.has(p.categorySlug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['products', i, 'categorySlug'],
          message: `unknown category "${p.categorySlug}"`,
        });
      }
      if (seen.has(p.slug)) {
        ctx.addIssue({
          code: 'custom',
          path: ['products', i, 'slug'],
          message: `duplicate slug "${p.slug}"`,
        });
      }
      seen.add(p.slug);
    });
  });

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogCategory = Catalog['categories'][number];

export const CATALOG_PATH = join(__dirname, '..', 'data', 'catalog.json');

export function loadCatalog(path = CATALOG_PATH): Catalog {
  return catalogSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}
