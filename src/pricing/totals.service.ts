import { Injectable } from '@nestjs/common';
import type { Totals } from '../common/dto/money';
import {
  type CouponRules,
  type CouponValidation,
  CouponValidationService,
} from './coupon-validation.service';
import { allocate, assertPaise } from './money';
import { type FreeShippingReason, ShippingFeeService } from './shipping-fee.service';
import { type GstRateInput, type GstRateSource, TaxService } from './tax.service';

/** B2B volume price: buying >= minQty units of the product costs unitPrice (paise, GST-incl.) each. */
export interface PriceTierInput {
  minQty: number;
  unitPrice: number;
}

/** One cart/order line, with everything resolved by the caller from the catalog. */
export interface PricingLineInput {
  variantId: string;
  productId: string;
  quantity: number;
  /** Retail unit price, GST-inclusive paise (Variant.price ?? Product.basePrice). */
  unitPrice: number;
  hsnCode: string | null;
  /** Product.gstRate (percent; Prisma Decimal ok). Ignored for slab-ruled HSN codes. */
  gstRate: GstRateInput | null;
  /** Product's B2B price tiers; used only for approved B2B customers. */
  priceTiers?: readonly PriceTierInput[];
}

/** Only the place of supply matters for tax. null = not known yet (cart preview). */
export type PricingAddress = { stateCode: string } | null;

export type PricingCoupon = {
  coupon: CouponRules;
  /** See `CouponUsageContext.customerUsageCount`. */
  customerUsageCount: number | null;
} | null;

export type PricingCustomer = {
  id: string;
  /** Has an APPROVED business profile (role B2B_CUSTOMER). */
  isB2BApproved: boolean;
} | null;

export interface PricedLine {
  variantId: string;
  productId: string;
  quantity: number;
  /** Retail unit price before B2B tiers. */
  listUnitPrice: number;
  /** Unit price charged (B2B tier applied), GST-inclusive. */
  unitPrice: number;
  /** minQty of the tier applied, null when list price. */
  priceTierMinQty: number | null;
  /** unitPrice × quantity (before coupon). */
  lineTotal: number;
  /** This line's share of the coupon discount. */
  discount: number;
  /** lineTotal - discount: the GST-inclusive amount tax is computed on. */
  netTotal: number;
  /** netTotal - taxAmount. */
  taxableValue: number;
  gstRate: number;
  gstRateSource: GstRateSource;
  /** GST included in netTotal = cgst + sgst + igst. */
  taxAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface PricedShipping {
  /** GST-inclusive fee (also `totals.shipping`). */
  fee: number;
  freeReason: FreeShippingReason | null;
  amountToFreeShipping: number | null;
  /** Rate applied to the fee: the highest line rate (composite supply; CA to confirm). */
  gstRate: number;
  taxAmount: number;
  cgst: number;
  sgst: number;
  igst: number;
}

export interface PricingResult {
  lines: PricedLine[];
  /** Shared totals DTO shape (src/common/dto/money.ts). */
  totals: Totals;
  interState: boolean;
  /** Coupon outcome; an invalid coupon is reported here and simply not applied. */
  coupon: CouponValidation | null;
  shipping: PricedShipping;
  /** At least one line got a B2B tier price. */
  b2bPricingApplied: boolean;
}

/**
 * The one totals function used by the cart, the checkout quote and order creation (PR-4).
 *
 * 1. B2B tiers (approved business customers only): quantities are summed per product across its
 *    variants; the tier with the highest minQty <= that quantity sets the unit price, never above
 *    the list price.
 * 2. subtotal = Σ unitPrice × quantity.
 * 3. Coupon validated against the subtotal; its discount is spread over lines in proportion to
 *    lineTotal (largest remainder, exact to the paisa). Invalid coupons are not applied.
 * 4. Per line: GST rate (slab rule on the discounted per-unit value), tax taken out of netTotal,
 *    rounded half-up per line, split CGST/SGST or IGST by place of supply.
 * 5. Shipping (flat / free over threshold on subtotal - discount / FREE_SHIPPING coupon); its GST
 *    is taken out at the highest line rate.
 * 6. total = subtotal - discount + shipping; taxTotal = Σ line tax + shipping tax.
 */
@Injectable()
export class TotalsService {
  constructor(
    private readonly tax: TaxService,
    private readonly shippingFees: ShippingFeeService,
    private readonly coupons: CouponValidationService,
  ) {}

  compute(
    lines: readonly PricingLineInput[],
    address: PricingAddress,
    coupon: PricingCoupon,
    customer: PricingCustomer,
    options: { now?: Date } = {},
  ): PricingResult {
    lines.forEach((l, i) => this.assertLine(l, i));
    const interState = this.tax.isInterState(address?.stateCode);

    // 1-2. Unit prices (B2B tiers) and subtotal.
    const qtyByProduct = new Map<string, number>();
    for (const l of lines) {
      qtyByProduct.set(l.productId, (qtyByProduct.get(l.productId) ?? 0) + l.quantity);
    }
    const priced = lines.map((l) => {
      const tier = customer?.isB2BApproved
        ? this.pickTier(l.priceTiers ?? [], qtyByProduct.get(l.productId) ?? 0, l.unitPrice)
        : null;
      const unitPrice = tier ? tier.unitPrice : l.unitPrice;
      return { line: l, unitPrice, tier, lineTotal: unitPrice * l.quantity };
    });
    const subtotal = priced.reduce((s, p) => s + p.lineTotal, 0);
    assertPaise(subtotal, 'subtotal');

    // 3. Coupon.
    const couponResult = coupon
      ? this.coupons.validate(coupon.coupon, {
          subtotal,
          customerUsageCount: coupon.customerUsageCount,
          now: options.now,
        })
      : null;
    const discount = couponResult?.valid ? couponResult.discount : 0;
    const freeShippingCoupon = couponResult?.valid ? couponResult.freeShipping : false;
    const lineDiscounts = allocate(
      discount,
      priced.map((p) => p.lineTotal),
    );

    // 4. Per-line tax.
    const pricedLines: PricedLine[] = priced.map((p, i) => {
      const netTotal = p.lineTotal - lineDiscounts[i];
      const { rate, source } = this.tax.resolveRate({
        hsnCode: p.line.hsnCode,
        gstRate: p.line.gstRate,
        quantity: p.line.quantity,
        netAmount: netTotal,
      });
      const t = this.tax.computeInclusive(netTotal, rate, interState);
      return {
        variantId: p.line.variantId,
        productId: p.line.productId,
        quantity: p.line.quantity,
        listUnitPrice: p.line.unitPrice,
        unitPrice: p.unitPrice,
        priceTierMinQty: p.tier?.minQty ?? null,
        lineTotal: p.lineTotal,
        discount: lineDiscounts[i],
        netTotal,
        taxableValue: t.taxableValue,
        gstRate: t.rate,
        gstRateSource: source,
        taxAmount: t.tax,
        cgst: t.cgst,
        sgst: t.sgst,
        igst: t.igst,
      };
    });

    // 5. Shipping and its GST.
    const fee = this.shippingFees.compute({
      merchandiseTotal: subtotal - discount,
      hasItems: lines.length > 0,
      freeShippingCoupon,
    });
    const shippingRate = pricedLines.reduce((max, l) => Math.max(max, l.gstRate), 0);
    const st = this.tax.computeInclusive(fee.fee, shippingRate, interState);
    const shipping: PricedShipping = {
      fee: fee.fee,
      freeReason: fee.freeReason,
      amountToFreeShipping: fee.amountToFreeShipping,
      gstRate: shippingRate,
      taxAmount: st.tax,
      cgst: st.cgst,
      sgst: st.sgst,
      igst: st.igst,
    };

    // 6. Totals.
    const sum = (k: 'cgst' | 'sgst' | 'igst') =>
      pricedLines.reduce((s, l) => s + l[k], 0) + shipping[k];
    const cgst = sum('cgst');
    const sgst = sum('sgst');
    const igst = sum('igst');
    const totals: Totals = {
      subtotal,
      discount,
      shipping: shipping.fee,
      taxTotal: cgst + sgst + igst,
      cgst,
      sgst,
      igst,
      total: subtotal - discount + shipping.fee,
      currency: 'INR',
    };

    return {
      lines: pricedLines,
      totals,
      interState,
      coupon: couponResult,
      shipping,
      b2bPricingApplied: pricedLines.some((l) => l.priceTierMinQty !== null),
    };
  }

  /** Highest-minQty tier reachable at `quantity`, only if cheaper than the list price. */
  private pickTier(
    tiers: readonly PriceTierInput[],
    quantity: number,
    listUnitPrice: number,
  ): PriceTierInput | null {
    let best: PriceTierInput | null = null;
    for (const t of tiers) {
      if (t.minQty <= quantity && (!best || t.minQty > best.minQty)) best = t;
    }
    return best && best.unitPrice < listUnitPrice ? best : null;
  }

  private assertLine(l: PricingLineInput, i: number): void {
    if (!Number.isSafeInteger(l.quantity) || l.quantity < 1) {
      throw new RangeError(`lines[${i}].quantity must be a positive integer`);
    }
    assertPaise(l.unitPrice, `lines[${i}].unitPrice`);
    for (const t of l.priceTiers ?? []) {
      if (!Number.isSafeInteger(t.minQty) || t.minQty < 1) {
        throw new RangeError(`lines[${i}].priceTiers minQty must be a positive integer`);
      }
      assertPaise(t.unitPrice, `lines[${i}].priceTiers unitPrice`);
    }
  }
}
