import { Module } from '@nestjs/common';
import { CouponsModule } from '../coupons/coupons.module';
import { PricingModule } from '../pricing/pricing.module';
import { CartCleanupService } from './cart-cleanup.service';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [PricingModule, CouponsModule],
  controllers: [CartController],
  providers: [CartService, CartCleanupService],
  exports: [CartService],
})
export class CartModule {}
