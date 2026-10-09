import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { OrdersModule } from '../orders/orders.module';
import {
  AdminShipmentsController,
  AdminShippingController,
} from './admin/admin-shipping.controller';
import { shippingProviderFactory } from './provider/shipping-provider.factory';
import { SHIPPING_PROVIDER } from './provider/shipping-provider';
import { ShippingController, ShiprocketWebhookController } from './shipping.controller';
import { ShippingService } from './shipping.service';

@Module({
  imports: [OrdersModule],
  controllers: [
    ShippingController,
    ShiprocketWebhookController,
    AdminShippingController,
    AdminShipmentsController,
  ],
  providers: [
    ShippingService,
    { provide: SHIPPING_PROVIDER, inject: [AppConfigService], useFactory: shippingProviderFactory },
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
