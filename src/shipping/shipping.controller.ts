import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Public } from '../common/decorators/public.decorator';
import { OrderNumberParamDto } from '../common/dto/common';
import { OrderTrackingDto, TrackOrderQueryDto, WebhookAckDto } from './dto/shipment.dto';
import { ShippingService } from './shipping.service';

@ApiTags('shipping')
@Public()
@Controller()
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get('orders/:number/tracking')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'getOrderTracking',
    summary: 'Public order tracking (order number + order email)',
  })
  @ZodResponse({ status: 200, type: OrderTrackingDto, description: 'Tracking' })
  @ApiErrors(400, [404, 'NOT_FOUND: no order with this number and email'], 429)
  getTracking(@Param() params: OrderNumberParamDto, @Query() query: TrackOrderQueryDto) {
    return this.shipping.getTracking(params.number, query.email);
  }
}

@ApiTags('webhooks')
@Public()
@Controller('webhooks')
export class ShiprocketWebhookController {
  constructor(private readonly shipping: ShippingService) {}

  /**
   * Body is Shiprocket-defined and not parsed with zod (only the fields the service needs are
   * read). Authenticated by the token Shiprocket sends in `x-api-key`.
   */
  @Post('shiprocket')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'handleShiprocketWebhook',
    summary: 'Shiprocket tracking updates (provider-defined body)',
  })
  @ApiHeader({ name: 'x-api-key', required: true, description: 'Shiprocket webhook token' })
  @ApiBody({
    description: 'Shiprocket tracking payload (provider-defined)',
    schema: { type: 'object', additionalProperties: true },
  })
  @ZodResponse({ status: 200, type: WebhookAckDto, description: 'Acknowledged' })
  @ApiErrors([401, 'UNAUTHORIZED: bad token'])
  handleWebhook(@Headers('x-api-key') token: string | undefined, @Body() payload: unknown) {
    return this.shipping.handleWebhook(token, payload);
  }
}
