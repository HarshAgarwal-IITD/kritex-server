import { Injectable } from '@nestjs/common';
import { notImplemented } from '../../common/exceptions/not-implemented';
import type {
  AdminBusinessProfileDto,
  AdminBusinessProfileListDto,
  AdminCustomerDetailDto,
  AdminCustomerListDto,
  ListBusinessProfilesQueryDto,
  ListCustomersQueryDto,
  RejectBusinessProfileDto,
} from '../dto/admin-customers.dto';

@Injectable()
export class AdminCustomersService {
  listCustomers(_query: ListCustomersQueryDto): Promise<AdminCustomerListDto> {
    return notImplemented('adminListCustomers');
  }
  getCustomer(_id: string): Promise<AdminCustomerDetailDto> {
    return notImplemented('adminGetCustomer');
  }
  listBusinessProfiles(_query: ListBusinessProfilesQueryDto): Promise<AdminBusinessProfileListDto> {
    return notImplemented('adminListBusinessProfiles');
  }
  /** Sets status APPROVED and the user's role to B2B_CUSTOMER. */
  approveBusinessProfile(_id: string, _actorId?: string): Promise<AdminBusinessProfileDto> {
    return notImplemented('adminApproveBusinessProfile');
  }
  rejectBusinessProfile(
    _id: string,
    _input: RejectBusinessProfileDto,
    _actorId?: string,
  ): Promise<AdminBusinessProfileDto> {
    return notImplemented('adminRejectBusinessProfile');
  }
}
