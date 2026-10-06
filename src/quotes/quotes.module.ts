import { Module } from '@nestjs/common';
import { AdminQuotesController } from './admin/admin-quotes.controller';
import { AdminQuotesService } from './admin/admin-quotes.service';
import { MyQuotesController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  controllers: [QuotesController, MyQuotesController, AdminQuotesController],
  providers: [QuotesService, AdminQuotesService],
  exports: [QuotesService],
})
export class QuotesModule {}
