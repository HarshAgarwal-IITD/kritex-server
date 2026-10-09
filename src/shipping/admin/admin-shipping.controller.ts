import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import { AdminShipmentDto, CreateShiprocketShipmentDto } from '../dto/shipment.dto';
import { ShippingService } from '../shipping.service';

@ApiTags('admin-orders')
@Roles('STAFF', 'ADMIN')
@Controller('admin/orders')
export class AdminShippingController {
  constructor(private readonly shipping: ShippingService) {}

  @Post(':id/shiprocket')
  @ApiOperation({
    operationId: 'adminCreateShiprocketShipment',
    summary: 'Create a Shiprocket shipment: order + AWB + label (+ pickup)',
    description:
      'Resumable: if a step fails (422 SHIPROCKET_ERROR, details.step = create_order | assign_awb | ' +
      'generate_label | request_pickup) call it again and it continues where it stopped. With ' +
      'schedulePickup (default) the order moves to SHIPPED, otherwise PAID → PROCESSING. ' +
      'Dev/test without SHIPROCKET_EMAIL use a fake provider (AWB FAKE…, example.com label).',
  })
  @ZodResponse({ status: 201, type: AdminShipmentDto, description: 'Shipment with AWB + label' })
  @ApiErrors(
    400,
    404,
    [
      409,
      'INVALID_TRANSITION: order not PAID/PROCESSING | SHIPMENT_EXISTS (handed over / in progress)',
    ],
    [422, 'SHIPROCKET_ERROR (details from Shiprocket)'],
  )
  create(
    @Param() params: IdParamDto,
    @Body() body: CreateShiprocketShipmentDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.shipping.createShiprocketShipment(params.id, body, user?.id);
  }
}

@ApiTags('admin-orders')
@Roles('STAFF', 'ADMIN')
@Controller('admin/shipments')
export class AdminShipmentsController {
  constructor(private readonly shipping: ShippingService) {}

  @Post(':id/label')
  @ApiOperation({
    operationId: 'adminGenerateShipmentLabel',
    summary: 'Regenerate the courier label of a Shiprocket shipment',
  })
  @ZodResponse({ status: 201, type: AdminShipmentDto, description: 'Shipment with labelUrl' })
  @ApiErrors(
    400,
    404,
    [409, 'SHIPMENT_NOT_READY (no AWB yet) | SHIPMENT_CLOSED'],
    [422, 'SHIPROCKET_ERROR (details from Shiprocket)'],
  )
  label(@Param() params: IdParamDto) {
    return this.shipping.generateLabel(params.id);
  }

  @Post(':id/pickup')
  @ApiOperation({
    operationId: 'adminRequestShipmentPickup',
    summary: 'Schedule the courier pickup; the order moves to SHIPPED',
  })
  @ZodResponse({ status: 201, type: AdminShipmentDto, description: 'Shipment' })
  @ApiErrors(
    400,
    404,
    [409, 'SHIPMENT_NOT_READY | SHIPMENT_CLOSED | INVALID_TRANSITION'],
    [422, 'SHIPROCKET_ERROR (details from Shiprocket)'],
  )
  pickup(@Param() params: IdParamDto, @CurrentUser() user: SessionUser | undefined) {
    return this.shipping.requestPickup(params.id, user?.id);
  }
}
