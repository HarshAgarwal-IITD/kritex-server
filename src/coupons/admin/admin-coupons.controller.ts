import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import { CouponsService } from '../coupons.service';
import {
  CouponDto,
  CouponListDto,
  CreateCouponDto,
  ListCouponsQueryDto,
  UpdateCouponDto,
} from '../dto/coupon.dto';

@ApiTags('admin-coupons')
@Roles('STAFF', 'ADMIN')
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListCoupons', summary: 'List coupons' })
  @ZodResponse({ status: 200, type: CouponListDto, description: 'Paginated coupons' })
  @ApiErrors(400)
  list(@Query() query: ListCouponsQueryDto) {
    return this.coupons.list(query);
  }

  @Post()
  @ApiOperation({ operationId: 'adminCreateCoupon', summary: 'Create a coupon' })
  @ZodResponse({ status: 201, type: CouponDto, description: 'Created' })
  @ApiErrors(400, [409, 'CONFLICT: code taken'])
  create(@Body() body: CreateCouponDto) {
    return this.coupons.create(body);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetCoupon', summary: 'Coupon detail' })
  @ZodResponse({ status: 200, type: CouponDto, description: 'Coupon' })
  @ApiErrors(404)
  get(@Param() params: IdParamDto) {
    return this.coupons.get(params.id);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'adminUpdateCoupon', summary: 'Update a coupon (partial)' })
  @ZodResponse({ status: 200, type: CouponDto, description: 'Updated' })
  @ApiErrors(400, 404, [409, 'CONFLICT: code taken'])
  update(@Param() params: IdParamDto, @Body() body: UpdateCouponDto) {
    return this.coupons.update(params.id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    operationId: 'adminDeleteCoupon',
    summary: 'Delete a coupon (deactivates it instead if it has been used)',
  })
  @ApiResponse({ status: 204, description: 'Deleted or deactivated' })
  @ApiErrors(404)
  delete(@Param() params: IdParamDto) {
    return this.coupons.delete(params.id);
  }
}
