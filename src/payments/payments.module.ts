import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { PaymentGatewayModule } from './gateway/payment-gateway.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [OrdersModule, PaymentGatewayModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
