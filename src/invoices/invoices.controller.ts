import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Authenticated } from '../common/decorators/authenticated.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { OrderNumberParamDto } from '../common/dto/common';
import { InvoiceLinkDto } from './dto/invoice.dto';
import { InvoicesService } from './invoices.service';

@ApiTags('account')
@Authenticated()
@Controller('orders')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get(':number/invoice')
  @ApiOperation({
    operationId: 'getOrderInvoice',
    summary: 'Signed URL to the GST invoice PDF (order owner, or STAFF/ADMIN)',
  })
  @ZodResponse({ status: 200, type: InvoiceLinkDto, description: 'Invoice link' })
  @ApiErrors([404, 'NOT_FOUND: order not found / not yours / no invoice issued yet'])
  get(@CurrentUser() user: SessionUser | undefined, @Param() params: OrderNumberParamDto) {
    return this.invoices.getInvoiceLink(user, params.number);
  }
}
