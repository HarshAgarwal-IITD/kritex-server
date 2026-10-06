import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type { CartOwner } from '../cart/cart.service';
import type {
  CheckoutQuoteDto,
  CheckoutQuoteRequestDto,
  PaymentVerificationDto,
  PlacedOrderDto,
  PlaceOrderDto,
  VerifyPaymentDto,
} from './dto/checkout.dto';

/** Checkout (COM-7..9): quote, place order (one transaction + Razorpay order), verify. */
@Injectable()
export class CheckoutService {
  quote(_owner: CartOwner, _input: CheckoutQuoteRequestDto): Promise<CheckoutQuoteDto> {
    return notImplemented('getCheckoutQuote');
  }
  /** Same Idempotency-Key + same body → the original result; different body → 409. */
  placeOrder(
    _owner: CartOwner,
    _idempotencyKey: string | undefined,
    _input: PlaceOrderDto,
  ): Promise<PlacedOrderDto> {
    return notImplemented('placeOrder');
  }
  verify(_input: VerifyPaymentDto): Promise<PaymentVerificationDto> {
    return notImplemented('verifyPayment');
  }
}
