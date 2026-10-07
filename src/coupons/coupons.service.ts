import { HttpStatus, Injectable } from '@nestjs/common';
import type { Coupon, Prisma } from '@prisma/client';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CouponDto,
  CouponListDto,
  CreateCouponDto,
  ListCouponsQueryDto,
  UpdateCouponDto,
} from './dto/coupon.dto';

/** Orders in these states don't count as a redemption of their coupon. */
const NON_REDEEMING_ORDER_STATUSES = ['CANCELLED'] as const;

export function toCouponDto(coupon: Coupon): CouponDto {
  return {
    id: coupon.id,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    minSubtotal: coupon.minSubtotal,
    maxDiscount: coupon.maxDiscount,
    startsAt: coupon.startsAt?.toISOString() ?? null,
    endsAt: coupon.endsAt?.toISOString() ?? null,
    usageLimit: coupon.usageLimit,
    perUserLimit: coupon.perUserLimit,
    usedCount: coupon.usedCount,
    isActive: coupon.isActive,
    createdAt: coupon.createdAt.toISOString(),
  };
}

type CouponRuleFields = Pick<Coupon, 'type' | 'value' | 'maxDiscount' | 'startsAt' | 'endsAt'>;

/** Cross-field rules on the merged coupon (create, and PATCH on top of the stored row). */
export function couponRuleIssues(c: CouponRuleFields): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  if (c.type === 'PERCENT' && (c.value < 1 || c.value > 100))
    issues.push({ path: 'value', message: 'PERCENT value must be 1-100' });
  if (c.type === 'FLAT' && c.value < 1)
    issues.push({ path: 'value', message: 'FLAT value must be > 0 paise' });
  if (c.type === 'FREE_SHIPPING' && c.value !== 0)
    issues.push({ path: 'value', message: 'FREE_SHIPPING value must be 0' });
  if (c.type !== 'PERCENT' && c.maxDiscount !== null)
    issues.push({ path: 'maxDiscount', message: 'maxDiscount only applies to PERCENT coupons' });
  if (c.startsAt && c.endsAt && c.startsAt.getTime() >= c.endsAt.getTime())
    issues.push({ path: 'endsAt', message: 'endsAt must be after startsAt' });
  return issues;
}

const toDate = (value: string | null): Date | null => (value === null ? null : new Date(value));

/**
 * Coupons (COM-5): admin CRUD plus the lookups the cart and checkout need. The rules themselves
 * live in `CouponValidationService` (src/pricing). Codes are stored upper-cased and are unique
 * case-insensitively.
 */
@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Case-insensitive lookup by code. */
  findByCode(code: string): Promise<Coupon | null> {
    return this.prisma.coupon.findFirst({
      where: { code: { equals: code.trim(), mode: 'insensitive' } },
    });
  }

  /** Previous redemptions of `code` by this user (orders placed with it, except cancelled ones). */
  customerUsageCount(userId: string, code: string): Promise<number> {
    return this.prisma.order.count({
      where: {
        userId,
        couponCode: { equals: code, mode: 'insensitive' },
        status: { notIn: [...NON_REDEEMING_ORDER_STATUSES] },
      },
    });
  }

  async list(query: ListCouponsQueryDto): Promise<CouponListDto> {
    const where: Prisma.CouponWhereInput = {
      ...(query.q && { code: { contains: query.q, mode: 'insensitive' } }),
      ...(query.isActive !== undefined && { isActive: query.isActive }),
    };
    const [total, coupons] = await this.prisma.$transaction([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: coupons.map(toCouponDto), page: query.page, limit: query.limit, total };
  }

  async create(input: CreateCouponDto): Promise<CouponDto> {
    const data = {
      code: input.code.toUpperCase(),
      type: input.type,
      value: input.value,
      minSubtotal: input.minSubtotal ?? null,
      maxDiscount: input.maxDiscount ?? null,
      startsAt: toDate(input.startsAt ?? null),
      endsAt: toDate(input.endsAt ?? null),
      usageLimit: input.usageLimit ?? null,
      perUserLimit: input.perUserLimit ?? null,
      isActive: input.isActive,
    };
    this.assertRules(data);
    await this.assertCodeFree(data.code);
    return toCouponDto(await this.prisma.coupon.create({ data }));
  }

  async get(id: string): Promise<CouponDto> {
    return toCouponDto(await this.getRow(id));
  }

  async update(id: string, input: UpdateCouponDto): Promise<CouponDto> {
    const current = await this.getRow(id);
    const changes: Partial<Coupon> = {
      ...(input.code !== undefined && { code: input.code.toUpperCase() }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.value !== undefined && { value: input.value }),
      ...(input.minSubtotal !== undefined && { minSubtotal: input.minSubtotal }),
      ...(input.maxDiscount !== undefined && { maxDiscount: input.maxDiscount }),
      ...(input.startsAt !== undefined && { startsAt: toDate(input.startsAt) }),
      ...(input.endsAt !== undefined && { endsAt: toDate(input.endsAt) }),
      ...(input.usageLimit !== undefined && { usageLimit: input.usageLimit }),
      ...(input.perUserLimit !== undefined && { perUserLimit: input.perUserLimit }),
      ...(input.isActive !== undefined && { isActive: input.isActive }),
    };
    this.assertRules({ ...current, ...changes });
    if (changes.code !== undefined && changes.code !== current.code.toUpperCase()) {
      await this.assertCodeFree(changes.code, id);
    }
    return toCouponDto(await this.prisma.coupon.update({ where: { id }, data: changes }));
  }

  /** Deletes an unused coupon; one that orders reference is deactivated instead. */
  async delete(id: string): Promise<void> {
    const coupon = await this.getRow(id);
    const referenced =
      coupon.usedCount > 0 ||
      (await this.prisma.order.count({
        where: { couponCode: { equals: coupon.code, mode: 'insensitive' } },
      })) > 0;
    if (referenced) {
      await this.prisma.coupon.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.coupon.delete({ where: { id } });
    }
  }

  private async getRow(id: string): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Coupon not found');
    return coupon;
  }

  private assertRules(coupon: CouponRuleFields): void {
    const issues = couponRuleIssues(coupon);
    if (issues.length > 0) {
      throw new AppException(
        'VALIDATION_ERROR',
        HttpStatus.BAD_REQUEST,
        'Validation failed',
        issues.map((issue) => ({ ...issue, code: 'custom' })),
      );
    }
  }

  private async assertCodeFree(code: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.coupon.findFirst({
      where: {
        code: { equals: code, mode: 'insensitive' },
        ...(exceptId && { id: { not: exceptId } }),
      },
      select: { id: true },
    });
    if (clash) {
      throw new AppException('CONFLICT', HttpStatus.CONFLICT, 'Coupon code already exists', {
        code,
      });
    }
  }
}
