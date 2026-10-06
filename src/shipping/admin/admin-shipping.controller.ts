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
  })
  @ZodResponse({ status: 201, type: AdminShipmentDto, description: 'Shipment with AWB + label' })
  @ApiErrors(
    400,
    404,
    [409, 'INVALID_TRANSITION: order not PAID/PROCESSING | SHIPMENT_EXISTS'],
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
