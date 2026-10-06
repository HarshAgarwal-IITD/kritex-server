import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toBusinessProfileDto, toMeDto, toSavedAddress } from './customers.mappers';
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

/** Max saved addresses per user (`422 ADDRESS_LIMIT_REACHED` beyond this). */
export const MAX_ADDRESSES = 20;

const addressNotFound = () =>
  new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'Address not found');

/** Signed-in customer's profile, addresses and B2B application (AUTH-3). */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MeDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { businessProfile: true },
    });
    if (!user) throw new AppException('UNAUTHORIZED', HttpStatus.UNAUTHORIZED, 'Sign in required');
    return toMeDto(user);
  }

  async updateMe(userId: string, input: UpdateMeDto): Promise<MeDto> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { name: input.name, phone: input.phone },
      include: { businessProfile: true },
    });
    return toMeDto(user);
  }

  async listAddresses(userId: string): Promise<SavedAddressListDto> {
    const addresses = await this.prisma.address.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return { items: addresses.map(toSavedAddress) };
  }

  async createAddress(userId: string, input: CreateAddressDto): Promise<SavedAddressDto> {
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId } });
      if (count >= MAX_ADDRESSES) {
        throw new AppException(
          'ADDRESS_LIMIT_REACHED',
          HttpStatus.UNPROCESSABLE_ENTITY,
          `You can save up to ${MAX_ADDRESSES} addresses`,
        );
      }
      // The first address is always the default.
      const isDefault = input.isDefault || count === 0;
      if (isDefault) {
        await tx.address.updateMany({ where: { userId }, data: { isDefault: false } });
      }
      const address = await tx.address.create({
        data: { ...input, line2: input.line2 || null, userId, isDefault },
      });
      return toSavedAddress(address);
    });
  }

  async updateAddress(
    userId: string,
    id: string,
    input: UpdateAddressDto,
  ): Promise<SavedAddressDto> {
    return this.prisma.$transaction(async (tx) => {
      // Scoped by userId: another user's address looks exactly like a missing one (no IDOR).
      const existing = await tx.address.findFirst({ where: { id, userId } });
      if (!existing) throw addressNotFound();

      if (input.isDefault === true) {
        await tx.address.updateMany({
          where: { userId, id: { not: id } },
          data: { isDefault: false },
        });
      }
      // The default only moves by making another address the default.
      const isDefault = existing.isDefault || input.isDefault === true;
      const address = await tx.address.update({
        where: { id },
        data: {
          ...input,
          line2: input.line2 === undefined ? undefined : input.line2 || null,
          isDefault,
        },
      });
      return toSavedAddress(address);
    });
  }

  async deleteAddress(userId: string, id: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.address.findFirst({ where: { id, userId } });
      if (!existing) throw addressNotFound();
      await tx.address.delete({ where: { id } });
      if (existing.isDefault) {
        const next = await tx.address.findFirst({
          where: { userId },
          orderBy: { createdAt: 'asc' },
        });
        if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    });
  }

  /** Creates a PENDING application, or re-opens a REJECTED one. */
  async applyBusinessProfile(
    userId: string,
    input: ApplyBusinessProfileDto,
  ): Promise<BusinessProfileDto> {
    const existing = await this.prisma.businessProfile.findUnique({ where: { userId } });
    if (existing && existing.status !== 'REJECTED') {
      throw new AppException(
        'BUSINESS_PROFILE_EXISTS',
        HttpStatus.CONFLICT,
        existing.status === 'PENDING'
          ? 'Your business account application is already under review'
          : 'You already have an approved business account',
      );
    }
    const data = {
      legalName: input.legalName,
      gstin: input.gstin,
      status: 'PENDING' as const,
      rejectionReason: null,
      approvedAt: null,
      approvedById: null,
    };
    const profile = existing
      ? await this.prisma.businessProfile.update({ where: { userId }, data })
      : await this.prisma.businessProfile.create({ data: { ...data, userId } });
    return toBusinessProfileDto(profile);
  }
}
