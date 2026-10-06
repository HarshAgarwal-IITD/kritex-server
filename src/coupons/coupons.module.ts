import { Module } from '@nestjs/common';
import { AdminCouponsController } from './admin/admin-coupons.controller';
import { CouponsService } from './coupons.service';

@Module({
  controllers: [AdminCouponsController],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
