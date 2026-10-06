import { Injectable } from '@nestjs/common';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  ApplyBusinessProfileDto,
  BusinessProfileDto,
  CreateAddressDto,
  MeDto,
  SavedAddressDto,
  SavedAddressListDto,
  UpdateAddressDto,
  UpdateMeDto,
} from './dto/account.dto';

/** Signed-in customer's profile, addresses and B2B application (AUTH-3). */
@Injectable()
export class CustomersService {
  getMe(_userId: string): Promise<MeDto> {
    return notImplemented('getMe');
  }
  updateMe(_userId: string, _input: UpdateMeDto): Promise<MeDto> {
    return notImplemented('updateMe');
  }
  listAddresses(_userId: string): Promise<SavedAddressListDto> {
    return notImplemented('listMyAddresses');
  }
  createAddress(_userId: string, _input: CreateAddressDto): Promise<SavedAddressDto> {
    return notImplemented('createMyAddress');
  }
  updateAddress(_userId: string, _id: string, _input: UpdateAddressDto): Promise<SavedAddressDto> {
    return notImplemented('updateMyAddress');
  }
  deleteAddress(_userId: string, _id: string): Promise<void> {
    return notImplemented('deleteMyAddress');
  }
  applyBusinessProfile(
    _userId: string,
    _input: ApplyBusinessProfileDto,
  ): Promise<BusinessProfileDto> {
    return notImplemented('applyBusinessProfile');
  }
}
