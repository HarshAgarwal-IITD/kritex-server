import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Authenticated } from '../common/decorators/authenticated.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { OrderNumberParamDto } from '../common/dto/common';
import {
  CancelOrderDto,
  ListMyOrdersQueryDto,
  OrderDetailDto,
  OrderListDto,
  RequestReturnDto,
} from './dto/order.dto';
import { OrdersService } from './orders.service';

@ApiTags('account')
@Authenticated()
@Controller('me/orders')
export class MyOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @ApiOperation({
    operationId: 'listMyOrders',
    summary: "The signed-in user's orders, newest first",
  })
  @ZodResponse({ status: 200, type: OrderListDto, description: 'Paginated orders' })
  @ApiErrors(400)
  list(@CurrentUser() user: SessionUser | undefined, @Query() query: ListMyOrdersQueryDto) {
    return this.orders.listMyOrders(user?.id ?? '', query);
  }

  @Get(':number')
  @ApiOperation({ operationId: 'getMyOrder', summary: 'Order detail with timeline and shipments' })
  @ZodResponse({ status: 200, type: OrderDetailDto, description: 'Order' })
  @ApiErrors(404)
  get(@CurrentUser() user: SessionUser | undefined, @Param() params: OrderNumberParamDto) {
    return this.orders.getMyOrder(user?.id ?? '', params.number);
  }

  @Post(':number/cancel')
  @ApiOperation({
    operationId: 'cancelMyOrder',
    summary: 'Cancel an order before it ships (releases stock; refunds if paid)',
  })
  @ZodResponse({ status: 200, type: OrderDetailDto, description: 'Cancelled order' })
  @ApiErrors(400, 404, [409, 'ORDER_NOT_CANCELLABLE: already SHIPPED or later'])
  cancel(
    @CurrentUser() user: SessionUser | undefined,
    @Param() params: OrderNumberParamDto,
    @Body() body: CancelOrderDto,
  ) {
    return this.orders.cancelMyOrder(user?.id ?? '', params.number, body);
  }

  @Post(':number/return')
  @ApiOperation({
    operationId: 'requestOrderReturn',
    summary: 'Request a return / size exchange (status → RETURN_REQUESTED)',
  })
  @ZodResponse({ status: 200, type: OrderDetailDto, description: 'Updated order' })
  @ApiErrors(400, 404, [409, 'RETURN_NOT_ALLOWED: not DELIVERED or outside the return window'])
  requestReturn(
    @CurrentUser() user: SessionUser | undefined,
    @Param() params: OrderNumberParamDto,
    @Body() body: RequestReturnDto,
  ) {
    return this.orders.requestReturn(user?.id ?? '', params.number, body);
  }
}
