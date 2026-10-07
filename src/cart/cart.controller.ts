import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { AppConfigService } from '../config/app-config.service';
import { type CartContext, type CartResult, CartService } from './cart.service';
import {
  AddCartItemDto,
  ApplyCouponDto,
  CartDto,
  CartVariantParamDto,
  GUEST_CART_COOKIE,
  UpdateCartItemDto,
} from './dto/cart.dto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Value of one cookie from the raw `Cookie` header (no cookie-parser in this app). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      const raw = part.slice(eq + 1).trim();
      try {
        return decodeURIComponent(raw);
      } catch {
        return raw;
      }
    }
  }
  return undefined;
}

/**
 * Guest (cookie `kritex_cart`) or signed-in user's cart. Every mutation returns the full cart.
 * Browsers must send credentials (`credentials: "include"`) so the cookies travel.
 */
@ApiTags('cart')
@Public()
@Controller('cart')
export class CartController {
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly cart: CartService,
    private readonly config: AppConfigService,
  ) {
    this.allowedOrigins = new Set([...config.get('CORS_ORIGIN'), config.get('WEB_URL')]);
  }

  @Get()
  @ApiOperation({
    operationId: 'getCart',
    summary: 'Cart with live prices/stock and a totals preview (empty cart if none yet)',
    description:
      'Without a cart yet, returns an empty cart with `id: ""`. When signed in with a guest `kritex_cart` cookie, ' +
      'the guest cart is first merged into the account cart and the cookie is cleared.',
  })
  @ZodResponse({ status: 200, type: CartDto, description: 'Cart' })
  async getCart(
    @CurrentUser() user: SessionUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.cart.getCart(this.context(req, user)));
  }

  @Post('items')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    operationId: 'addCartItem',
    summary: 'Add a variant (adds to the existing quantity)',
  })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(
    400,
    [403, 'INVALID_ORIGIN'],
    [404, 'NOT_FOUND: variant (unknown, inactive or not on sale)'],
    [409, 'INSUFFICIENT_STOCK (details.available)'],
    [
      422,
      'NOT_PURCHASABLE: sale channel / unpriced · QUANTITY_LIMIT_EXCEEDED: line would exceed 999',
    ],
  )
  async addItem(
    @CurrentUser() user: SessionUser | undefined,
    @Body() body: AddCartItemDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.cart.addItem(this.context(req, user), body));
  }

  @Patch('items/:variantId')
  @ApiOperation({
    operationId: 'updateCartItem',
    summary: 'Set a line quantity (0 removes it)',
    description: 'Lowering a quantity always works; raising it is checked like an add.',
  })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(
    400,
    [403, 'INVALID_ORIGIN'],
    [404, 'NOT_FOUND: line'],
    [409, 'INSUFFICIENT_STOCK (details.available)'],
    [422, 'NOT_PURCHASABLE'],
  )
  async updateItem(
    @CurrentUser() user: SessionUser | undefined,
    @Param() params: CartVariantParamDto,
    @Body() body: UpdateCartItemDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(
      res,
      await this.cart.updateItem(this.context(req, user), params.variantId, body),
    );
  }

  @Delete('items/:variantId')
  @ApiOperation({ operationId: 'removeCartItem', summary: 'Remove a line' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors([403, 'INVALID_ORIGIN'], 404)
  async removeItem(
    @CurrentUser() user: SessionUser | undefined,
    @Param() params: CartVariantParamDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.cart.removeItem(this.context(req, user), params.variantId));
  }

  @Post('coupon')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ operationId: 'applyCartCoupon', summary: 'Apply a coupon code' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors(
    400,
    [403, 'INVALID_ORIGIN'],
    [
      422,
      'COUPON_NOT_FOUND | COUPON_INACTIVE | COUPON_NOT_STARTED | COUPON_EXPIRED | COUPON_USAGE_LIMIT_REACHED | ' +
        'COUPON_LOGIN_REQUIRED | COUPON_PER_CUSTOMER_LIMIT_REACHED | COUPON_MIN_SUBTOTAL_NOT_MET (details.minSubtotal, details.shortBy)',
    ],
    429,
  )
  async applyCoupon(
    @CurrentUser() user: SessionUser | undefined,
    @Body() body: ApplyCouponDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.cart.applyCoupon(this.context(req, user), body));
  }

  @Delete('coupon')
  @ApiOperation({ operationId: 'removeCartCoupon', summary: 'Remove the applied coupon' })
  @ZodResponse({ status: 200, type: CartDto, description: 'Updated cart' })
  @ApiErrors([403, 'INVALID_ORIGIN'])
  async removeCoupon(
    @CurrentUser() user: SessionUser | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.send(res, await this.cart.removeCoupon(this.context(req, user)));
  }

  /**
   * Builds the cart context. CSRF: SameSite=Lax already keeps the guest cookie off cross-site
   * POSTs; additionally a guest-cookie write from a browser origin outside the allowlist is
   * refused (the AuthGuard does the same for session cookies).
   */
  private context(req: Request, user: SessionUser | undefined): CartContext {
    const guestToken = readCookie(req.headers.cookie, GUEST_CART_COOKIE);
    const origin = req.headers.origin;
    if (
      guestToken !== undefined &&
      !SAFE_METHODS.has(req.method) &&
      origin &&
      !this.allowedOrigins.has(origin)
    ) {
      throw new AppException('INVALID_ORIGIN', HttpStatus.FORBIDDEN, 'Origin not allowed');
    }
    return { user, guestToken };
  }

  private send(res: Response, result: CartResult): CartDto {
    const options = {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure: this.config.isProduction,
      path: '/',
      ...(this.config.get('AUTH_COOKIE_DOMAIN') && {
        domain: this.config.get('AUTH_COOKIE_DOMAIN'),
      }),
    };
    if (result.cookie?.action === 'set') {
      res.cookie(GUEST_CART_COOKIE, result.cookie.token, {
        ...options,
        maxAge: this.config.get('CART_GUEST_TTL_DAYS') * 24 * 60 * 60 * 1000,
      });
    } else if (result.cookie?.action === 'clear') {
      res.clearCookie(GUEST_CART_COOKIE, options);
    }
    return result.cart;
  }
}
