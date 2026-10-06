import { HttpStatus, Injectable } from '@nestjs/common';
import { type BusinessProfile, Prisma, type Role } from '@prisma/client';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { PAID_ORDER_STATUSES, toBusinessProfileDto, toSavedAddress } from '../customers.mappers';
import type {
  AdminBusinessProfileDto,
  AdminBusinessProfileListDto,
  AdminCustomerDetailDto,
  AdminCustomerListDto,
  ListBusinessProfilesQueryDto,
  ListCustomersQueryDto,
  RejectBusinessProfileDto,
} from '../dto/admin-customers.dto';

const CUSTOMER_ROLES: Role[] = ['CUSTOMER', 'B2B_CUSTOMER'];
const RECENT_ORDERS = 10;

const profileInclude = {
  user: { select: { id: true, email: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.BusinessProfileInclude;

type ProfileWithUsers = BusinessProfile & {
  user: { id: string; email: string; name: string };
  approvedBy: { id: string; name: string } | null;
};

function toAdminBusinessProfile(profile: ProfileWithUsers): AdminBusinessProfileDto {
  return {
    ...toBusinessProfileDto(profile),
    user: profile.user,
    reviewedBy: profile.approvedBy,
  };
}

const notFound = (what: string) =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, `${what} not found`);

/** Admin customer list/detail and B2B approvals (AUTH-3). */
@Injectable()
export class AdminCustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async listCustomers(query: ListCustomersQueryDto): Promise<AdminCustomerListDto> {
    const where: Prisma.UserWhereInput = {
      role: query.role ? query.role : { in: CUSTOMER_ROLES },
      ...(query.businessStatus && { businessProfile: { status: query.businessStatus } }),
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
          { phone: { contains: query.q } },
        ],
      }),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          businessProfile: { select: { status: true } },
          _count: { select: { orders: true } },
        },
      }),
    ]);
    const spent = await this.totalSpent(users.map((u) => u.id));
    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        phone: user.phone,
        role: user.role,
        businessStatus: user.businessProfile?.status ?? null,
        orderCount: user._count.orders,
        totalSpent: spent.get(user.id) ?? 0,
        createdAt: user.createdAt.toISOString(),
      })),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  async getCustomer(id: string): Promise<AdminCustomerDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        businessProfile: true,
        addresses: { orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: RECENT_ORDERS,
          select: { id: true, number: true, status: true, total: true, createdAt: true },
        },
        _count: { select: { orders: true } },
      },
    });
    if (!user) throw notFound('Customer');
    const spent = await this.totalSpent([user.id]);
    return {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      name: user.name,
      phone: user.phone,
      role: user.role,
      businessStatus: user.businessProfile?.status ?? null,
      orderCount: user._count.orders,
      totalSpent: spent.get(user.id) ?? 0,
      createdAt: user.createdAt.toISOString(),
      businessProfile: user.businessProfile ? toBusinessProfileDto(user.businessProfile) : null,
      addresses: user.addresses.map(toSavedAddress),
      recentOrders: user.orders.map((order) => ({
        ...order,
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }

  async listBusinessProfiles(
    query: ListBusinessProfilesQueryDto,
  ): Promise<AdminBusinessProfileListDto> {
    const where: Prisma.BusinessProfileWhereInput = {
      ...(query.status && { status: query.status }),
      ...(query.q && {
        OR: [
          { legalName: { contains: query.q, mode: 'insensitive' } },
          { gstin: { contains: query.q.toUpperCase() } },
          { user: { email: { contains: query.q, mode: 'insensitive' } } },
        ],
      }),
    };
    const [total, profiles] = await this.prisma.$transaction([
      this.prisma.businessProfile.count({ where }),
      this.prisma.businessProfile.findMany({
        where,
        // Oldest first: the approvals queue is worked in order of arrival.
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: profileInclude,
      }),
    ]);
    return {
      items: profiles.map(toAdminBusinessProfile),
      page: query.page,
      limit: query.limit,
      total,
    };
  }

  /** PENDING → APPROVED; a CUSTOMER becomes B2B_CUSTOMER (staff roles are left alone). */
  async approveBusinessProfile(id: string, actorId: string): Promise<AdminBusinessProfileDto> {
    return this.prisma.$transaction(async (tx) => {
      const profile = await this.lockPending(tx, id);
      const updated = await tx.businessProfile.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: actorId,
          rejectionReason: null,
        },
        include: profileInclude,
      });
      await tx.user.updateMany({
        where: { id: profile.userId, role: 'CUSTOMER' },
        data: { role: 'B2B_CUSTOMER' },
      });
      return toAdminBusinessProfile(updated);
    });
  }

  /** PENDING → REJECTED with a reason shown to the customer (who may re-apply). */
  async rejectBusinessProfile(
    id: string,
    input: RejectBusinessProfileDto,
    actorId: string,
  ): Promise<AdminBusinessProfileDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockPending(tx, id);
      const updated = await tx.businessProfile.update({
        where: { id },
        data: {
          status: 'REJECTED',
          approvedAt: new Date(),
          approvedById: actorId,
          rejectionReason: input.reason,
        },
        include: profileInclude,
      });
      return toAdminBusinessProfile(updated);
    });
  }

  /** Locks the profile row and checks it is still PENDING (concurrent reviews can't both win). */
  private async lockPending(tx: Prisma.TransactionClient, id: string): Promise<BusinessProfile> {
    await tx.$queryRaw`SELECT id FROM "BusinessProfile" WHERE id = ${id} FOR UPDATE`;
    const profile = await tx.businessProfile.findUnique({ where: { id } });
    if (!profile) throw notFound('Business profile');
    if (profile.status !== 'PENDING') {
      throw new AppException(
        'INVALID_STATUS',
        HttpStatus.CONFLICT,
        `Business profile is ${profile.status}, not PENDING`,
      );
    }
    return profile;
  }

  private async totalSpent(userIds: string[]): Promise<Map<string, number>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { userId: { in: userIds }, status: { in: [...PAID_ORDER_STATUSES] } },
      _sum: { total: true },
    });
    return new Map(rows.map((row) => [row.userId ?? '', row._sum.total ?? 0]));
  }
}
