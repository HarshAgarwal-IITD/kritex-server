import { createCouponSchema, updateCouponSchema } from '../../coupons/dto/coupon.dto';
import { placeOrderSchema } from '../../checkout/dto/checkout.dto';
import { listProductsQuerySchema } from '../../catalog/dto/catalog.dto';
import { addressInputSchema } from './address';
import { queryBooleanSchema } from './common';
import { gstinSchema, phoneSchema, pincodeSchema } from './india';
import { paginatedSchema, paginationQuerySchema } from './pagination';
import { z } from 'zod';

const address = {
  name: 'Harsh',
  phone: '9876543210',
  line1: '1 MG Road',
  city: 'Mumbai',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '400001',
};

describe('India formats', () => {
  it('GSTIN: trims + upper-cases, rejects malformed', () => {
    expect(gstinSchema.parse(' 27aapfu0939f1zv ')).toBe('27AAPFU0939F1ZV');
    expect(gstinSchema.safeParse('27AAPFU0939F1Z').success).toBe(false);
    expect(gstinSchema.safeParse('AAPFU0939F1ZV27').success).toBe(false);
  });

  it('PIN code: 6 digits, not starting with 0', () => {
    expect(pincodeSchema.safeParse('400001').success).toBe(true);
    expect(pincodeSchema.safeParse('040001').success).toBe(false);
    expect(pincodeSchema.safeParse('40001').success).toBe(false);
  });

  it('phone: Indian mobile with optional +91', () => {
    expect(phoneSchema.safeParse('+919876543210').success).toBe(true);
    expect(phoneSchema.safeParse('9876543210').success).toBe(true);
    expect(phoneSchema.safeParse('5876543210').success).toBe(false);
  });

  it('address: defaults country to IN, requires a GST state code', () => {
    expect(addressInputSchema.parse(address).country).toBe('IN');
    expect(addressInputSchema.safeParse({ ...address, stateCode: '99' }).success).toBe(false);
    expect(addressInputSchema.safeParse({ ...address, country: 'US' }).success).toBe(false);
  });
});

describe('pagination', () => {
  it('coerces query strings and applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.parse({ page: '3', limit: '100' })).toEqual({
      page: 3,
      limit: 100,
    });
    expect(paginationQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('builds the { items, page, limit, total } envelope', () => {
    const schema = paginatedSchema(z.object({ id: z.string() }));
    expect(schema.parse({ items: [{ id: 'a' }], page: 1, limit: 20, total: 1 })).toBeTruthy();
    expect(schema.safeParse({ items: [] }).success).toBe(false);
  });

  it('product list query: sort default, price filters in paise', () => {
    expect(listProductsQuerySchema.parse({ minPrice: '50000' })).toMatchObject({
      minPrice: 50000,
      sort: 'newest',
    });
    expect(listProductsQuerySchema.safeParse({ sort: 'cheapest' }).success).toBe(false);
  });

  it('query booleans accept only "true"/"false"', () => {
    expect(queryBooleanSchema.parse('true')).toBe(true);
    expect(queryBooleanSchema.parse('false')).toBe(false);
    expect(queryBooleanSchema.safeParse('1').success).toBe(false);
  });
});

describe('coupon input', () => {
  it('upper-cases codes and checks PERCENT range and date order', () => {
    expect(createCouponSchema.parse({ code: 'welcome10', type: 'PERCENT', value: 10 }).code).toBe(
      'WELCOME10',
    );
    expect(createCouponSchema.safeParse({ code: 'BIG', type: 'PERCENT', value: 150 }).success).toBe(
      false,
    );
    expect(
      updateCouponSchema.safeParse({
        startsAt: '2026-11-01T00:00:00.000Z',
        endsAt: '2026-10-01T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('checkout input', () => {
  const base = { email: 'A@B.co', phone: '9876543210', shippingAddress: address };

  it('defaults to RAZORPAY and rejects COD', () => {
    expect(placeOrderSchema.parse(base)).toMatchObject({
      email: 'a@b.co',
      paymentMethod: 'RAZORPAY',
    });
    expect(placeOrderSchema.safeParse({ ...base, paymentMethod: 'COD' }).success).toBe(false);
  });

  it('requires businessName with gstin', () => {
    expect(placeOrderSchema.safeParse({ ...base, gstin: '27AAPFU0939F1ZV' }).success).toBe(false);
    expect(
      placeOrderSchema.safeParse({ ...base, gstin: '27AAPFU0939F1ZV', businessName: 'Kritex' })
        .success,
    ).toBe(true);
  });
});
