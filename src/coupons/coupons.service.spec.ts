import type { PrismaService } from '../prisma/prisma.service';
import { couponRuleIssues, CouponsService } from './coupons.service';

const base = {
  type: 'PERCENT' as const,
  value: 10,
  maxDiscount: null,
  startsAt: null,
  endsAt: null,
};

describe('couponRuleIssues', () => {
  it('accepts sane coupons', () => {
    expect(couponRuleIssues(base)).toEqual([]);
    expect(couponRuleIssues({ ...base, maxDiscount: 5000 })).toEqual([]);
    expect(couponRuleIssues({ ...base, type: 'FLAT', value: 1 })).toEqual([]);
    expect(couponRuleIssues({ ...base, type: 'FREE_SHIPPING', value: 0 })).toEqual([]);
  });

  it('rejects inconsistent type/value/maxDiscount/dates', () => {
    const paths = (c: Parameters<typeof couponRuleIssues>[0]) =>
      couponRuleIssues(c).map((issue) => issue.path);
    expect(paths({ ...base, value: 0 })).toEqual(['value']);
    expect(paths({ ...base, value: 101 })).toEqual(['value']);
    expect(paths({ ...base, type: 'FLAT', value: 0 })).toEqual(['value']);
    expect(paths({ ...base, type: 'FREE_SHIPPING', value: 10 })).toEqual(['value']);
    expect(paths({ ...base, type: 'FLAT', value: 5, maxDiscount: 1 })).toEqual(['maxDiscount']);
    const at = new Date('2026-10-01T00:00:00Z');
    expect(paths({ ...base, startsAt: at, endsAt: at })).toEqual(['endsAt']);
  });
});

describe('CouponsService', () => {
  const prisma = {
    coupon: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    order: { count: jest.fn() },
  };
  const service = new CouponsService(prisma as unknown as PrismaService);
  beforeEach(() => jest.resetAllMocks());

  it('create: upper-cases and refuses a code taken in any case', async () => {
    prisma.coupon.findFirst.mockResolvedValue({ id: 'c1' });
    await expect(
      service.create({ code: 'save10', type: 'PERCENT', value: 10, isActive: true }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(prisma.coupon.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { code: { equals: 'SAVE10', mode: 'insensitive' } },
      }),
    );
    expect(prisma.coupon.create).not.toHaveBeenCalled();
  });

  it('customerUsageCount ignores cancelled orders', async () => {
    prisma.order.count.mockResolvedValue(2);
    await expect(service.customerUsageCount('u1', 'SAVE10')).resolves.toBe(2);
    expect(prisma.order.count).toHaveBeenCalledWith({
      where: {
        userId: 'u1',
        couponCode: { equals: 'SAVE10', mode: 'insensitive' },
        status: { notIn: ['CANCELLED'] },
      },
    });
  });

  it('delete deactivates a coupon that orders reference', async () => {
    prisma.coupon.findUnique.mockResolvedValue({ id: 'c1', code: 'X', usedCount: 0 });
    prisma.order.count.mockResolvedValue(1);
    await service.delete('c1');
    expect(prisma.coupon.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { isActive: false },
    });
  });
});
