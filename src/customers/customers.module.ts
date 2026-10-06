import { Module } from '@nestjs/common';
import { AdminCustomersController } from './admin/admin-customers.controller';
import { AdminCustomersService } from './admin/admin-customers.service';
import { CustomersService } from './customers.service';
import { MeController } from './me.controller';

@Module({
  controllers: [MeController, AdminCustomersController],
  providers: [CustomersService, AdminCustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
