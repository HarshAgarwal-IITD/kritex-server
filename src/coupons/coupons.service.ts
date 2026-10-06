import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  CouponDto,
  CouponListDto,
  CreateCouponDto,
  ListCouponsQueryDto,
  UpdateCouponDto,
} from './dto/coupon.dto';

/** Admin coupon CRUD (COM-5). `CouponService.validate()` (PR-3) also lands in this module. */
@Injectable()
export class CouponsService {
  list(_query: ListCouponsQueryDto): Promise<CouponListDto> {
    return notImplemented('adminListCoupons');
  }
  create(_input: CreateCouponDto): Promise<CouponDto> {
    return notImplemented('adminCreateCoupon');
  }
  get(_id: string): Promise<CouponDto> {
    return notImplemented('adminGetCoupon');
  }
  update(_id: string, _input: UpdateCouponDto): Promise<CouponDto> {
    return notImplemented('adminUpdateCoupon');
  }
  delete(_id: string): Promise<void> {
    return notImplemented('adminDeleteCoupon');
  }
}
