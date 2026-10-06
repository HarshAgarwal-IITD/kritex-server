import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Authenticated } from '../common/decorators/authenticated.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { IdParamDto } from '../common/dto/common';
import { CustomersService } from './customers.service';
import {
  ApplyBusinessProfileDto,
  BusinessProfileDto,
  CreateAddressDto,
  MeDto,
  SavedAddressDto,
  SavedAddressListDto,
  UpdateAddressDto,
  UpdateMeDto,
} from './dto/account.dto';

/**
 * `/me`, `/me/addresses`, `/me/business-profile`. (`/me/orders` lives in OrdersModule and
 * `/me/quotes` in QuotesModule: each route sits in the module that owns its data.)
 */
@ApiTags('account')
@Authenticated()
@Controller('me')
export class MeController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ operationId: 'getMe', summary: 'Profile, role and business-profile status' })
  @ZodResponse({ status: 200, type: MeDto, description: 'Current user' })
  getMe(@CurrentUser() user: SessionUser) {
    return this.customers.getMe(user.id);
  }

  @Patch()
  @ApiOperation({ operationId: 'updateMe', summary: 'Update name / phone' })
  @ZodResponse({ status: 200, type: MeDto, description: 'Updated user' })
  @ApiErrors(400)
  updateMe(@CurrentUser() user: SessionUser, @Body() body: UpdateMeDto) {
    return this.customers.updateMe(user.id, body);
  }

  @Get('addresses')
  @ApiOperation({ operationId: 'listMyAddresses', summary: 'Saved addresses (default first)' })
  @ZodResponse({ status: 200, type: SavedAddressListDto, description: 'Addresses' })
  listAddresses(@CurrentUser() user: SessionUser) {
    return this.customers.listAddresses(user.id);
  }

  @Post('addresses')
  @ApiOperation({ operationId: 'createMyAddress', summary: 'Save an address' })
  @ZodResponse({ status: 201, type: SavedAddressDto, description: 'Created' })
  @ApiErrors(400, [422, 'ADDRESS_LIMIT_REACHED'])
  createAddress(@CurrentUser() user: SessionUser, @Body() body: CreateAddressDto) {
    return this.customers.createAddress(user.id, body);
  }

  @Patch('addresses/:id')
  @ApiOperation({ operationId: 'updateMyAddress', summary: 'Update a saved address' })
  @ZodResponse({ status: 200, type: SavedAddressDto, description: 'Updated' })
  @ApiErrors(400, [404, 'NOT_FOUND (also for addresses of other users)'])
  updateAddress(
    @CurrentUser() user: SessionUser,
    @Param() params: IdParamDto,
    @Body() body: UpdateAddressDto,
  ) {
    return this.customers.updateAddress(user.id, params.id, body);
  }

  @Delete('addresses/:id')
  @HttpCode(204)
  @ApiOperation({ operationId: 'deleteMyAddress', summary: 'Delete a saved address' })
  @ApiResponse({ status: 204, description: 'Deleted' })
  @ApiErrors(404)
  deleteAddress(@CurrentUser() user: SessionUser, @Param() params: IdParamDto) {
    return this.customers.deleteAddress(user.id, params.id);
  }

  @Post('business-profile')
  @ApiOperation({
    operationId: 'applyBusinessProfile',
    summary: 'Apply for a B2B account (re-apply allowed after REJECTED); admin approves',
  })
  @ZodResponse({ status: 201, type: BusinessProfileDto, description: 'Application (PENDING)' })
  @ApiErrors(400, [409, 'BUSINESS_PROFILE_EXISTS: already PENDING or APPROVED'])
  applyBusinessProfile(@CurrentUser() user: SessionUser, @Body() body: ApplyBusinessProfileDto) {
    return this.customers.applyBusinessProfile(user.id, body);
  }
}
