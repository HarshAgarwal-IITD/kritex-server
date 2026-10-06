import type { SessionUser } from '../common/decorators/current-user.decorator';
import { type AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { CatalogService } from './catalog.service';

const product = (
  saleChannel: 'RETAIL' | 'B2B_ONLY' | 'ENQUIRY_ONLY',
  basePrice: number | null,
) => ({
  id: 'p1',
  slug: 'combat-shirt',
  name: 'Combat Shirt',
  description: null,
  subCategory: 'Shirts',
  category: { id: 'c1', slug: 'apparel', name: 'Apparel' },
  saleChannel,
  basePrice,
  compareAtPrice: 199900,
  specs: [{ label: 'Fabric', value: 'Ripstop' }],
  seoTitle: null,
  seoDescription: null,
  images: [],
  options: [{ name: 'Size', values: ['M', 'L'], swatches: null }],
  variants: [
    {
      id: 'v1',
      sku: 'KTX-CS-M',
      title: 'M',
      options: { Size: 'M' },
      price: null,
      stock: 3,
      reserved: 3,
    },
    {
      id: 'v2',
      sku: 'KTX-CS-L',
      title: 'L',
      options: { Size: 'L' },
      price: 159900,
      stock: 5,
      reserved: 1,
    },
  ],
  specSheets: [],
  priceTiers: [{ minQty: 50, unitPrice: 119900 }],
});

const user = (role: SessionUser['role']): SessionUser => ({
  id: 'u1',
  email: 'u@example.com',
  name: 'U',
  role,
  emailVerified: true,
});

describe('CatalogService.getProductBySlug', () => {
  const prisma = {
    product: { findFirst: jest.fn() },
    businessProfile: { findUnique: jest.fn() },
  };
  const service = new CatalogService(prisma as unknown as PrismaService);

  beforeEach(() => jest.resetAllMocks());

  it('anonymous RETAIL: prices, stock state only, purchasable, no priceTiers key', async () => {
    prisma.product.findFirst.mockResolvedValue(product('RETAIL', 129900));
    const result = await service.getProductBySlug('combat-shirt', undefined);

    expect(result.price).toEqual({ min: 129900, max: 159900 });
    expect(result.variants).toEqual([
      {
        id: 'v1',
        sku: 'KTX-CS-M',
        title: 'M',
        options: { Size: 'M' },
        price: 129900,
        inStock: false,
      },
      {
        id: 'v2',
        sku: 'KTX-CS-L',
        title: 'L',
        options: { Size: 'L' },
        price: 159900,
        inStock: true,
      },
    ]);
    expect(result.inStock).toBe(true);
    expect(result.purchasable).toBe(true);
    expect(result).not.toHaveProperty('priceTiers');
    expect(JSON.stringify(result)).not.toMatch(/"stock"|"reserved"/);
    expect(prisma.businessProfile.findUnique).not.toHaveBeenCalled();
  });

  it('B2B_ONLY is not purchasable for a retail customer, and tiers stay hidden', async () => {
    prisma.product.findFirst.mockResolvedValue(product('B2B_ONLY', 129900));
    const result = await service.getProductBySlug('combat-shirt', user('CUSTOMER'));
    expect(result.purchasable).toBe(false);
    expect(result.price).toEqual({ min: 129900, max: 159900 });
    expect(result).not.toHaveProperty('priceTiers');
  });

  it('approved B2B customer: purchasable B2B_ONLY with priceTiers', async () => {
    prisma.product.findFirst.mockResolvedValue(product('B2B_ONLY', 129900));
    prisma.businessProfile.findUnique.mockResolvedValue({ status: 'APPROVED' });
    const result = await service.getProductBySlug('combat-shirt', user('B2B_CUSTOMER'));
    expect(result.purchasable).toBe(true);
    expect(result.priceTiers).toEqual([{ minQty: 50, unitPrice: 119900 }]);
  });

  it('B2B role without an APPROVED profile is treated as retail', async () => {
    prisma.product.findFirst.mockResolvedValue(product('B2B_ONLY', 129900));
    prisma.businessProfile.findUnique.mockResolvedValue({ status: 'PENDING' });
    const result = await service.getProductBySlug('combat-shirt', user('B2B_CUSTOMER'));
    expect(result.purchasable).toBe(false);
    expect(result).not.toHaveProperty('priceTiers');
  });

  it('ENQUIRY_ONLY hides every price and is never purchasable', async () => {
    prisma.product.findFirst.mockResolvedValue(product('ENQUIRY_ONLY', 129900));
    const result = await service.getProductBySlug('combat-shirt', undefined);
    expect(result.price).toBeNull();
    expect(result.compareAtPrice).toBeNull();
    expect(result.variants.every((variant) => variant.price === null)).toBe(true);
    expect(result.purchasable).toBe(false);
  });

  it('unpriced RETAIL product is not purchasable', async () => {
    const row = product('RETAIL', null);
    row.variants[1].price = null;
    prisma.product.findFirst.mockResolvedValue(row);
    const result = await service.getProductBySlug('combat-shirt', undefined);
    expect(result.price).toBeNull();
    expect(result.purchasable).toBe(false);
  });

  it('404 NOT_FOUND when missing or not ACTIVE', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.getProductBySlug('nope', undefined)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    } satisfies Partial<AppException>);
    expect(prisma.product.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: 'nope', status: 'ACTIVE', category: { isActive: true } },
      }),
    );
  });
});
