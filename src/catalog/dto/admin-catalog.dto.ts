import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  idSchema,
  isoDateTimeSchema,
  queryBooleanSchema,
  slugSchema,
} from '../../common/dto/common';
import {
  manualInventoryReasonSchema,
  productStatusSchema,
  saleChannelSchema,
} from '../../common/dto/enums';
import { gstRateSchema, moneySchema } from '../../common/dto/money';
import { listSchema, paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';
import {
  priceTierSchema,
  productCategoryRefSchema,
  productImageSchema,
  productOptionSchema,
  specSchema,
  specSheetSchema,
  variantOptionsSchema,
} from './catalog.dto';

// ---------- Categories ----------

export const adminCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  image: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  productCount: z.number().int().nonnegative().meta({ description: 'All statuses' }),
});
export class AdminCategoryDto extends createZodDto(adminCategorySchema) {}
export class AdminCategoryListDto extends createZodDto(listSchema(adminCategorySchema)) {}

const categoryInputShape = {
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  image: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
};
export const createCategorySchema = z.object(categoryInputShape);
export class CreateCategoryDto extends createZodDto(createCategorySchema) {}

export const updateCategorySchema = z.object({
  slug: slugSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  image: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
export class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}

// ---------- Variants ----------

export const adminVariantSchema = z.object({
  id: z.string(),
  productId: z.string(),
  sku: z.string(),
  title: z.string(),
  options: variantOptionsSchema,
  price: moneySchema.nullable().meta({ description: 'Override; null = product basePrice' }),
  effectivePrice: moneySchema.nullable(),
  stock: z.number().int().meta({ description: 'On hand' }),
  reserved: z.number().int().nonnegative().meta({ description: 'Held by unpaid orders' }),
  available: z.number().int().meta({ description: 'stock - reserved' }),
  isActive: z.boolean(),
});
export type AdminVariant = z.infer<typeof adminVariantSchema>;
export class AdminVariantDto extends createZodDto(adminVariantSchema) {}
export class AdminVariantListDto extends createZodDto(listSchema(adminVariantSchema)) {}

const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]{1,63}$/);

/** `POST /admin/products/:id/variants`: (re)generate variants as the cartesian product of the options. */
export const generateVariantsSchema = z.object({
  skuPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{1,24}$/)
    .optional()
    .meta({ description: 'Defaults to a prefix derived from the product slug' }),
  defaultPrice: moneySchema.nullable().optional(),
  defaultStock: z.number().int().nonnegative().default(0),
  deactivateMissing: z.boolean().default(true).meta({
    description: 'Deactivate existing variants whose option combination no longer exists',
  }),
});
export class GenerateVariantsDto extends createZodDto(generateVariantsSchema) {}

export const updateVariantSchema = z.object({
  sku: skuSchema.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  price: moneySchema.nullable().optional(),
  isActive: z.boolean().optional(),
});
export class UpdateVariantDto extends createZodDto(updateVariantSchema) {}

/** `PATCH /admin/variants/:id/stock`: relative change, written as an InventoryMovement. */
export const adjustStockSchema = z.object({
  delta: z
    .number()
    .int()
    .refine((value) => value !== 0, 'delta must not be 0')
    .meta({ description: 'Units to add (positive) or remove (negative)' }),
  reason: manualInventoryReasonSchema,
  note: z.string().trim().max(500).optional(),
});
export class AdjustStockDto extends createZodDto(adjustStockSchema) {}

// ---------- Inventory ----------

export const listInventoryQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'SKU or product name' }),
  lowStock: queryBooleanSchema
    .optional()
    .meta({ description: 'true = only variants with available <= threshold' }),
  threshold: z.coerce.number().int().nonnegative().default(5),
  productId: idSchema.optional(),
  ...paginationQueryShape,
});
export class ListInventoryQueryDto extends createZodDto(listInventoryQuerySchema) {}

export const inventoryRowSchema = z.object({
  variantId: z.string(),
  productId: z.string(),
  productName: z.string(),
  sku: z.string(),
  title: z.string(),
  stock: z.number().int(),
  reserved: z.number().int().nonnegative(),
  available: z.number().int(),
  isActive: z.boolean(),
  lowStock: z.boolean(),
});
export class InventoryListDto extends createZodDto(paginatedSchema(inventoryRowSchema)) {}

// ---------- Products ----------

export const listAdminProductsQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  status: productStatusSchema.optional(),
  saleChannel: saleChannelSchema.optional(),
  category: slugSchema.optional(),
  ...paginationQueryShape,
});
export class ListAdminProductsQueryDto extends createZodDto(listAdminProductsQuerySchema) {}

export const adminProductSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: productCategoryRefSchema,
  status: productStatusSchema,
  saleChannel: saleChannelSchema,
  basePrice: moneySchema.nullable(),
  image: z.string().nullable(),
  variantCount: z.number().int().nonnegative(),
  totalAvailable: z.number().int(),
  updatedAt: isoDateTimeSchema,
});
export class AdminProductListDto extends createZodDto(paginatedSchema(adminProductSummarySchema)) {}

export const adminProductSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  subCategory: z.string().nullable(),
  category: productCategoryRefSchema,
  saleChannel: saleChannelSchema,
  status: productStatusSchema,
  basePrice: moneySchema.nullable(),
  compareAtPrice: moneySchema.nullable(),
  hsnCode: z.string().nullable(),
  gstRate: gstRateSchema.nullable(),
  specs: z.array(specSchema),
  weightGrams: z.number().int().nullable(),
  lengthCm: z.number().int().nullable(),
  widthCm: z.number().int().nullable(),
  heightCm: z.number().int().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  images: z.array(productImageSchema),
  options: z.array(productOptionSchema),
  variants: z.array(adminVariantSchema),
  specSheets: z.array(specSheetSchema.extend({ sortOrder: z.number().int() })),
  priceTiers: z.array(priceTierSchema),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export class AdminProductDto extends createZodDto(adminProductSchema) {}

const imageInputSchema = z.object({
  url: z.string().trim().min(1).max(500),
  alt: z.string().trim().max(200).nullable().optional(),
  sortOrder: z.number().int().default(0),
  variantOptionValue: z.string().trim().max(100).nullable().optional(),
});
const optionInputSchema = z.object({
  name: z.string().trim().min(1).max(50),
  values: z.array(z.string().trim().min(1).max(50)).min(1).max(50),
  swatches: z.record(z.string(), z.string().max(500)).nullable().optional(),
});
const specSheetInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().default(0),
});
const hsnSchema = z
  .string()
  .trim()
  .regex(/^\d{4}(\d{2}){0,2}$/, 'HSN code must be 4, 6 or 8 digits');
const dimensionSchema = z.number().int().positive().nullable().optional();

/**
 * Product fields. Nested arrays (images, options, specSheets, priceTiers) are replaced wholesale
 * when present. Variants are managed via `/admin/products/:id/variants` and `/admin/variants/:id`.
 */
const productInputShape = {
  slug: slugSchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20_000).nullable().optional(),
  subCategory: z.string().trim().max(100).nullable().optional(),
  categoryId: idSchema,
  saleChannel: saleChannelSchema.default('ENQUIRY_ONLY'),
  status: productStatusSchema.default('DRAFT'),
  basePrice: moneySchema.nullable().optional(),
  compareAtPrice: moneySchema.nullable().optional(),
  hsnCode: hsnSchema.nullable().optional(),
  gstRate: gstRateSchema.nullable().optional(),
  specs: z.array(specSchema.extend({ label: z.string().trim().min(1).max(100) })).default([]),
  weightGrams: dimensionSchema,
  lengthCm: dimensionSchema,
  widthCm: dimensionSchema,
  heightCm: dimensionSchema,
  seoTitle: z.string().trim().max(200).nullable().optional(),
  seoDescription: z.string().trim().max(500).nullable().optional(),
  images: z.array(imageInputSchema).max(50).default([]),
  options: z.array(optionInputSchema).max(5).default([]),
  specSheets: z.array(specSheetInputSchema).max(20).default([]),
  priceTiers: z.array(priceTierSchema).max(20).default([]),
};
export const createProductSchema = z.object(productInputShape);
export class CreateProductDto extends createZodDto(createProductSchema) {}

export const updateProductSchema = z.object({
  slug: productInputShape.slug.optional(),
  name: productInputShape.name.optional(),
  description: productInputShape.description,
  subCategory: productInputShape.subCategory,
  categoryId: idSchema.optional(),
  saleChannel: saleChannelSchema.optional(),
  status: productStatusSchema.optional(),
  basePrice: productInputShape.basePrice,
  compareAtPrice: productInputShape.compareAtPrice,
  hsnCode: productInputShape.hsnCode,
  gstRate: productInputShape.gstRate,
  specs: z.array(specSchema).optional(),
  weightGrams: dimensionSchema,
  lengthCm: dimensionSchema,
  widthCm: dimensionSchema,
  heightCm: dimensionSchema,
  seoTitle: productInputShape.seoTitle,
  seoDescription: productInputShape.seoDescription,
  images: z.array(imageInputSchema).max(50).optional(),
  options: z.array(optionInputSchema).max(5).optional(),
  specSheets: z.array(specSheetInputSchema).max(20).optional(),
  priceTiers: z.array(priceTierSchema).max(20).optional(),
});
export class UpdateProductDto extends createZodDto(updateProductSchema) {}

// ---------- Import ----------

export const importProductsQuerySchema = z.object({
  dryRun: queryBooleanSchema
    .optional()
    .meta({ description: 'Validate and report without writing (default false)' }),
});
export class ImportProductsQueryDto extends createZodDto(importProductsQuerySchema) {}

export const importResultSchema = z.object({
  dryRun: z.boolean(),
  rows: z.number().int().nonnegative(),
  created: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(
    z.object({
      row: z.number().int().min(1),
      field: z.string().nullable(),
      message: z.string(),
    }),
  ),
});
export class ImportResultDto extends createZodDto(importResultSchema) {}

// ---------- Uploads ----------

export const UPLOAD_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf',
] as const;

export const createUploadSchema = z.object({
  purpose: z.enum(['PRODUCT_IMAGE', 'SPEC_SHEET', 'CATEGORY_IMAGE']),
  filename: z.string().trim().min(1).max(200),
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
  size: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .meta({ description: 'Bytes (max 20 MB)' }),
});
export class CreateUploadDto extends createZodDto(createUploadSchema) {}

export const uploadTicketSchema = z.object({
  key: z.string().meta({ description: 'Object key in the bucket' }),
  uploadUrl: z.string().meta({ description: 'Presigned URL: PUT the file bytes here' }),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()).meta({ description: 'Headers to send with the PUT' }),
  publicUrl: z.string().meta({ description: 'URL to store on the product once uploaded' }),
  expiresAt: isoDateTimeSchema,
});
export class UploadTicketDto extends createZodDto(uploadTicketSchema) {}
