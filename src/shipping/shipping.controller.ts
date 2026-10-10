import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { RequireVerifiedEmail } from '../common/decorators/verified-email.decorator';
import { OrderNumberParamDto } from '../common/dto/common';
import { OrderTrackingDto, TrackOrderQueryDto, WebhookAckDto } from './dto/shipment.dto';
import { ShippingService } from './shipping.service';

@ApiTags('shipping')
@Public()
@Controller()
export class ShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Get('orders/:number/tracking')
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'getOrderTracking',
    summary: 'Order tracking for the signed-in owner of the order (staff: any order). ADR-021',
  })
  @ZodResponse({ status: 200, type: OrderTrackingDto, description: 'Tracking' })
  @ApiErrors(400, [404, 'NOT_FOUND: no such order on this account'], 429)
  getTracking(
    @Param() params: OrderNumberParamDto,
    // `email` is accepted for older links and ignored.
    @Query() _query: TrackOrderQueryDto,
    @CurrentUser() user: SessionUser,
  ) {
    return this.shipping.getTracking(params.number, user);
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
