import type { Address, BusinessProfile, User } from '@prisma/client';
import type { SavedAddress } from '../common/dto/address';
import type { GstStateCode } from '../common/dto/india';
import type { BusinessProfileDto, MeDto } from './dto/account.dto';

export function toSavedAddress(address: Address): SavedAddress {
  return {
    id: address.id,
    name: address.name,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    stateCode: address.stateCode as GstStateCode,
    pincode: address.pincode,
    country: 'IN',
    isDefault: address.isDefault,
  };
}

export function toBusinessProfileDto(profile: BusinessProfile): BusinessProfileDto {
  return {
    id: profile.id,
    legalName: profile.legalName,
    gstin: profile.gstin,
    status: profile.status,
    rejectionReason: profile.rejectionReason,
    createdAt: profile.createdAt.toISOString(),
    reviewedAt: profile.approvedAt?.toISOString() ?? null,
  };
}

export function toMeDto(user: User & { businessProfile: BusinessProfile | null }): MeDto {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name,
    phone: user.phone,
    role: user.role,
    businessProfile: user.businessProfile ? toBusinessProfileDto(user.businessProfile) : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Orders that count as revenue (paid, possibly later fulfilled). */
export const PAID_ORDER_STATUSES = [
  'PAID',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
  'RETURN_REQUESTED',
] as const;
