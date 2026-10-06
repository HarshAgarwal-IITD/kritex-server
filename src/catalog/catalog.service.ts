import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  escapeLike,
  parseSpecs,
  parseSwatches,
  parseVariantOptions,
  priceRange,
  publicPrice,
} from './catalog.mappers';
import type {
  CategoryListDto,
  ListProductsQueryDto,
  ProductCard,
  ProductDetailDto,
  ProductListDto,
  SearchSuggestQueryDto,
  SearchSuggestResponseDto,
} from './dto/catalog.dto';

/** Postgres pg_trgm word_similarity cut-off for fuzzy typeahead matches (typos, partial words). */
export const SUGGEST_SIMILARITY = 0.3;

const CARD_INCLUDE = {
  category: { select: { id: true, slug: true, name: true } },
  images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: 1 },
  variants: {
    where: { isActive: true },
    select: { price: true, stock: true, reserved: true },
  },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof CARD_INCLUDE }>;

/** Public catalog reads (CAT-1..4). Only ACTIVE products in active categories are visible. */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<CategoryListDto> {
    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: { where: { status: 'ACTIVE' } } } } },
    });
    return {
      items: categories.map((category) => ({
        id: category.id,
        slug: category.slug,
        name: category.name,
        description: category.description,
        image: category.image,
        sortOrder: category.sortOrder,
        productCount: category._count.products,
      })),
    };
  }

  async listProducts(query: ListProductsQueryDto): Promise<ProductListDto> {
    const where = productFilters(query);
    const orderBy = {
      newest: Prisma.sql`p."createdAt" DESC, p.id DESC`,
      price_asc: Prisma.sql`vp.min_price ASC NULLS LAST, p."createdAt" DESC, p.id DESC`,
      price_desc: Prisma.sql`vp.max_price DESC NULLS LAST, p."createdAt" DESC, p.id DESC`,
    }[query.sort];
    // vp: per-product aggregates over active variants (public price range, any stock available).
    const from = Prisma.sql`
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN (
        SELECT v."productId",
          MIN(COALESCE(v.price, pp."basePrice")) FILTER (WHERE pp."saleChannel" <> 'ENQUIRY_ONLY') AS min_price,
          MAX(COALESCE(v.price, pp."basePrice")) FILTER (WHERE pp."saleChannel" <> 'ENQUIRY_ONLY') AS max_price,
          BOOL_OR(v.stock - v.reserved > 0) AS in_stock
        FROM "Variant" v JOIN "Product" pp ON pp.id = v."productId"
        WHERE v."isActive"
        GROUP BY v."productId"
      ) vp ON vp."productId" = p.id
      WHERE ${Prisma.join(where, ' AND ')}`;

    const [rows, counts] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id ${from}
        ORDER BY ${orderBy}
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from}`,
    ]);

    const ids = rows.map((row) => row.id);
    const products = ids.length
      ? await this.prisma.product.findMany({ where: { id: { in: ids } }, include: CARD_INCLUDE })
      : [];
    const byId = new Map(products.map((product) => [product.id, product]));
    return {
      items: ids.flatMap((id) => {
        const product = byId.get(id);
        return product ? [toCard(product)] : [];
      }),
      page: query.page,
      limit: query.limit,
      total: counts[0]?.total ?? 0,
    };
  }

  /** `user` decides `purchasable` and whether `priceTiers` are included (approved B2B only). */
  async getProductBySlug(slug: string, user: SessionUser | undefined): Promise<ProductDetailDto> {
    const b2b = await this.isApprovedB2B(user);
    const product = await this.prisma.product.findFirst({
      where: { slug, status: 'ACTIVE', category: { isActive: true } },
      include: {
        category: { select: { id: true, slug: true, name: true } },
        images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        options: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        variants: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        specSheets: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        priceTiers: { orderBy: { minQty: 'asc' } },
      },
    });
    if (!product) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Product not found', { slug });
    }

    const variants = product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      options: parseVariantOptions(variant.options),
      price: publicPrice(product.saleChannel, variant.price, product.basePrice),
      inStock: variant.stock - variant.reserved > 0,
    }));
    const price = priceRange(variants.map((variant) => variant.price));
    const channelAllowed =
      product.saleChannel === 'RETAIL' || (product.saleChannel === 'B2B_ONLY' && b2b);

    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      description: product.description,
      subCategory: product.subCategory,
      category: product.category,
      saleChannel: product.saleChannel,
      price,
      compareAtPrice: product.saleChannel === 'ENQUIRY_ONLY' ? null : product.compareAtPrice,
      inStock: variants.some((variant) => variant.inStock),
      purchasable: channelAllowed && price !== null,
      images: product.images.map((image) => ({
        id: image.id,
        url: image.url,
        alt: image.alt,
        sortOrder: image.sortOrder,
        variantOptionValue: image.variantOptionValue,
      })),
      options: product.options.map((option) => ({
        name: option.name,
        values: option.values,
        swatches: parseSwatches(option.swatches),
      })),
      variants,
      specs: parseSpecs(product.specs),
      specSheets: product.specSheets.map(({ id, title, url }) => ({ id, title, url })),
      // The key is absent (not empty) unless the viewer is approved B2B.
      ...(b2b
        ? {
            priceTiers: product.priceTiers.map(({ minQty, unitPrice }) => ({ minQty, unitPrice })),
          }
        : {}),
      seo: { title: product.seoTitle, description: product.seoDescription },
    };
  }

  /**
   * Typeahead: a few matching categories, then products. Matches a substring (ILIKE, served by the
   * trigram GIN index) or a fuzzy pg_trgm word similarity (typos); prefix matches rank first.
   */
  async searchSuggest(query: SearchSuggestQueryDto): Promise<SearchSuggestResponseDto> {
    const q = query.q;
    const pattern = `%${escapeLike(q)}%`;
    const prefix = `${escapeLike(q)}%`;
    const categoryLimit = Math.min(3, Math.ceil(query.limit / 4));

    const categories = await this.prisma.$queryRaw<
      { slug: string; name: string; image: string | null }[]
    >`
      SELECT c.slug, c.name, c.image
      FROM "Category" c
      WHERE c."isActive"
        AND (c.name ILIKE ${pattern} OR word_similarity(${q}, c.name) >= ${SUGGEST_SIMILARITY})
      ORDER BY (c.name ILIKE ${prefix}) DESC, word_similarity(${q}, c.name) DESC, c."sortOrder", c.name
      LIMIT ${categoryLimit}`;

    const products = await this.prisma.$queryRaw<
      { slug: string; name: string; image: string | null; categorySlug: string }[]
    >`
      SELECT p.slug, p.name, c.slug AS "categorySlug",
        (SELECT i.url FROM "ProductImage" i WHERE i."productId" = p.id
         ORDER BY i."sortOrder", i.id LIMIT 1) AS image
      FROM "Product" p
      JOIN "Category" c ON c.id = p."categoryId"
      WHERE p.status = 'ACTIVE' AND c."isActive"
        AND (p.name ILIKE ${pattern} OR word_similarity(${q}, p.name) >= ${SUGGEST_SIMILARITY})
      ORDER BY (p.name ILIKE ${prefix}) DESC, word_similarity(${q}, p.name) DESC, p.name
      LIMIT ${query.limit - categories.length}`;

    return {
      items: [
        ...categories.map((category) => ({
          type: 'category' as const,
          slug: category.slug,
          name: category.name,
          image: category.image,
          categorySlug: null,
        })),
        ...products.map((product) => ({
          type: 'product' as const,
          slug: product.slug,
          name: product.name,
          image: product.image,
          categorySlug: product.categorySlug,
        })),
      ],
    };
  }

  /** ADR-004: the B2B_CUSTOMER role backed by an APPROVED business profile. */
  private async isApprovedB2B(user: SessionUser | undefined): Promise<boolean> {
    if (!user || user.role !== 'B2B_CUSTOMER') return false;
    const profile = await this.prisma.businessProfile.findUnique({
      where: { userId: user.id },
      select: { status: true },
    });
    return profile?.status === 'APPROVED';
  }
}

/** SQL WHERE fragments for `GET /products` (aliases: p = Product, c = Category, vp = aggregates). */
export function productFilters(query: ListProductsQueryDto): Prisma.Sql[] {
  const where: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`, Prisma.sql`c."isActive"`];
  if (query.category) where.push(Prisma.sql`c.slug = ${query.category}`);
  if (query.saleChannel) {
    where.push(Prisma.sql`p."saleChannel" = ${query.saleChannel}::"SaleChannel"`);
  }
  if (query.q) {
    const pattern = `%${escapeLike(query.q)}%`;
    where.push(
      Prisma.sql`(p.name ILIKE ${pattern} OR p."subCategory" ILIKE ${pattern} OR c.name ILIKE ${pattern})`,
    );
  }
  if (query.size || query.colour) {
    // Same variant must match both, so "M in Olive Green" means one purchasable SKU.
    const option: Prisma.Sql[] = [Prisma.sql`v."productId" = p.id`, Prisma.sql`v."isActive"`];
    if (query.size) option.push(Prisma.sql`lower(v.options->>'Size') = lower(${query.size})`);
    if (query.colour) {
      option.push(Prisma.sql`lower(v.options->>'Colour') = lower(${query.colour})`);
    }
    where.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Variant" v WHERE ${Prisma.join(option, ' AND ')})`,
    );
  }
  if (query.minPrice !== undefined || query.maxPrice !== undefined) {
    // Some active variant's public price falls inside the range (ENQUIRY_ONLY has no price).
    const price: Prisma.Sql[] = [
      Prisma.sql`v."productId" = p.id`,
      Prisma.sql`v."isActive"`,
      Prisma.sql`p."saleChannel" <> 'ENQUIRY_ONLY'`,
      Prisma.sql`COALESCE(v.price, p."basePrice") IS NOT NULL`,
    ];
    if (query.minPrice !== undefined) {
      price.push(Prisma.sql`COALESCE(v.price, p."basePrice") >= ${query.minPrice}`);
    }
    if (query.maxPrice !== undefined) {
      price.push(Prisma.sql`COALESCE(v.price, p."basePrice") <= ${query.maxPrice}`);
    }
    where.push(Prisma.sql`EXISTS (SELECT 1 FROM "Variant" v WHERE ${Prisma.join(price, ' AND ')})`);
  }
  if (query.inStock) where.push(Prisma.sql`COALESCE(vp.in_stock, false)`);
  return where;
}

function toCard(product: CardRow): ProductCard {
  const image = product.images[0];
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    subCategory: product.subCategory,
    category: product.category,
    image: image ? { url: image.url, alt: image.alt } : null,
    saleChannel: product.saleChannel,
    price: priceRange(
      product.variants.map((variant) =>
        publicPrice(product.saleChannel, variant.price, product.basePrice),
      ),
    ),
    compareAtPrice: product.saleChannel === 'ENQUIRY_ONLY' ? null : product.compareAtPrice,
    inStock: product.variants.some((variant) => variant.stock - variant.reserved > 0),
  };
}
