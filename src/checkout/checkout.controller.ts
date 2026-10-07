import { Body, Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { IDEMPOTENCY_KEY_HEADER } from '../common/dto/common';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { type CheckoutCustomer, CheckoutService } from './checkout.service';
import { GUEST_CART_COOKIE_NAME, readCookie } from './checkout.types';
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

  /** Signed-in user's cart, else the guest cart from the `kritex_cart` cookie. */
  private customer(user: SessionUser | undefined, req: Request): CheckoutCustomer {
    if (user) return { userId: user.id, role: user.role, email: user.email };
    return { guestToken: readCookie(req.headers.cookie, GUEST_CART_COOKIE_NAME) };
  }

  @Post('quote')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'getCheckoutQuote',
    summary: 'Final totals incl. tax split for an address. No side effects.',
  })
  @ZodResponse({ status: 200, type: CheckoutQuoteDto, description: 'Totals' })
  @ApiErrors(400, [
    422,
    'CART_EMPTY | CART_HAS_ISSUES (details: lines) | COUPON_* | INVALID_GSTIN | GSTIN_STATE_MISMATCH',
  ])
  quote(
    @CurrentUser() user: SessionUser | undefined,
    @Req() req: Request,
    @Body() body: CheckoutQuoteRequestDto,
  ) {
    return this.checkout.quote(this.customer(user, req), body);
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
    [
      422,
      'CART_EMPTY | CART_HAS_ISSUES (details: lines) | COUPON_* | INVALID_GSTIN | GSTIN_STATE_MISMATCH',
    ],
    429,
  )
  @ApiResponse({
    status: 502,
    type: ErrorResponseDto,
    description: 'PAYMENT_GATEWAY_ERROR (retry with the same key)',
  })
  placeOrder(
    @CurrentUser() user: SessionUser | undefined,
    @Req() req: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: PlaceOrderDto,
  ) {
    return this.checkout.placeOrder(this.customer(user, req), idempotencyKey, body);
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
  @ApiResponse({
    status: 502,
    type: ErrorResponseDto,
    description: 'PAYMENT_GATEWAY_ERROR (retry)',
  })
  verify(@Body() body: VerifyPaymentDto) {
    return this.checkout.verify(body);
  }
}
