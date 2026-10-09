import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';

/**
 * B2B-1: every 10 minutes, QUOTED quotes past `validUntil` become EXPIRED. Accepting is also
 * refused as soon as `validUntil` passes, so the job only keeps statuses (lists, filters) honest.
 */
@Injectable()
export class QuoteExpiryJob {
  private readonly logger = new Logger(QuoteExpiryJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_10_MINUTES, { name: 'quote-expiry' })
  async tick(): Promise<void> {
    try {
      const expired = await this.run();
      if (expired > 0) this.logger.log(`Expired ${expired} quote(s)`);
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'quote expiry run failed');
    }
  }

  /** Callable directly (tests, manual runs). Returns how many quotes expired. */
  async run(now: Date = new Date()): Promise<number> {
    const { count } = await this.prisma.quote.updateMany({
      where: { status: 'QUOTED', validUntil: { lte: now } },
      data: { status: 'EXPIRED' },
    });
    return count;
  }
}
