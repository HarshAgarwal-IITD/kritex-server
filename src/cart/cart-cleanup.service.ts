import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '../config/app-config.service';
import { CartService } from './cart.service';

/** Daily purge of abandoned guest carts (untouched for CART_GUEST_TTL_DAYS). User carts are kept. */
@Injectable()
export class CartCleanupService {
  private readonly logger = new Logger(CartCleanupService.name);

  constructor(
    private readonly cart: CartService,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'cart-guest-cleanup' })
  async purgeStaleGuestCarts(now: Date = new Date()): Promise<number> {
    const days = this.config.get('CART_GUEST_TTL_DAYS');
    const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    const count = await this.cart.deleteStaleGuestCarts(cutoff);
    if (count > 0) this.logger.log(`Deleted ${count} stale guest cart(s)`);
    return count;
  }
}
