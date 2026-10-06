import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type { WebhookAckDto } from '../shipping/dto/shipment.dto';

/** Razorpay webhooks (COM-10): source of truth for payment.captured/failed and refund.processed. */
@Injectable()
export class PaymentsService {
  /**
   * Verifies `x-razorpay-signature` (HMAC-SHA256 of the raw body with the webhook secret), then
   * applies the event idempotently (unique providerPaymentId / x-razorpay-event-id).
   */
  handleRazorpayWebhook(
    _rawBody: Buffer | undefined,
    _signature: string | undefined,
    _eventId: string | undefined,
  ): Promise<WebhookAckDto> {
    return notImplemented('handleRazorpayWebhook');
  }
}
