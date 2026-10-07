import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { Coupon, Prisma } from '@prisma/client';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { CouponsService } from '../coupons/coupons.service';
import { decimalToNumber, effectivePrice, parseVariantOptions } from '../catalog/catalog.mappers';
import {
  type PricingLineInput,
  type PricingResult,
  TotalsService,
} from '../pricing/totals.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  availableUnits,
  isAvailable,
  isPurchasable,
  type LineFacts,
  lineIssue,
  mergedQuantity,
  pickLineImage,
} from './cart-lines';
import {
  type AddCartItemDto,
  type ApplyCouponDto,
  type CartDto,
  MAX_LINE_QUANTITY,
  type UpdateCartItemDto,
} from './dto/cart.dto';

/**
 * Who is asking: the signed-in user (from the session) and/or the raw `kritex_cart` cookie value.
 * When both are present the guest cart is merged into the user's cart (COM-2).
 */
export interface CartContext {
  user?: SessionUser;
  guestToken?: string;
}

/** @deprecated Stage 1 stub shape, kept for existing imports; use `CartContext`. */
export interface CartOwner {
  userId?: string;
  guestToken?: string;
}

/** What the controller must do with the `kritex_cart` cookie after the call. */
export type CartCookie = { action: 'set'; token: string } | { action: 'clear' } | null;

export interface CartResult {
  cart: CartDto;
  cookie: CartCookie;
}

/** Guest tokens are 32 random bytes, base64url (43 chars). Anything else is ignored. */
const GUEST_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const isGuestToken = (value: string | undefined): value is string =>
  value !== undefined && GUEST_TOKEN_PATTERN.test(value);

const cartInclude = {
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: {
      variant: {
        include: {
          product: {
            include: {
              category: { select: { isActive: true } },
              images: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
              priceTiers: { orderBy: { minQty: 'asc' } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;
type CartItemRow = CartWithItems['items'][number];
type VariantWithProduct = CartItemRow['variant'];

/** The resolved current cart (null = none yet) plus the cookie instruction. */
export interface CurrentCart {
  cart: CartWithItems | null;
  cookie: CartCookie;
}

/** A priced cart: the DTO plus the raw pricing, for checkout. */
export interface PricedCart {
  cart: CartWithItems | null;
  dto: CartDto;
  /** Inputs for the lines without an issue (what checkout would charge for). */
  lines: PricingLineInput[];
  pricing: PricingResult;
  coupon: Coupon | null;
  isB2BApproved: boolean;
}

function lineFacts(variant: VariantWithProduct): LineFacts {
  return {
    variantActive: variant.isActive,
    productStatus: variant.product.status,
    categoryActive: variant.product.category.isActive,
    saleChannel: variant.product.saleChannel,
    price: effectivePrice(variant.price, variant.product.basePrice),
    stock: variant.stock,
    reserved: variant.reserved,
  };
}

/**
 * Carts (COM-1, COM-2, COM-5). Signed-in users have one cart (`Cart.userId`); guests have a cart
 * keyed by a random opaque token in the httpOnly `kritex_cart` cookie (`Cart.guestToken`, userId
 * null). Prices, stock and line issues are computed live on every read; nothing price-related is
 * stored on the cart.
 */
@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totals: TotalsService,
    private readonly coupons: CouponsService,
  ) {}

  // ---------------------------------------------------------------- public API (controller)

  async getCart(ctx: CartContext): Promise<CartResult> {
    const { cart, cookie } = await this.resolveCurrentCart(ctx);
    return { cart: (await this.priceCart(cart, ctx.user)).dto, cookie };
  }

  async addItem(ctx: CartContext, input: AddCartItemDto): Promise<CartResult> {
    const variant = await this.findVariant(input.variantId);
    const isB2B = await this.isApprovedB2B(ctx.user);
    const current = await this.resolveCurrentCart(ctx);
    const existing = current.cart?.items.find((item) => item.variantId === input.variantId);
    const quantity = (existing?.quantity ?? 0) + input.quantity;
    this.assertCanBuy(variant, quantity, isB2B);

    const { cart, cookie } = await this.ensureCart(ctx, current);
    await this.prisma.cartItem.upsert({
      where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
      create: { cartId: cart.id, variantId: input.variantId, quantity },
      update: { quantity },
    });
    return this.respond(cart.id, ctx.user, cookie);
  }

  async updateItem(
    ctx: CartContext,
    variantId: string,
    input: UpdateCartItemDto,
  ): Promise<CartResult> {
    const { cart, cookie } = await this.resolveCurrentCart(ctx);
    const line = cart?.items.find((item) => item.variantId === variantId);
    if (!cart || !line) throw this.lineNotFound(variantId);

    if (input.quantity === 0) {
      await this.prisma.cartItem.delete({ where: { id: line.id } });
    } else {
      // Lowering a quantity is always allowed (it is how the customer fixes a stock issue).
      if (input.quantity > line.quantity) {
        this.assertCanBuy(line.variant, input.quantity, await this.isApprovedB2B(ctx.user));
      }
      await this.prisma.cartItem.update({
        where: { id: line.id },
        data: { quantity: input.quantity },
      });
    }
    return this.respond(cart.id, ctx.user, this.refreshCookie(cart, cookie));
  }

  async removeItem(ctx: CartContext, variantId: string): Promise<CartResult> {
    const { cart, cookie } = await this.resolveCurrentCart(ctx);
    const line = cart?.items.find((item) => item.variantId === variantId);
    if (!cart || !line) throw this.lineNotFound(variantId);
    await this.prisma.cartItem.delete({ where: { id: line.id } });
    return this.respond(cart.id, ctx.user, this.refreshCookie(cart, cookie));
  }

  /** 422 COUPON_* when the code is unknown or does not apply to this cart right now. */
  async applyCoupon(ctx: CartContext, input: ApplyCouponDto): Promise<CartResult> {
    const coupon = await this.coupons.findByCode(input.code);
    if (!coupon) {
      throw new AppException(
        'COUPON_NOT_FOUND',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'This coupon code is not valid',
      );
    }
    const current = await this.resolveCurrentCart(ctx);
    const priced = await this.priceCart(current.cart, ctx.user, coupon);
    const result = priced.pricing.coupon;
    if (result && !result.valid) {
      throw new AppException(
        result.reason,
        HttpStatus.UNPROCESSABLE_ENTITY,
        result.message,
        result.details,
      );
    }
    const { cart, cookie } = await this.ensureCart(ctx, current);
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: coupon.code } });
    return this.respond(cart.id, ctx.user, cookie);
  }

  async removeCoupon(ctx: CartContext): Promise<CartResult> {
    const { cart, cookie } = await this.resolveCurrentCart(ctx);
    if (!cart) return { cart: (await this.priceCart(null, ctx.user)).dto, cookie };
    await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
    return this.respond(cart.id, ctx.user, this.refreshCookie(cart, cookie));
  }

  // ---------------------------------------------------------------- reusable (checkout)

  /**
   * Resolves "the current cart" for a request: the user's cart when signed in (after merging any
   * guest cart named by the cookie into it), else the guest cart for the cookie. Never creates a
   * cart. `cookie` says whether the caller must clear the guest cookie.
   */
  async resolveCurrentCart(ctx: CartContext): Promise<CurrentCart> {
    const token = isGuestToken(ctx.guestToken) ? ctx.guestToken : undefined;
    const badCookie = ctx.guestToken !== undefined && !token;

    if (ctx.user) {
      let cookie: CartCookie = null;
      if (ctx.guestToken !== undefined) {
        if (token) await this.mergeGuestCart(ctx.user, token);
        cookie = { action: 'clear' };
      }
      const cart = await this.prisma.cart.findUnique({
        where: { userId: ctx.user.id },
        include: cartInclude,
      });
      return { cart, cookie };
    }

    if (!token) return { cart: null, cookie: badCookie ? { action: 'clear' } : null };
    const cart = await this.prisma.cart.findFirst({
      where: { guestToken: token, userId: null },
      include: cartInclude,
    });
    return { cart, cookie: cart ? null : { action: 'clear' } };
  }

  /** Live prices, issues and totals for a cart (`couponOverride` previews another coupon). */
  async priceCart(
    cart: CartWithItems | null,
    user: SessionUser | undefined,
    couponOverride?: Coupon,
  ): Promise<PricedCart> {
    const isB2BApproved = await this.isApprovedB2B(user);

    let coupon: Coupon | null = couponOverride ?? null;
    if (!couponOverride && cart?.couponCode) {
      coupon = await this.coupons.findByCode(cart.couponCode);
      if (!coupon) {
        // Deleted by an admin since it was applied: drop it from the cart.
        await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
      }
    }
    const customerUsageCount =
      coupon && user ? await this.coupons.customerUsageCount(user.id, coupon.code) : null;

    const items = cart?.items ?? [];
    const evaluated = items.map((item) => {
      const facts = lineFacts(item.variant);
      return { item, facts, issue: lineIssue(facts, item.quantity, isB2BApproved) };
    });
    const lines: PricingLineInput[] = evaluated
      .filter((e) => e.issue === null)
      .map(({ item, facts }) => ({
        variantId: item.variantId,
        productId: item.variant.productId,
        quantity: item.quantity,
        unitPrice: facts.price as number,
        hsnCode: item.variant.product.hsnCode,
        gstRate: decimalToNumber(item.variant.product.gstRate),
        priceTiers: item.variant.product.priceTiers.map(({ minQty, unitPrice }) => ({
          minQty,
          unitPrice,
        })),
      }));
    const pricing = this.totals.compute(
      lines,
      null,
      coupon ? { coupon, customerUsageCount } : null,
      user ? { id: user.id, isB2BApproved } : null,
    );
    const priced = new Map(pricing.lines.map((line) => [line.variantId, line]));

    const dtoItems = evaluated.map(({ item, facts, issue }) => {
      const { variant } = item;
      const { product } = variant;
      const options = parseVariantOptions(variant.options);
      const image = pickLineImage(product.images, options);
      const line = priced.get(item.variantId);
      // ENQUIRY_ONLY prices are never shown (ADR-011).
      const listPrice = product.saleChannel === 'ENQUIRY_ONLY' ? 0 : (facts.price ?? 0);
      const unitPrice = line?.unitPrice ?? listPrice;
      return {
        variantId: variant.id,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        variantTitle: variant.title,
        sku: variant.sku,
        options,
        image: image ? { url: image.url, alt: image.alt } : null,
        saleChannel: product.saleChannel,
        unitPrice,
        quantity: item.quantity,
        lineTotal: line?.lineTotal ?? unitPrice * item.quantity,
        inStock: availableUnits(facts) > 0,
        issue,
      };
    });

    const couponResult = pricing.coupon;
    const dto: CartDto = {
      id: cart?.id ?? '',
      items: dtoItems,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
      coupon:
        coupon && couponResult
          ? {
              code: coupon.code,
              type: coupon.type,
              valid: couponResult.valid,
              invalidReason: couponResult.valid ? null : couponResult.reason,
              message: couponResult.valid ? null : couponResult.message,
            }
          : null,
      totals: pricing.totals,
      hasIssues: dtoItems.some((item) => item.issue !== null),
      updatedAt: (cart?.updatedAt ?? new Date()).toISOString(),
    };
    return { cart, dto, lines, pricing, coupon, isB2BApproved };
  }

  /** ADR-004: the B2B_CUSTOMER role backed by an APPROVED business profile. */
  async isApprovedB2B(user: SessionUser | undefined): Promise<boolean> {
    if (!user || user.role !== 'B2B_CUSTOMER') return false;
    const profile = await this.prisma.businessProfile.findUnique({
      where: { userId: user.id },
      select: { status: true },
    });
    return profile?.status === 'APPROVED';
  }

  /** Deletes guest carts untouched for `olderThan` (CartCleanupService). */
  async deleteStaleGuestCarts(olderThan: Date): Promise<number> {
    const { count } = await this.prisma.cart.deleteMany({
      where: { userId: null, updatedAt: { lt: olderThan } },
    });
    return count;
  }

  // ---------------------------------------------------------------- internals

  /**
   * COM-2: moves the guest cart's lines into the user's cart (quantities summed, capped at 999
   * and the available stock, never below either cart's own quantity), keeps the user's coupon or
   * adopts the guest's if it is valid for the user, then deletes the guest cart. Safe under
   * concurrent requests: only the request that deletes the guest cart merges it.
   */
  private async mergeGuestCart(user: SessionUser, token: string): Promise<void> {
    const adoptedCoupon = await this.prisma.$transaction(async (tx) => {
      const guest = await tx.cart.findFirst({
        where: { guestToken: token, userId: null },
        include: { items: { include: { variant: { select: { stock: true, reserved: true } } } } },
      });
      if (!guest) return null;
      const { count } = await tx.cart.deleteMany({ where: { id: guest.id, userId: null } });
      if (count === 0) return null; // another request merged it

      const userCart = await tx.cart.upsert({
        where: { userId: user.id },
        create: { userId: user.id },
        update: {},
        include: { items: true },
      });
      for (const item of guest.items) {
        const existing = userCart.items.find((own) => own.variantId === item.variantId);
        const quantity = mergedQuantity(
          existing?.quantity ?? 0,
          item.quantity,
          availableUnits(item.variant),
        );
        await tx.cartItem.upsert({
          where: { cartId_variantId: { cartId: userCart.id, variantId: item.variantId } },
          create: { cartId: userCart.id, variantId: item.variantId, quantity },
          update: { quantity },
        });
      }
      const adopt = !userCart.couponCode && guest.couponCode ? guest.couponCode : null;
      await tx.cart.update({
        where: { id: userCart.id },
        data: { updatedAt: new Date(), ...(adopt && { couponCode: adopt }) },
      });
      return adopt;
    });

    if (adoptedCoupon) {
      const cart = await this.prisma.cart.findUnique({
        where: { userId: user.id },
        include: cartInclude,
      });
      const priced = await this.priceCart(cart, user);
      if (cart && !priced.dto.coupon?.valid) {
        await this.prisma.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
      }
    }
  }

  /** The current cart, creating it if needed (a new guest cart gets a fresh server-made token). */
  private async ensureCart(
    ctx: CartContext,
    current: CurrentCart,
  ): Promise<{ cart: { id: string; guestToken: string | null }; cookie: CartCookie }> {
    if (current.cart)
      return { cart: current.cart, cookie: this.refreshCookie(current.cart, current.cookie) };
    if (ctx.user) {
      const cart = await this.prisma.cart.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id },
        update: {},
      });
      return { cart, cookie: current.cookie };
    }
    // Never adopt a client-supplied token (session fixation): always mint a new one.
    const token = randomBytes(32).toString('base64url');
    const cart = await this.prisma.cart.create({ data: { guestToken: token } });
    return { cart, cookie: { action: 'set', token } };
  }

  /** Guest carts get their cookie re-sent on every write (sliding expiry). */
  private refreshCookie(
    cart: { guestToken: string | null; userId?: string | null },
    cookie: CartCookie,
  ): CartCookie {
    if (cookie) return cookie;
    return cart.guestToken && !cart.userId ? { action: 'set', token: cart.guestToken } : null;
  }

  private async respond(
    cartId: string,
    user: SessionUser | undefined,
    cookie: CartCookie,
  ): Promise<CartResult> {
    const cart = await this.prisma.cart.update({
      where: { id: cartId },
      data: { updatedAt: new Date() },
      include: cartInclude,
    });
    return { cart: (await this.priceCart(cart, user)).dto, cookie };
  }

  private async findVariant(variantId: string): Promise<VariantWithProduct> {
    const variant = await this.prisma.variant.findUnique({
      where: { id: variantId },
      include: cartInclude.items.include.variant.include,
    });
    if (!variant || !isAvailable(lineFacts(variant))) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Variant not found', {
        variantId,
      });
    }
    return variant;
  }

  /** Rules for adding / raising a quantity: purchasable, <= 999, <= available stock. */
  private assertCanBuy(variant: VariantWithProduct, quantity: number, isB2B: boolean): void {
    const facts = lineFacts(variant);
    if (!isAvailable(facts)) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Variant not found', {
        variantId: variant.id,
      });
    }
    if (!isPurchasable(facts, isB2B)) {
      throw new AppException(
        'NOT_PURCHASABLE',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'This product cannot be bought online',
        { variantId: variant.id, saleChannel: facts.saleChannel },
      );
    }
    if (quantity > MAX_LINE_QUANTITY) {
      throw new AppException(
        'QUANTITY_LIMIT_EXCEEDED',
        HttpStatus.UNPROCESSABLE_ENTITY,
        `At most ${MAX_LINE_QUANTITY} units per line`,
        { variantId: variant.id, max: MAX_LINE_QUANTITY },
      );
    }
    const available = availableUnits(facts);
    if (quantity > available) {
      throw new AppException(
        'INSUFFICIENT_STOCK',
        HttpStatus.CONFLICT,
        available === 0 ? 'This item is out of stock' : `Only ${available} left in stock`,
        { variantId: variant.id, available, requested: quantity },
      );
    }
  }

  private lineNotFound(variantId: string): AppException {
    return new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Item is not in your cart', {
      variantId,
    });
  }
}
