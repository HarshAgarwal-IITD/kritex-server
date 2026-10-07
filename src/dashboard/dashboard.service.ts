import { Injectable } from '@nestjs/common';
import { ORDER_STATUSES, type OrderStatus } from '../common/dto/enums';
import { REVENUE_STATUSES } from '../orders/order-state-machine';
import { PrismaService } from '../prisma/prisma.service';
import type { DashboardDto } from './dto/dashboard.dto';

/** Default low-stock threshold: available units (stock - reserved) at or below this. */
export const LOW_STOCK_THRESHOLD = 5;
const LOW_STOCK_LIMIT = 20;
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** 00:00 IST of the day containing `now`, as a UTC instant. */
export function startOfIstDay(now: Date): Date {
  const ist = now.getTime() + IST_OFFSET_MS;
  return new Date(ist - (ist % DAY_MS) - IST_OFFSET_MS);
}

/**
 * Admin dashboard (COM-14). Revenue and order counts cover paid orders (PAID onwards, excluding
 * CANCELLED/REFUNDED) by order date; "today" starts at 00:00 IST, 7/30 days are rolling windows.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(now: Date = new Date(), threshold = LOW_STOCK_THRESHOLD): Promise<DashboardDto> {
    const paid = { status: { in: [...REVENUE_STATUSES] } };
    const window = async (from: Date) => {
      const agg = await this.prisma.order.aggregate({
        where: { ...paid, createdAt: { gte: from } },
        _sum: { total: true },
        _count: { _all: true },
      });
      return { revenue: agg._sum.total ?? 0, count: agg._count._all };
    };
    const [
      today,
      d7,
      d30,
      grouped,
      lowStock,
      pendingQuotes,
      newEnquiries,
      pendingProfiles,
      awaiting,
    ] = await Promise.all([
      window(startOfIstDay(now)),
      window(new Date(now.getTime() - 7 * DAY_MS)),
      window(new Date(now.getTime() - 30 * DAY_MS)),
      this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.$queryRaw<
        {
          variantId: string;
          productId: string;
          productName: string;
          sku: string;
          title: string;
          available: number;
        }[]
      >`
          SELECT v.id AS "variantId", p.id AS "productId", p.name AS "productName", v.sku, v.title,
                 (v.stock - v.reserved)::int AS available
          FROM "Variant" v JOIN "Product" p ON p.id = v."productId"
          WHERE v."isActive" AND p.status <> 'ARCHIVED'
            AND v.stock - v.reserved <= ${threshold}
          ORDER BY v.stock - v.reserved ASC, p.name ASC, v."sortOrder" ASC
          LIMIT ${LOW_STOCK_LIMIT}`,
      this.prisma.quote.count({ where: { status: 'REQUESTED' } }),
      this.prisma.query.count({ where: { status: 'NEW' } }),
      this.prisma.businessProfile.count({ where: { status: 'PENDING' } }),
      this.prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
    ]);
    const counts = new Map<OrderStatus, number>(grouped.map((g) => [g.status, g._count._all]));

    return {
      generatedAt: now.toISOString(),
      revenue: { today: today.revenue, last7Days: d7.revenue, last30Days: d30.revenue },
      orders: {
        today: today.count,
        last7Days: d7.count,
        last30Days: d30.count,
        byStatus: ORDER_STATUSES.map((status) => ({ status, count: counts.get(status) ?? 0 })),
      },
      lowStock: lowStock.map((v) => ({ ...v, available: Number(v.available) })),
      pendingQuotes,
      newEnquiries,
      pendingBusinessProfiles: pendingProfiles,
      awaitingPaymentOrders: awaiting,
    };
  }
}
