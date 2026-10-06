import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import type { InvoiceLinkDto } from './dto/invoice.dto';

/** GST invoices (OPS-2). Owners get their own invoices; STAFF/ADMIN may fetch any. */
@Injectable()
export class InvoicesService {
  getInvoiceLink(_user: SessionUser | undefined, _orderNumber: string): Promise<InvoiceLinkDto> {
    return notImplemented('getOrderInvoice');
  }
}
