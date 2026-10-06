import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { IDEMPOTENCY_KEY_HEADER } from '../common/dto/common';
import { CheckoutService } from './checkout.service';
import {
  CheckoutQuoteDto,
  CheckoutQuoteRequestDto,
  PaymentVerificationDto,
  PlacedOrderDto,
  PlaceOrderDto,
  VerifyPaymentDto,
} from './dto/checkout.dto';

/** Guest or signed-in checkout of the current cart. */
@ApiTags('checkout')
@Public()
@Controller('checkout')
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}

  @Post('quote')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'getCheckoutQuote',
    summary: 'Final totals incl. tax split for an address. No side effects.',
  })
  @ZodResponse({ status: 200, type: CheckoutQuoteDto, description: 'Totals' })
  @ApiErrors(400, [422, 'CART_EMPTY | CART_HAS_ISSUES (details: lines) | GSTIN_STATE_MISMATCH'])
  quote(@CurrentUser() user: SessionUser | undefined, @Body() body: CheckoutQuoteRequestDto) {
    return this.checkout.quote({ userId: user?.id }, body);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'placeOrder',
    summary:
      'Create the order from the cart: reserve stock, create a Razorpay order (or bank-transfer instructions)',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description:
      'Unique per checkout attempt (e.g. UUID v4, 8-128 chars [A-Za-z0-9_-]). Retries with the same key return the original result.',
  })
  @ZodResponse({
    status: 201,
    type: PlacedOrderDto,
    description: 'Order created, awaiting payment',
  })
  @ApiErrors(
    [400, 'VALIDATION_ERROR | IDEMPOTENCY_KEY_REQUIRED'],
    [403, 'PAYMENT_METHOD_NOT_ALLOWED: BANK_TRANSFER needs an approved B2B account'],
    [409, 'OUT_OF_STOCK (details: variantIds) | PRICE_CHANGED | IDEMPOTENCY_KEY_REUSED'],
    [422, 'CART_EMPTY | CART_HAS_ISSUES | COUPON_* | GSTIN_STATE_MISMATCH'],
    429,
  )
  placeOrder(
    @CurrentUser() user: SessionUser | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PlaceOrderDto,
  ) {
    return this.checkout.placeOrder({ userId: user?.id }, idempotencyKey, body);
  }

  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'verifyPayment',
    summary: 'Verify the Razorpay Checkout signature and mark the order PAID (idempotent)',
  })
  @ZodResponse({ status: 200, type: PaymentVerificationDto, description: 'Verification result' })
  @ApiErrors([400, 'VALIDATION_ERROR | SIGNATURE_INVALID'], [404, 'NOT_FOUND: unknown order'], 429)
  verify(@Body() body: VerifyPaymentDto) {
    return this.checkout.verify(body);
  }
}
