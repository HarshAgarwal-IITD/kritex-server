import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { CartService, type CartOwner } from './cart.service';
import {
  AddCartItemDto,
  ApplyCouponDto,
  CartDto,
  CartVariantParamDto,
  UpdateCartItemDto,
} from './dto/cart.dto';

/** Guest (cookie `kritex_cart`) or signed-in user's cart. Every mutation returns the full cart. */
@ApiTags('cart')
@Public()
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  // Stage 3 (COM-1) resolves the guest token from the cookie; Stage 1 only passes the user.
  private owner(user: SessionUser | undefined): CartOwner {
    return { userId: user?.id };
  }

  @Get()
  @ApiOperation({
    operationId: 'getCart',
    summary: 'Cart with live prices/stock and a totals preview (empty cart if none yet)',
  })
  @ZodResponse({ status: 200, type: CartDto, description: 'Cart' })
  getCart(@CurrentUser() user: SessionUser | undefined) {
    return this.cart.getCart(this.owner(user));
  }

  @Post('items')
  @ApiOperation({
    operationId: 'addCartItem',
    summary: 'Add a variant (adds to the existing quantity)',
  })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(
    400,
    [404, 'NOT_FOUND: variant'],
    [409, 'INSUFFICIENT_STOCK'],
    [422, 'NOT_PURCHASABLE: sale channel'],
  )
  addItem(@CurrentUser() user: SessionUser | undefined, @Body() body: AddCartItemDto) {
    return this.cart.addItem(this.owner(user), body);
  }

  @Patch('items/:variantId')
  @ApiOperation({ operationId: 'updateCartItem', summary: 'Set a line quantity (0 removes it)' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(400, [404, 'NOT_FOUND: line'], [409, 'INSUFFICIENT_STOCK'])
  updateItem(
    @CurrentUser() user: SessionUser | undefined,
    @Param() params: CartVariantParamDto,
    @Body() body: UpdateCartItemDto,
  ) {
    return this.cart.updateItem(this.owner(user), params.variantId, body);
  }

  @Delete('items/:variantId')
  @ApiOperation({ operationId: 'removeCartItem', summary: 'Remove a line' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(404)
  removeItem(@CurrentUser() user: SessionUser | undefined, @Param() params: CartVariantParamDto) {
    return this.cart.removeItem(this.owner(user), params.variantId);
  }

  @Post('coupon')
  @ApiOperation({ operationId: 'applyCartCoupon', summary: 'Apply a coupon code' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(
    400,
    [
      422,
      'COUPON_INVALID | COUPON_EXPIRED | COUPON_USAGE_LIMIT | COUPON_MIN_SUBTOTAL (details.minSubtotal)',
    ],
    429,
  )
  applyCoupon(@CurrentUser() user: SessionUser | undefined, @Body() body: ApplyCouponDto) {
    return this.cart.applyCoupon(this.owner(user), body);
  }

  @Delete('coupon')
  @ApiOperation({ operationId: 'removeCartCoupon', summary: 'Remove the applied coupon' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  removeCoupon(@CurrentUser() user: SessionUser | undefined) {
    return this.cart.removeCoupon(this.owner(user));
  }
}
