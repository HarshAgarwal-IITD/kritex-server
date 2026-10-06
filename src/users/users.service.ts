import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  AdminUserDto,
  AdminUserListDto,
  CreateStaffUserDto,
  ListUsersQueryDto,
  UpdateUserDto,
} from './dto/user.dto';

/** Staff account management (ADMIN only). */
@Injectable()
export class UsersService {
  list(_query: ListUsersQueryDto): Promise<AdminUserListDto> {
    return notImplemented('adminListUsers');
  }
  createStaff(_input: CreateStaffUserDto): Promise<AdminUserDto> {
    return notImplemented('adminCreateStaffUser');
  }
  update(_id: string, _input: UpdateUserDto, _actorId?: string): Promise<AdminUserDto> {
    return notImplemented('adminUpdateUser');
  }
}
