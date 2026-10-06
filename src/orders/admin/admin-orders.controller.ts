import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import {
  AddOrderNoteDto,
  AdminCancelOrderDto,
  AdminOrderDetailDto,
  AdminOrderListDto,
  ExportOrdersQueryDto,
  ListAdminOrdersQueryDto,
  MarkOrderPaidDto,
  RefundOrderDto,
  ShipOrderDto,
  UpdateOrderStatusDto,
} from '../dto/admin-order.dto';
import { AdminOrdersService } from './admin-orders.service';

@ApiTags('admin-orders')
@Roles('STAFF', 'ADMIN')
@Controller('admin/orders')
export class AdminOrdersController {
  constructor(private readonly orders: AdminOrdersService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListOrders', summary: 'List / filter / search orders' })
  @ZodResponse({ status: 200, type: AdminOrderListDto, description: 'Paginated orders' })
  @ApiErrors(400)
  list(@Query() query: ListAdminOrdersQueryDto) {
    return this.orders.list(query);
  }

  // Declared before ':id' so "export.csv" is not captured as an id.
  @Get('export.csv')
  @ApiOperation({
    operationId: 'adminExportOrders',
    summary: 'CSV export of orders matching the filters (one row per order item)',
  })
  @ApiProduces('text/csv')
  @ApiResponse({ status: 200, description: 'CSV file', schema: { type: 'string' } })
  @ApiErrors(400)
  async exportCsv(
    @Query() query: ExportOrdersQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const csv = await this.orders.exportCsv(query);
    // Set only on success so errors keep the JSON error shape.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="orders.csv"');
    return csv;
  }

  @Get(':id')
  @ApiOperation({
    operationId: 'adminGetOrder',
    summary: 'Order detail (payments, refunds, events)',
  })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Order' })
  @ApiErrors(404)
  get(@Param() params: IdParamDto) {
    return this.orders.get(params.id);
  }

  @Post(':id/status')
  @ApiOperation({
    operationId: 'adminUpdateOrderStatus',
    summary: 'Move the order through the state machine (see allowedTransitions)',
  })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Updated order' })
  @ApiErrors(400, 404, [409, 'INVALID_TRANSITION'])
  updateStatus(
    @Param() params: IdParamDto,
    @Body() body: UpdateOrderStatusDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.orders.updateStatus(params.id, body, user?.id);
  }

  @Post(':id/ship')
  @ApiOperation({
    operationId: 'adminShipOrder',
    summary: 'Manual ship: record carrier/AWB, status → SHIPPED (fallback to Shiprocket)',
  })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Updated order' })
  @ApiErrors(400, 404, [409, 'INVALID_TRANSITION: not PAID/PROCESSING'])
  ship(
    @Param() params: IdParamDto,
    @Body() body: ShipOrderDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.orders.ship(params.id, body, user?.id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    operationId: 'adminCancelOrder',
    summary: 'Cancel (restock + refund by default)',
  })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Cancelled order' })
  @ApiErrors(400, 404, [409, 'INVALID_TRANSITION'])
  cancel(
    @Param() params: IdParamDto,
    @Body() body: AdminCancelOrderDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.orders.cancel(params.id, body, user?.id);
  }

  @Post(':id/refund')
  @ApiOperation({
    operationId: 'adminRefundOrder',
    summary: 'Full or partial Razorpay refund (final status via refund.processed webhook)',
  })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Updated order' })
  @ApiErrors(400, 404, [409, 'REFUND_EXCEEDS_CAPTURED | NOT_REFUNDABLE'])
  refund(
    @Param() params: IdParamDto,
    @Body() body: RefundOrderDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.orders.refund(params.id, body, user?.id);
  }

  @Post(':id/mark-paid')
  @ApiOperation({
    operationId: 'adminMarkOrderPaid',
    summary: 'Record an offline (bank transfer / PO) payment: AWAITING_PAYMENT → PAID',
  })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Paid order' })
  @ApiErrors(400, 404, [409, 'INVALID_TRANSITION: not AWAITING_PAYMENT'])
  markPaid(
    @Param() params: IdParamDto,
    @Body() body: MarkOrderPaidDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.orders.markPaid(params.id, body, user?.id);
  }

  @Post(':id/note')
  @ApiOperation({ operationId: 'adminAddOrderNote', summary: 'Add a note to the order timeline' })
  @ZodResponse({ status: 200, type: AdminOrderDetailDto, description: 'Updated order' })
  @ApiErrors(400, 404)
  addNote(
    @Param() params: IdParamDto,
    @Body() body: AddOrderNoteDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.orders.addNote(params.id, body, user?.id);
  }
}
