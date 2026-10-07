import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentGatewayModule } from '../payments/gateway/payment-gateway.module';
import { PricingModule } from '../pricing';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

@Module({
  imports: [PricingModule, OrdersModule, PaymentGatewayModule],
  controllers: [CheckoutController],
  providers: [CheckoutService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
