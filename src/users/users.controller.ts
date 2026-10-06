import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { IdParamDto } from '../common/dto/common';
import {
  AdminUserDto,
  AdminUserListDto,
  CreateStaffUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('admin-users')
@Roles('ADMIN')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListUsers', summary: 'Staff accounts (filter by role)' })
  @ZodResponse({ status: 200, type: AdminUserListDto, description: 'Paginated users' })
  @ApiErrors(400)
  list(@Query() query: ListUsersQueryDto) {
    return this.users.list(query);
  }

  @Post()
  @ApiOperation({
    operationId: 'adminCreateStaffUser',
    summary: 'Invite a STAFF/ADMIN user (emails a set-password link)',
  })
  @ZodResponse({ status: 201, type: AdminUserDto, description: 'Created' })
  @ApiErrors(400, [409, 'CONFLICT: email already registered (use PATCH to change role)'])
  create(@Body() body: CreateStaffUserDto) {
    return this.users.createStaff(body);
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'adminUpdateUser', summary: 'Change role / disable a user' })
  @ZodResponse({ status: 200, type: AdminUserDto, description: 'Updated' })
  @ApiErrors(400, 404, [409, 'CANNOT_MODIFY_SELF | LAST_ADMIN'])
  update(
    @Param() params: IdParamDto,
    @Body() body: UpdateUserDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.users.update(params.id, body, user?.id);
  }
}
