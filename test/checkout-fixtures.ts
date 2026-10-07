import { randomUUID } from 'node:crypto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { FAKE_WEBHOOK_SECRET } from '../src/payments/gateway/fake.gateway';
import { hmacSha256Hex } from '../src/payments/gateway/payment-gateway';

/** Maharashtra = the default BUSINESS_STATE_CODE (intra-state → CGST + SGST). */
export const ADDRESS = {
  name: 'Asha Rao',
  phone: '+919876543210',
  line1: '12 MG Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '400001',
};
export const KARNATAKA = {
  ...ADDRESS,
  city: 'Bengaluru',
  state: 'Karnataka',
  stateCode: '29',
  pincode: '560001',
};

/**
 * Catalog for checkout specs:
 *   shirt  (RETAIL, ₹1,299, HSN 6205 slab → 5%): M (stock 5), L (stock 1)
 *   kit    (RETAIL, ₹9,999, 18%): Default (stock 10)
 *   helmet (ENQUIRY_ONLY): Default (stock 3)
 */
export async function seedCheckoutCatalog(prisma: PrismaService) {
  const category = await prisma.category.create({ data: { slug: 'apparel', name: 'Apparel' } });
  const shirt = await prisma.product.create({
    data: {
      slug: 'combat-shirt',
      name: 'Combat Shirt',
      categoryId: category.id,
      saleChannel: 'RETAIL',
      status: 'ACTIVE',
      basePrice: 129900,
      hsnCode: '6205',
      gstRate: 12,
      images: { create: [{ url: '/assets/shirt.jpg', sortOrder: 0 }] },
      variants: {
        create: [
          { sku: 'KTX-CS-M', title: 'M', options: { Size: 'M' }, stock: 5, sortOrder: 0 },
          { sku: 'KTX-CS-L', title: 'L', options: { Size: 'L' }, stock: 1, sortOrder: 1 },
        ],
      },
    },
    include: { variants: { orderBy: { sortOrder: 'asc' } } },
  });
  const kit = await prisma.product.create({
    data: {
      slug: 'field-kit',
      name: 'Field Kit',
      categoryId: category.id,
      saleChannel: 'RETAIL',
      status: 'ACTIVE',
      basePrice: 999900,
      hsnCode: '9020',
      gstRate: 18,
      variants: { create: [{ sku: 'KTX-FK', title: 'Default', stock: 10 }] },
    },
    include: { variants: true },
  });
  const helmet = await prisma.product.create({
    data: {
      slug: 'tactical-helmet',
      name: 'Tactical Helmet',
      categoryId: category.id,
      saleChannel: 'ENQUIRY_ONLY',
      status: 'ACTIVE',
      basePrice: 499900,
      variants: { create: [{ sku: 'KTX-TH', title: 'Default', stock: 3 }] },
    },
    include: { variants: true },
  });
  return {
    shirtM: shirt.variants[0],
    shirtL: shirt.variants[1],
    kit: kit.variants[0],
    helmet: helmet.variants[0],
  };
}

/** A guest cart (cookie `kritex_cart=<token>`) or a user's cart with the given lines. */
export async function createCart(
  prisma: PrismaService,
  lines: { variantId: string; quantity: number }[],
  options: { userId?: string; couponCode?: string } = {},
): Promise<{ cartId: string; cookie: string; guestToken: string | null }> {
  const guestToken = options.userId ? null : randomUUID();
  const cart = await prisma.cart.create({
    data: {
      userId: options.userId ?? null,
      guestToken,
      couponCode: options.couponCode ?? null,
      items: { create: lines },
    },
  });
  return { cartId: cart.id, cookie: guestToken ? `kritex_cart=${guestToken}` : '', guestToken };
}

/** A Razorpay-shaped webhook body + signature (fake gateway secret). */
export function signedWebhook(body: unknown): { raw: string; signature: string } {
  const raw = JSON.stringify(body);
  return { raw, signature: hmacSha256Hex(FAKE_WEBHOOK_SECRET, raw) };
}

export function paymentCapturedEvent(orderId: string, paymentId: string, amount: number) {
  return {
    entity: 'event',
    event: 'payment.captured',
    payload: {
      payment: {
        entity: { id: paymentId, order_id: orderId, amount, status: 'captured', method: 'upi' },
      },
    },
  };
}

export function refundProcessedEvent(refundId: string, paymentId: string, amount: number) {
  return {
    entity: 'event',
    event: 'refund.processed',
    payload: {
      refund: { entity: { id: refundId, payment_id: paymentId, amount, status: 'processed' } },
    },
  };
}
