import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  CancelOrderDto,
  ListMyOrdersQueryDto,
  OrderDetailDto,
  OrderListDto,
  RequestReturnDto,
} from './dto/order.dto';

/** Customer order endpoints (COM-13). Orders not owned by the user are 404 (no IDOR). */
@Injectable()
export class OrdersService {
  listMyOrders(_userId: string, _query: ListMyOrdersQueryDto): Promise<OrderListDto> {
    return notImplemented('listMyOrders');
  }
  getMyOrder(_userId: string, _number: string): Promise<OrderDetailDto> {
    return notImplemented('getMyOrder');
  }
  cancelMyOrder(_userId: string, _number: string, _input: CancelOrderDto): Promise<OrderDetailDto> {
    return notImplemented('cancelMyOrder');
  }
  requestReturn(
    _userId: string,
    _number: string,
    _input: RequestReturnDto,
  ): Promise<OrderDetailDto> {
    return notImplemented('requestOrderReturn');
  }
}
