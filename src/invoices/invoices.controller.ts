import {
  Controller,
  Get,
  Header,
  HttpStatus,
  Inject,
  Param,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Authenticated } from '../common/decorators/authenticated.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { OrderNumberParamDto } from '../common/dto/common';
import { AppException } from '../common/exceptions/app.exception';
import { InvoiceFileParamDto, InvoiceFileQueryDto, InvoiceLinkDto } from './dto/invoice.dto';
import {
  INVOICE_STORAGE,
  type InvoiceStorage,
  LOCAL_INVOICE_ROUTE,
  LocalInvoiceStorage,
} from './invoice-storage';
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
    description:
      'Issues the invoice on first request if the order is paid and has none yet. The URL is ' +
      'valid for 15 minutes: fetch a new one each time the user clicks "Download invoice".',
  })
  @ZodResponse({ status: 200, type: InvoiceLinkDto, description: 'Invoice link' })
  @ApiErrors([404, 'NOT_FOUND: order not found / not yours / no invoice issued yet'])
  get(@CurrentUser() user: SessionUser | undefined, @Param() params: OrderNumberParamDto) {
    return this.invoices.getInvoiceLink(user, params.number);
  }
}

@ApiTags('account')
@Public()
@Controller(LOCAL_INVOICE_ROUTE)
export class InvoiceFilesController {
  constructor(@Inject(INVOICE_STORAGE) private readonly storage: InvoiceStorage) {}

  /** Only used by the local (dev) storage driver; with R2 the link points at R2 directly. */
  @Get(':file')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'downloadInvoiceFile',
    summary: 'Invoice PDF behind a signed link (local storage driver only; R2 links go to R2)',
  })
  @Header('Cache-Control', 'private, no-store')
  @ApiProduces('application/pdf')
  @ApiResponse({
    status: 200,
    description: 'PDF',
    schema: { type: 'string', format: 'binary' },
  })
  @ApiErrors(400, [404, 'NOT_FOUND: bad / expired link'], 429)
  async download(
    @Param() params: InvoiceFileParamDto,
    @Query() query: InvoiceFileQueryDto,
  ): Promise<StreamableFile> {
    const pdf =
      this.storage instanceof LocalInvoiceStorage
        ? await this.storage.read(params.file, query.expires, query.sig)
        : null;
    if (!pdf) {
      throw new AppException(
        'NOT_FOUND',
        HttpStatus.NOT_FOUND,
        'Invoice link is invalid or expired',
      );
    }
    return new StreamableFile(pdf, {
      type: 'application/pdf',
      disposition: 'inline; filename="invoice.pdf"',
    });
  }
}
