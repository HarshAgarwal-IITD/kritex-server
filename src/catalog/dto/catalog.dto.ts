import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { imageSchema, queryBooleanSchema, slugSchema } from '../../common/dto/common';
import { saleChannelSchema } from '../../common/dto/enums';
import { moneySchema, priceRangeSchema } from '../../common/dto/money';
import { listSchema, paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';

// ---------- Categories ----------

export const categorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  image: z.string().nullable(),
  sortOrder: z.number().int(),
  productCount: z.number().int().nonnegative().meta({ description: 'ACTIVE products only' }),
});
export type Category = z.infer<typeof categorySchema>;

/** `GET /categories`: active categories, ordered by sortOrder. */
export class CategoryListDto extends createZodDto(listSchema(categorySchema)) {}

// ---------- Product cards (listing) ----------

export const PRODUCT_SORTS = ['newest', 'price_asc', 'price_desc'] as const;

export const listProductsQuerySchema = z.object({
  category: slugSchema.optional().meta({ description: 'Category slug' }),
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Free-text search' }),
  size: z.string().trim().min(1).max(50).optional().meta({ description: 'Option value "Size"' }),
  colour: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .optional()
    .meta({ description: 'Option value "Colour"' }),
  minPrice: z.coerce.number().int().nonnegative().optional().meta({ description: 'Paise' }),
  maxPrice: z.coerce.number().int().nonnegative().optional().meta({ description: 'Paise' }),
  saleChannel: saleChannelSchema.optional(),
  inStock: queryBooleanSchema.optional().meta({
    description: 'true = only products with an in-stock active variant (false = no filter)',
  }),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
  ...paginationQueryShape,
});
export class ListProductsQueryDto extends createZodDto(listProductsQuerySchema) {}

export const productCategoryRefSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
});

export const productCardSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  subCategory: z.string().nullable(),
  category: productCategoryRefSchema,
  image: imageSchema.nullable().meta({ description: 'Primary image' }),
  saleChannel: saleChannelSchema,
  price: priceRangeSchema
    .nullable()
    .meta({ description: 'GST-inclusive price range; null for ENQUIRY_ONLY or unpriced products' }),
  compareAtPrice: moneySchema.nullable(),
  inStock: z.boolean().meta({ description: 'At least one active variant has available stock' }),
});
export type ProductCard = z.infer<typeof productCardSchema>;

export class ProductListDto extends createZodDto(paginatedSchema(productCardSchema)) {}

// ---------- Product detail (PDP) ----------

export const productSlugParamSchema = z.object({ slug: slugSchema });
export class ProductSlugParamDto extends createZodDto(productSlugParamSchema) {}

export const productImageSchema = z.object({
  id: z.string(),
  url: z.string(),
  alt: z.string().nullable(),
  sortOrder: z.number().int(),
  variantOptionValue: z
    .string()
    .nullable()
    .meta({ description: 'Option value this image belongs to (e.g. colour "Olive Green")' }),
});

export const productOptionSchema = z.object({
  name: z.string().meta({ example: 'Size' }),
  values: z.array(z.string()),
  swatches: z
    .record(z.string(), z.string())
    .nullable()
    .meta({ description: 'value → CSS colour or image URL' }),
});

/** Variant options, e.g. `{ "Size": "M", "Colour": "Olive Green" }`. */
export const variantOptionsSchema = z.record(z.string(), z.string());

export const publicVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  title: z.string().meta({ example: 'M / Olive Green' }),
  options: variantOptionsSchema,
  price: moneySchema.nullable().meta({ description: 'Effective unit price; null if unpriced' }),
  inStock: z.boolean().meta({ description: 'Never the raw stock count' }),
});

export const specSchema = z.object({ label: z.string(), value: z.string() });

export const specSheetSchema = z.object({
  id: z.string(),
  title: z.string(),
  url: z.string(),
});

export const priceTierSchema = z.object({
  minQty: z.number().int().min(1),
  unitPrice: moneySchema,
});

export const productDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  subCategory: z.string().nullable(),
  category: productCategoryRefSchema,
  saleChannel: saleChannelSchema,
  price: priceRangeSchema.nullable(),
  compareAtPrice: moneySchema.nullable(),
  inStock: z.boolean(),
  purchasable: z.boolean().meta({
    description:
      'Whether the current viewer can add this product to the cart (RETAIL, or B2B_ONLY for approved B2B users)',
  }),
  images: z.array(productImageSchema),
  options: z.array(productOptionSchema),
  variants: z.array(publicVariantSchema).meta({ description: 'Active variants only' }),
  specs: z.array(specSchema),
  specSheets: z.array(specSheetSchema),
  priceTiers: z
    .array(priceTierSchema)
    .optional()
    .meta({ description: 'B2B tier prices; present only for approved B2B customers' }),
  seo: z.object({ title: z.string().nullable(), description: z.string().nullable() }),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export class ProductDetailDto extends createZodDto(productDetailSchema) {}

// ---------- Search suggest ----------

export const searchSuggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export class SearchSuggestQueryDto extends createZodDto(searchSuggestQuerySchema) {}

export const searchSuggestionSchema = z.object({
  type: z.enum(['product', 'category']),
  slug: z.string(),
  name: z.string(),
  image: z.string().nullable(),
  categorySlug: z.string().nullable().meta({ description: 'For products: their category slug' }),
});

export class SearchSuggestResponseDto extends createZodDto(listSchema(searchSuggestionSchema)) {}
