import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  AdminShipmentDto,
  CreateShiprocketShipmentDto,
  OrderTrackingDto,
  WebhookAckDto,
} from './dto/shipment.dto';

/** Shiprocket integration + public tracking (OPS-3). */
@Injectable()
export class ShippingService {
  getTracking(_number: string, _email: string): Promise<OrderTrackingDto> {
    return notImplemented('getOrderTracking');
  }
  /** Verifies the `x-api-key` token, then updates Shipment + OrderEvent idempotently. */
  handleWebhook(_token: string | undefined, _payload: unknown): Promise<WebhookAckDto> {
    return notImplemented('handleShiprocketWebhook');
  }
  createShiprocketShipment(
    _orderId: string,
    _input: CreateShiprocketShipmentDto,
    _actorId?: string,
  ): Promise<AdminShipmentDto> {
    return notImplemented('adminCreateShiprocketShipment');
  }
}
