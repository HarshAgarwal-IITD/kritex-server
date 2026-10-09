import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AddressInput } from '../common/dto/address';
import { idempotencyKeySchema } from '../common/dto/common';
import type { CheckoutPaymentMethod, Role } from '../common/dto/enums';
import { AppException } from '../common/exceptions/app.exception';
import { AppConfigService } from '../config/app-config.service';
import { MAX_ADDRESSES } from '../customers/customers.service';
import { EVENT } from '../orders/order-events';
import { ORDER_TX, OrderLifecycleService } from '../orders/order-lifecycle.service';
import { OrderPaymentsService } from '../orders/order-payments.service';
import { pickImage } from '../orders/orders.mappers';
import {
  PAYMENT_GATEWAY,
  type GatewayPayment,
  type PaymentGateway,
  PaymentGatewayError,
} from '../payments/gateway/payment-gateway';
import { type PricingCoupon, type PricingResult, TotalsService, validateGstin } from '../pricing';
import { PrismaService } from '../prisma/prisma.service';
import {
  cartEmpty,
  type CheckoutCart,
  type CheckoutOwner,
  findCheckoutCart,
  lineIssue,
  toPricingLine,
} from './checkout-cart';
import type {
  CheckoutQuoteDto,
  CheckoutQuoteRequestDto,
  PaymentVerificationDto,
  PlacedOrder,
  PlaceOrderDto,
  VerifyPaymentDto,
} from './dto/checkout.dto';

type Db = Prisma.TransactionClient;

export interface CheckoutCustomer extends CheckoutOwner {
  /** Session user's role (B2B tiers / bank transfer need B2B_CUSTOMER + APPROVED profile). */
  role?: Role;
  /** Session user's email (the order contact for signed-in users). */
  email?: string;
}

const isUniqueViolation = (err: unknown, field: string) =>
  err instanceof Prisma.PrismaClientKnownRequestError &&
  err.code === 'P2002' &&
  JSON.stringify(err.meta?.target ?? '').includes(field);

/**
 * Checkout (COM-7..9). Totals always come from `TotalsService.compute` over the live catalog;
 * the client never sends prices.
 */
@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totals: TotalsService,
    private readonly config: AppConfigService,
    private readonly lifecycle: OrderLifecycleService,
    private readonly orderPayments: OrderPaymentsService,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  // ------------------------------------------------------------------ quote

  async quote(
    customer: CheckoutCustomer,
    input: CheckoutQuoteRequestDto,
  ): Promise<CheckoutQuoteDto> {
    const billing = input.billingAddress ?? input.shippingAddress;
    if (input.gstin) this.assertGstin(input.gstin, billing.stateCode);
    const isB2B = await this.isApprovedB2B(customer);
    const cart = await findCheckoutCart(this.prisma, customer);
    if (!cart || cart.items.length === 0) throw cartEmpty();

    const issues = cart.items
      .map((item) => ({
        variantId: item.variantId,
        issue: lineIssue(item, isB2B, item.variant.stock - item.variant.reserved),
      }))
      .filter((l) => l.issue !== null);
    if (issues.length) throw this.cartHasIssues(issues);

    // Guests have no identity yet: per-customer coupon limits are enforced at POST /checkout (by email).
    const usage = customer.userId
      ? await this.couponUsage(this.prisma, cart.couponCode, customer)
      : 0;
    const coupon = await this.loadCoupon(this.prisma, cart.couponCode, usage, false);
    const priced = this.price(cart, input.shippingAddress.stateCode, coupon, customer, isB2B);

    return {
      items: cart.items.map((item, i) => this.toCheckoutLine(item, priced.lines[i])),
      couponCode: priced.coupon?.valid ? priced.coupon.code : null,
      totals: priced.totals,
      interState: priced.interState,
      paymentMethods: this.paymentMethods(isB2B),
    };
  }

  // ------------------------------------------------------------------ place order

  async placeOrder(
    customer: CheckoutCustomer,
    idempotencyKey: string | undefined,
    input: PlaceOrderDto,
  ): Promise<PlacedOrder> {
    if (!idempotencyKey) {
      throw new AppException(
        'IDEMPOTENCY_KEY_REQUIRED',
        HttpStatus.BAD_REQUEST,
        'The Idempotency-Key header is required',
      );
    }
    if (!idempotencyKeySchema.safeParse(idempotencyKey).success) {
      throw new AppException(
        'VALIDATION_ERROR',
        HttpStatus.BAD_REQUEST,
        'Idempotency-Key must be 8-128 characters [A-Za-z0-9_-]',
        [{ path: 'Idempotency-Key', message: 'Invalid format' }],
      );
    }
    const owner = customer.userId
      ? `user:${customer.userId}`
      : `guest:${customer.guestToken ?? ''}`;
    const hash = createHash('sha256').update(JSON.stringify({ owner, input })).digest('hex');

    const replay = await this.replay(idempotencyKey, hash);
    if (replay) return replay;

    const billing = input.billingAddress ?? input.shippingAddress;
    const gstin = input.gstin ? this.assertGstin(input.gstin, billing.stateCode) : null;
    const isB2B = await this.isApprovedB2B(customer);
    if (!this.paymentMethods(isB2B).includes(input.paymentMethod)) {
      throw new AppException(
        'PAYMENT_METHOD_NOT_ALLOWED',
        HttpStatus.FORBIDDEN,
        'Bank transfer is available to approved business accounts only',
      );
    }
    const email = (customer.userId && customer.email ? customer.email : input.email).toLowerCase();

    let orderId: string;
    try {
      orderId = await this.prisma.$transaction(
        (tx) =>
          this.createOrder(tx, {
            customer,
            input,
            billing,
            gstin,
            isB2B,
            email,
            idempotencyKey,
            hash,
          }),
        ORDER_TX,
      );
    } catch (err) {
      // A concurrent request with the same key won the race: answer like a retry.
      if (isUniqueViolation(err, 'idempotencyKey')) {
        const again = await this.replay(idempotencyKey, hash);
        if (again) return again;
      }
      throw err;
    }

    const payment =
      input.paymentMethod === 'RAZORPAY'
        ? await this.orderPayments.ensureGatewayOrder(orderId)
        : null;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return this.orderPayments.placedOrder(order, payment);
  }

  /** Same key + same body → the original order (gateway order created if still missing). */
  private async replay(idempotencyKey: string, hash: string): Promise<PlacedOrder | null> {
    const existing = await this.prisma.order.findUnique({ where: { idempotencyKey } });
    if (!existing) return null;
    if (existing.idempotencyHash !== hash) {
      throw new AppException(
        'IDEMPOTENCY_KEY_REUSED',
        HttpStatus.CONFLICT,
        'This Idempotency-Key was already used for a different checkout',
      );
    }
    const payment =
      existing.paymentMethod === 'RAZORPAY'
        ? await this.orderPayments.ensureGatewayOrder(existing.id)
        : null;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: existing.id } });
    return this.orderPayments.placedOrder(order, payment);
  }

  /**
   * One transaction: lock the variants (`FOR UPDATE`, id order), re-check stock, lock + validate
   * the coupon, compute totals, reserve stock, create the order with line snapshots, count the
   * coupon use, optionally save the address.
   */
  private async createOrder(
    tx: Db,
    ctx: {
      customer: CheckoutCustomer;
      input: PlaceOrderDto;
      billing: AddressInput;
      gstin: string | null;
      isB2B: boolean;
      email: string;
      idempotencyKey: string;
      hash: string;
    },
  ): Promise<string> {
    const { customer, input } = ctx;
    const cart = await findCheckoutCart(tx, customer);
    if (!cart || cart.items.length === 0) throw cartEmpty();

    const variantIds = [...new Set(cart.items.map((i) => i.variantId))].sort();
    const locked = await tx.$queryRaw<{ id: string; stock: number; reserved: number }[]>`
      SELECT id, stock, reserved FROM "Variant"
      WHERE id IN (${Prisma.join(variantIds)})
      ORDER BY id
      FOR UPDATE`;
    const available = new Map(locked.map((v) => [v.id, v.stock - v.reserved]));

    const issues = cart.items.map((item) => ({
      variantId: item.variantId,
      issue: lineIssue(item, ctx.isB2B, available.get(item.variantId) ?? 0),
    }));
    const blocking = issues.filter(
      (l) => l.issue === 'UNAVAILABLE' || l.issue === 'NOT_PURCHASABLE',
    );
    if (blocking.length) throw this.cartHasIssues(blocking);
    const short = issues.filter((l) => l.issue !== null);
    if (short.length) {
      throw new AppException(
        'OUT_OF_STOCK',
        HttpStatus.CONFLICT,
        'Some items are no longer available in the requested quantity',
        { variantIds: short.map((l) => l.variantId) },
      );
    }

    const usage = await this.couponUsage(tx, cart.couponCode, {
      userId: customer.userId,
      email: ctx.email,
    });
    const coupon = await this.loadCoupon(tx, cart.couponCode, usage, true);
    const priced = this.price(cart, input.shippingAddress.stateCode, coupon, customer, ctx.isB2B);
    const { totals } = priced;
    if (input.expectedTotal !== undefined && input.expectedTotal !== totals.total) {
      throw new AppException(
        'PRICE_CHANGED',
        HttpStatus.CONFLICT,
        'Prices changed since you last reviewed your order',
        { expectedTotal: input.expectedTotal, total: totals.total },
      );
    }

    for (const item of cart.items) {
      await tx.$executeRaw`
        UPDATE "Variant" SET reserved = reserved + ${item.quantity}, "updatedAt" = now()
        WHERE id = ${item.variantId}`;
    }

    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('order_number_seq') AS n`;
    const now = new Date();
    const bank = input.paymentMethod === 'BANK_TRANSFER';
    const couponApplied = priced.coupon?.valid ? priced.coupon.code : null;

    const order = await tx.order.create({
      data: {
        number: `KTX-${n.toString()}`,
        userId: customer.userId ?? null,
        email: ctx.email,
        phone: input.phone,
        status: bank ? 'AWAITING_PAYMENT' : 'PENDING_PAYMENT',
        paymentMethod: input.paymentMethod,
        shippingAddress: snapshot(input.shippingAddress),
        billingAddress: snapshot(ctx.billing),
        gstin: ctx.gstin,
        businessName: ctx.gstin ? (input.businessName ?? null) : null,
        subtotal: totals.subtotal,
        discount: totals.discount,
        shipping: totals.shipping,
        taxTotal: totals.taxTotal,
        cgst: totals.cgst,
        sgst: totals.sgst,
        igst: totals.igst,
        total: totals.total,
        couponCode: couponApplied,
        idempotencyKey: ctx.idempotencyKey,
        idempotencyHash: ctx.hash,
        cartId: cart.id,
        // Bank transfer waits for staff to confirm the payment (held BANK_TRANSFER_HOLD_DAYS).
        reservedUntil: this.orderPayments.reservationExpiry(input.paymentMethod, now),
        items: {
          create: cart.items.map((item, i) => {
            const line = priced.lines[i];
            return {
              variantId: item.variantId,
              productName: item.variant.product.name,
              variantTitle: item.variant.title,
              sku: item.variant.sku,
              hsnCode: item.variant.product.hsnCode,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              gstRate: line.gstRate,
              taxAmount: line.taxAmount,
              lineTotal: line.lineTotal,
              discount: line.discount,
              netTotal: line.netTotal,
            };
          }),
        },
      },
    });

    if (couponApplied) {
      await tx.coupon.update({
        where: { code: couponApplied },
        data: { usedCount: { increment: 1 } },
      });
    }
    await this.lifecycle.addEvent(tx, order.id, EVENT.PLACED, 'Order placed', {
      actorId: customer.userId ?? null,
    });
    if (input.notes) {
      await this.lifecycle.addEvent(tx, order.id, EVENT.NOTE, `Customer note: ${input.notes}`, {
        internal: true,
        actorId: customer.userId ?? null,
      });
    }
    if (input.saveAddress && customer.userId) {
      await this.saveAddress(tx, customer.userId, input.shippingAddress);
    }
    return order.id;
  }

  // ------------------------------------------------------------------ verify

  /**
   * Checkout.js success handler → verify the signature, confirm with the gateway (capturing an
   * `authorized` payment), mark the order PAID. Idempotent; can be polled.
   */
  async verify(input: VerifyPaymentDto): Promise<PaymentVerificationDto> {
    const payment = await this.prisma.payment.findFirst({
      where: { providerOrderId: input.razorpay_order_id },
      orderBy: { createdAt: 'asc' },
    });
    if (!payment) {
      throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Unknown payment order');
    }
    const valid = this.gateway.verifyPaymentSignature({
      orderId: input.razorpay_order_id,
      paymentId: input.razorpay_payment_id,
      signature: input.razorpay_signature,
    });
    if (!valid) {
      throw new AppException(
        'SIGNATURE_INVALID',
        HttpStatus.BAD_REQUEST,
        'Payment signature is invalid',
      );
    }

    let gp: GatewayPayment;
    try {
      gp = await this.gateway.fetchPayment(input.razorpay_payment_id);
      if (gp.status === 'authorized') {
        gp = await this.gateway.capturePayment(gp.id, payment.amount);
      }
    } catch (err) {
      throw new AppException(
        'PAYMENT_GATEWAY_ERROR',
        HttpStatus.BAD_GATEWAY,
        'Could not confirm the payment with the gateway. Please retry.',
        err instanceof PaymentGatewayError ? { provider: err.providerCode ?? null } : undefined,
      );
    }
    if (gp.orderId && gp.orderId !== input.razorpay_order_id) {
      throw new AppException(
        'SIGNATURE_INVALID',
        HttpStatus.BAD_REQUEST,
        'Payment does not match the order',
      );
    }

    if (gp.status === 'captured' || gp.status === 'refunded') {
      await this.lifecycle.confirmGatewayPayment({
        paymentRowId: payment.id,
        providerPaymentId: gp.id,
        amount: gp.amount || payment.amount,
        method: gp.method,
      });
    } else if (gp.status === 'failed') {
      await this.lifecycle.failGatewayPayment({
        paymentRowId: payment.id,
        providerPaymentId: gp.id,
      });
    }

    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: payment.orderId } });
    return {
      orderNumber: order.number,
      status: order.status,
      paid: !['PENDING_PAYMENT', 'AWAITING_PAYMENT', 'CANCELLED'].includes(order.status),
    };
  }

  // ------------------------------------------------------------------ helpers

  private price(
    cart: CheckoutCart,
    stateCode: string,
    coupon: PricingCoupon,
    customer: CheckoutCustomer,
    isB2B: boolean,
  ): PricingResult {
    const result = this.totals.compute(
      cart.items.map(toPricingLine),
      { stateCode },
      coupon,
      customer.userId ? { id: customer.userId, isB2BApproved: isB2B } : null,
    );
    // An invalid coupon is reported by the pricing engine and must not be silently dropped.
    if (result.coupon && !result.coupon.valid) {
      throw new AppException(
        result.coupon.reason,
        HttpStatus.UNPROCESSABLE_ENTITY,
        result.coupon.message,
        result.coupon.details,
      );
    }
    return result;
  }

  private toCheckoutLine(
    item: CheckoutCart['items'][number],
    line: PricingResult['lines'][number],
  ) {
    return {
      variantId: item.variantId,
      productName: item.variant.product.name,
      variantTitle: item.variant.title,
      sku: item.variant.sku,
      image: pickImage(item.variant.product.images, item.variant.options),
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      gstRate: line.gstRate,
      taxAmount: line.taxAmount,
      lineTotal: line.lineTotal,
      discount: line.discount,
      netTotal: line.netTotal,
    };
  }

  /** Coupon rules for the cart's code (row locked when `lock`), or 422 COUPON_NOT_FOUND. */
  private async loadCoupon(
    db: Db,
    code: string | null,
    customerUsageCount: number | null,
    lock: boolean,
  ): Promise<PricingCoupon> {
    if (!code) return null;
    if (lock) await db.$queryRaw`SELECT id FROM "Coupon" WHERE code = ${code} FOR UPDATE`;
    const coupon = await db.coupon.findUnique({ where: { code } });
    if (!coupon) {
      throw new AppException(
        'COUPON_NOT_FOUND',
        HttpStatus.UNPROCESSABLE_ENTITY,
        'The coupon on your cart no longer exists',
        { code },
      );
    }
    return { coupon, customerUsageCount };
  }

  /** Prior (non-cancelled) orders with this coupon by the user, or by email for guests. */
  private async couponUsage(
    db: Db,
    code: string | null,
    who: { userId?: string; email?: string },
  ): Promise<number | null> {
    if (!code) return 0;
    if (!who.userId && !who.email) return null;
    return db.order.count({
      where: {
        couponCode: code,
        status: { not: 'CANCELLED' },
        ...(who.userId ? { userId: who.userId } : { email: who.email }),
      },
    });
  }

  /** Payment methods offered (also used by quote acceptance). */
  paymentMethods(isB2B: boolean): CheckoutPaymentMethod[] {
    return isB2B && this.orderPayments.bankTransfer ? ['RAZORPAY', 'BANK_TRANSFER'] : ['RAZORPAY'];
  }

  /** ADR-004: role B2B_CUSTOMER backed by an APPROVED business profile. */
  async isApprovedB2B(customer: CheckoutCustomer): Promise<boolean> {
    if (!customer.userId || customer.role !== 'B2B_CUSTOMER') return false;
    const profile = await this.prisma.businessProfile.findUnique({
      where: { userId: customer.userId },
      select: { status: true },
    });
    return profile?.status === 'APPROVED';
  }

  /** Normalised GSTIN; 422 INVALID_GSTIN or GSTIN_STATE_MISMATCH (vs the billing state). */
  assertGstin(gstin: string, billingStateCode: string): string {
    const result = validateGstin(gstin, billingStateCode);
    if (result.valid) return result.gstin;
    const mismatch = result.reason === 'STATE_MISMATCH';
    throw new AppException(
      mismatch ? 'GSTIN_STATE_MISMATCH' : 'INVALID_GSTIN',
      HttpStatus.UNPROCESSABLE_ENTITY,
      mismatch ? 'GSTIN state does not match the billing address state' : result.message,
      { reason: result.reason },
    );
  }

  private cartHasIssues(lines: { variantId: string; issue: string | null }[]) {
    return new AppException(
      'CART_HAS_ISSUES',
      HttpStatus.UNPROCESSABLE_ENTITY,
      'Some items in your cart cannot be ordered as they are',
      { lines },
    );
  }

  private async saveAddress(tx: Db, userId: string, address: AddressInput): Promise<void> {
    const existing = await tx.address.findMany({ where: { userId } });
    if (existing.length >= MAX_ADDRESSES) return;
    const same = existing.some(
      (a) =>
        a.line1 === address.line1 &&
        (a.line2 ?? '') === (address.line2 ?? '') &&
        a.pincode === address.pincode &&
        a.name === address.name &&
        a.phone === address.phone,
    );
    if (same) return;
    await tx.address.create({
      data: {
        ...address,
        line2: address.line2 || null,
        userId,
        isDefault: existing.length === 0,
      },
    });
  }
}

/** Address JSON snapshot stored on the order (also used by quote acceptance). */
export function snapshot(a: AddressInput): Prisma.InputJsonObject {
  return {
    name: a.name,
    phone: a.phone,
    line1: a.line1,
    line2: a.line2 || null,
    city: a.city,
    state: a.state,
    stateCode: a.stateCode,
    pincode: a.pincode,
    country: a.country,
  };
}
