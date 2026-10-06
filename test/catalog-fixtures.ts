import type { PrismaService } from '../src/prisma/prisma.service';

/**
 * Small catalog for the catalog e2e specs:
 *   apparel (active):  Combat Shirt (RETAIL), Tactical Helmet (ENQUIRY_ONLY), Draft Jacket (DRAFT)
 *   footwear (active): Jungle Boots (B2B_ONLY, out of stock)
 *   hidden (inactive): Hidden Cap (ACTIVE, but its category is inactive)
 * createdAt increases: shirt < helmet < boots (so "newest" = boots, helmet, shirt).
 */
export async function seedCatalog(prisma: PrismaService) {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 1, 0, minutes));

  const apparel = await prisma.category.create({
    data: { slug: 'apparel', name: 'Apparel', description: 'Uniforms', sortOrder: 1 },
  });
  const footwear = await prisma.category.create({
    data: { slug: 'footwear', name: 'Footwear', image: '/assets/boots.jpg', sortOrder: 2 },
  });
  const hidden = await prisma.category.create({
    data: { slug: 'hidden', name: 'Hidden', sortOrder: 0, isActive: false },
  });

  const shirt = await prisma.product.create({
    data: {
      slug: 'combat-shirt',
      name: 'Combat Shirt',
      description: 'Ripstop combat shirt',
      subCategory: 'Shirts',
      categoryId: apparel.id,
      saleChannel: 'RETAIL',
      status: 'ACTIVE',
      basePrice: 129900,
      compareAtPrice: 149900,
      hsnCode: '6205',
      gstRate: 12,
      specs: [{ label: 'Fabric', value: 'Ripstop' }],
      seoTitle: 'Combat Shirt | Kritex',
      createdAt: at(1),
      images: {
        create: [
          { url: '/assets/shirt-2.jpg', alt: 'Back', sortOrder: 1 },
          {
            url: '/assets/shirt-1.jpg',
            alt: 'Front',
            sortOrder: 0,
            variantOptionValue: 'Olive Green',
          },
        ],
      },
      options: {
        create: [
          { name: 'Size', values: ['M', 'L'], sortOrder: 0 },
          {
            name: 'Colour',
            values: ['Olive Green', 'Black'],
            swatches: { 'Olive Green': '#556b2f', Black: '#000' },
            sortOrder: 1,
          },
        ],
      },
      variants: {
        create: [
          {
            sku: 'KTX-CS-M-OLIVEGREEN',
            title: 'M / Olive Green',
            options: { Size: 'M', Colour: 'Olive Green' },
            stock: 5,
            sortOrder: 0,
          },
          {
            sku: 'KTX-CS-L-BLACK',
            title: 'L / Black',
            options: { Size: 'L', Colour: 'Black' },
            price: 159900,
            stock: 0,
            sortOrder: 1,
          },
          {
            sku: 'KTX-CS-XL-BLACK',
            title: 'XL / Black',
            options: { Size: 'XL', Colour: 'Black' },
            price: 99,
            stock: 10,
            isActive: false,
            sortOrder: 2,
          },
        ],
      },
      specSheets: { create: [{ title: 'Size chart', url: '/docs/size-chart.pdf' }] },
      priceTiers: { create: [{ minQty: 50, unitPrice: 119900 }] },
    },
  });

  const helmet = await prisma.product.create({
    data: {
      slug: 'tactical-helmet',
      name: 'Tactical Helmet',
      categoryId: apparel.id,
      saleChannel: 'ENQUIRY_ONLY',
      status: 'ACTIVE',
      basePrice: 999900,
      compareAtPrice: 1099900,
      createdAt: at(2),
      variants: { create: [{ sku: 'KTX-TH', title: 'Default', options: {}, stock: 3 }] },
    },
  });

  const boots = await prisma.product.create({
    data: {
      slug: 'jungle-boots',
      name: 'Jungle Boots',
      categoryId: footwear.id,
      saleChannel: 'B2B_ONLY',
      status: 'ACTIVE',
      basePrice: 450000,
      createdAt: at(3),
      options: { create: [{ name: 'Size', values: ['9'] }] },
      variants: {
        create: [{ sku: 'KTX-JB-9', title: '9', options: { Size: '9' }, stock: 2, reserved: 2 }],
      },
    },
  });

  await prisma.product.create({
    data: {
      slug: 'draft-jacket',
      name: 'Draft Jacket',
      categoryId: apparel.id,
      saleChannel: 'RETAIL',
      status: 'DRAFT',
      basePrice: 1000,
      createdAt: at(4),
      variants: { create: [{ sku: 'KTX-DJ', title: 'Default', stock: 1 }] },
    },
  });

  await prisma.product.create({
    data: {
      slug: 'hidden-cap',
      name: 'Hidden Cap',
      categoryId: hidden.id,
      saleChannel: 'RETAIL',
      status: 'ACTIVE',
      basePrice: 1000,
      createdAt: at(5),
      variants: { create: [{ sku: 'KTX-HC', title: 'Default', stock: 1 }] },
    },
  });

  return { apparel, footwear, hidden, shirt, helmet, boots };
}
