import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { createInvoiceStorage, INVOICE_STORAGE } from './invoice-storage';
import { InvoiceFilesController, InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/** GST tax invoices (OPS-2): issued on `order.paid`, PDF in private storage, signed links. */
@Module({
  controllers: [InvoicesController, InvoiceFilesController],
  providers: [
    InvoicesService,
    { provide: INVOICE_STORAGE, inject: [AppConfigService], useFactory: createInvoiceStorage },
  ],
  exports: [InvoicesService],
})
export class InvoicesModule {}
