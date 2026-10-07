import { Module } from '@nestjs/common';
import { PaymentGatewayModule } from '../payments/gateway/payment-gateway.module';
import { AdminOrdersController } from './admin/admin-orders.controller';
import { AdminOrdersService } from './admin/admin-orders.service';
import { MyOrdersController } from './my-orders.controller';
import { OrderLifecycleService } from './order-lifecycle.service';
import { OrderPaymentsService } from './order-payments.service';
import { OrdersService } from './orders.service';
import { ReservationExpiryJob } from './reservation-expiry.job';

@Module({
  imports: [PaymentGatewayModule],
  controllers: [MyOrdersController, AdminOrdersController],
  providers: [
    OrdersService,
    AdminOrdersService,
    OrderLifecycleService,
    OrderPaymentsService,
    ReservationExpiryJob,
  ],
  exports: [OrdersService, OrderLifecycleService, OrderPaymentsService, ReservationExpiryJob],
})
export class OrdersModule {}
