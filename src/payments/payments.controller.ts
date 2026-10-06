import { Controller, Headers, HttpCode, Post, type RawBodyRequest, Req } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Public } from '../common/decorators/public.decorator';
import { WebhookAckDto } from '../shipping/dto/shipment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /**
   * The body is Razorpay-defined and deliberately not parsed with zod: the signature is checked
   * against `req.rawBody` (main.ts sets `rawBody: true`) before anything is read.
   */
  @Post('razorpay')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'handleRazorpayWebhook',
    summary: 'Razorpay events: payment.captured, payment.failed, refund.processed',
  })
  @ApiHeader({ name: 'x-razorpay-signature', required: true, description: 'HMAC-SHA256 of the raw body' })
  @ApiHeader({ name: 'x-razorpay-event-id', required: false, description: 'Used for idempotency' })
  @ApiBody({
    description: 'Razorpay webhook payload (provider-defined)',
    schema: { type: 'object', additionalProperties: true },
  })
  @ZodResponse({ status: 200, type: WebhookAckDto, description: 'Acknowledged (also for duplicates)' })
  @ApiErrors([400, 'SIGNATURE_INVALID'])
  handleRazorpay(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    return this.payments.handleRazorpayWebhook(req.rawBody, signature, eventId);
  }
}
