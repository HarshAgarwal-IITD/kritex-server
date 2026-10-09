import { Module } from '@nestjs/common';
import { CheckoutModule } from '../checkout/checkout.module';
import { OrdersModule } from '../orders/orders.module';
import { PricingModule } from '../pricing';
import { AdminQuotesController } from './admin/admin-quotes.controller';
import { AdminQuotesService } from './admin/admin-quotes.service';
import { QuoteExpiryJob } from './quote-expiry.job';
import { MyQuotesController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [PricingModule, OrdersModule, CheckoutModule],
  controllers: [QuotesController, MyQuotesController, AdminQuotesController],
  providers: [QuotesService, AdminQuotesService, QuoteExpiryJob],
  exports: [QuotesService, QuoteExpiryJob],
})
export class QuotesModule {}
