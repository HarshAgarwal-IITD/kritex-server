import { Module } from '@nestjs/common';
import { AdminOrdersController } from './admin/admin-orders.controller';
import { AdminOrdersService } from './admin/admin-orders.service';
import { MyOrdersController } from './my-orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [MyOrdersController, AdminOrdersController],
  providers: [OrdersService, AdminOrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
