import { Module } from '@nestjs/common';
import { AdminShippingController } from './admin/admin-shipping.controller';
import { ShippingController, ShiprocketWebhookController } from './shipping.controller';
import { ShippingService } from './shipping.service';

@Module({
  controllers: [ShippingController, ShiprocketWebhookController, AdminShippingController],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
