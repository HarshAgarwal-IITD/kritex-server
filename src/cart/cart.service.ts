import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type { AddCartItemDto, ApplyCouponDto, CartDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Identifies the cart: the signed-in user's cart, else the guest cart from the `kritex_cart`
 * cookie (created on first write). Guest carts merge into the user cart on sign-in (COM-2).
 */
export interface CartOwner {
  userId?: string;
  guestToken?: string;
}

@Injectable()
export class CartService {
  getCart(_owner: CartOwner): Promise<CartDto> {
    return notImplemented('getCart');
  }
  addItem(_owner: CartOwner, _input: AddCartItemDto): Promise<CartDto> {
    return notImplemented('addCartItem');
  }
  updateItem(_owner: CartOwner, _variantId: string, _input: UpdateCartItemDto): Promise<CartDto> {
    return notImplemented('updateCartItem');
  }
  removeItem(_owner: CartOwner, _variantId: string): Promise<CartDto> {
    return notImplemented('removeCartItem');
  }
  applyCoupon(_owner: CartOwner, _input: ApplyCouponDto): Promise<CartDto> {
    return notImplemented('applyCartCoupon');
  }
  removeCoupon(_owner: CartOwner): Promise<CartDto> {
    return notImplemented('removeCartCoupon');
  }
}
