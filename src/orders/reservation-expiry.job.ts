import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderLifecycleService } from './order-lifecycle.service';

/** COM-11: every minute, cancel unpaid orders past `reservedUntil` and release their stock. */
@Injectable()
export class ReservationExpiryJob {
  private readonly logger = new Logger(ReservationExpiryJob.name);
  private running = false;

  constructor(private readonly lifecycle: OrderLifecycleService) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'order-reservation-expiry' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const cancelled = await this.run();
      if (cancelled > 0) this.logger.log(`Cancelled ${cancelled} unpaid order(s)`);
    } catch (err) {
      this.logger.error({ err: (err as Error).message }, 'reservation expiry run failed');
    } finally {
      this.running = false;
    }
  }

  /** Callable directly (tests, manual runs). */
  run(now: Date = new Date()): Promise<number> {
    return this.lifecycle.releaseExpiredReservations(now);
  }
}
