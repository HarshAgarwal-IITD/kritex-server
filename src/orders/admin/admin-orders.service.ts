import { Injectable } from '@nestjs/common';
import { notImplemented } from '../../common/exceptions/not-implemented';
import type {
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

/** Admin order management (COM-14, B2B-4). */
@Injectable()
export class AdminOrdersService {
  list(_query: ListAdminOrdersQueryDto): Promise<AdminOrderListDto> {
    return notImplemented('adminListOrders');
  }
  exportCsv(_query: ExportOrdersQueryDto): Promise<string> {
    return notImplemented('adminExportOrders');
  }
  get(_id: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminGetOrder');
  }
  updateStatus(_id: string, _input: UpdateOrderStatusDto, _actorId?: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminUpdateOrderStatus');
  }
  ship(_id: string, _input: ShipOrderDto, _actorId?: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminShipOrder');
  }
  cancel(_id: string, _input: AdminCancelOrderDto, _actorId?: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminCancelOrder');
  }
  refund(_id: string, _input: RefundOrderDto, _actorId?: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminRefundOrder');
  }
  markPaid(_id: string, _input: MarkOrderPaidDto, _actorId?: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminMarkOrderPaid');
  }
  addNote(_id: string, _input: AddOrderNoteDto, _actorId?: string): Promise<AdminOrderDetailDto> {
    return notImplemented('adminAddOrderNote');
  }
}
