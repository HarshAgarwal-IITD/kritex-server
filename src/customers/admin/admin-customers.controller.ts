import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import {
  AdminBusinessProfileDto,
  AdminBusinessProfileListDto,
  AdminCustomerDetailDto,
  AdminCustomerListDto,
  ListBusinessProfilesQueryDto,
  ListCustomersQueryDto,
  RejectBusinessProfileDto,
} from '../dto/admin-customers.dto';
import { AdminCustomersService } from './admin-customers.service';

@ApiTags('admin-customers')
@Roles('STAFF', 'ADMIN')
@Controller('admin')
export class AdminCustomersController {
  constructor(private readonly customers: AdminCustomersService) {}

  @Get('customers')
  @ApiOperation({ operationId: 'adminListCustomers', summary: 'Customers (CUSTOMER, B2B_CUSTOMER)' })
  @ZodResponse({ status: 200, type: AdminCustomerListDto, description: 'Paginated customers' })
  @ApiErrors(400)
  listCustomers(@Query() query: ListCustomersQueryDto) {
    return this.customers.listCustomers(query);
  }

  @Get('customers/:id')
  @ApiOperation({ operationId: 'adminGetCustomer', summary: 'Customer detail' })
  @ZodResponse({ status: 200, type: AdminCustomerDetailDto, description: 'Customer' })
  @ApiErrors(404)
  getCustomer(@Param() params: IdParamDto) {
    return this.customers.getCustomer(params.id);
  }

  @Get('business-profiles')
  @ApiOperation({ operationId: 'adminListBusinessProfiles', summary: 'B2B applications' })
  @ZodResponse({ status: 200, type: AdminBusinessProfileListDto, description: 'Paginated' })
  @ApiErrors(400)
  listBusinessProfiles(@Query() query: ListBusinessProfilesQueryDto) {
    return this.customers.listBusinessProfiles(query);
  }

  @Post('business-profiles/:id/approve')
  @ApiOperation({
    operationId: 'adminApproveBusinessProfile',
    summary: 'Approve a B2B application (user role → B2B_CUSTOMER)',
  })
  @ZodResponse({ status: 200, type: AdminBusinessProfileDto, description: 'Approved' })
  @ApiErrors(404, [409, 'INVALID_STATUS: not PENDING'])
  approve(@Param() params: IdParamDto, @CurrentUser() user: SessionUser | undefined) {
    return this.customers.approveBusinessProfile(params.id, user?.id);
  }

  @Post('business-profiles/:id/reject')
  @ApiOperation({ operationId: 'adminRejectBusinessProfile', summary: 'Reject a B2B application' })
  @ZodResponse({ status: 200, type: AdminBusinessProfileDto, description: 'Rejected' })
  @ApiErrors(400, 404, [409, 'INVALID_STATUS: not PENDING'])
  reject(
    @Param() params: IdParamDto,
    @Body() body: RejectBusinessProfileDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.customers.rejectBusinessProfile(params.id, body, user?.id);
  }
}
