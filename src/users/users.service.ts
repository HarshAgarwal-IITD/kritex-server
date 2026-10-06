import { HttpStatus, Injectable } from '@nestjs/common';
import { type Prisma, type User } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import {
  type AdminUserDto,
  type AdminUserListDto,
  type CreateStaffUserDto,
  type ListUsersQueryDto,
  STAFF_ROLES,
  type UpdateUserDto,
} from './dto/user.dto';

function toAdminUser(user: User): AdminUserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    disabled: user.banned,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Staff account management (ADMIN only). `disabled` is stored as Better Auth's `banned`. */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<AdminUserListDto> {
    const where: Prisma.UserWhereInput = {
      role: query.role ? query.role : { in: [...STAFF_ROLES] },
      ...(query.q && {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' } },
          { email: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
    ]);
    return { items: users.map(toAdminUser), page: query.page, limit: query.limit, total };
  }

  /** Creates the user (no password) and emails a set-password link. */
  async createStaff(input: CreateStaffUserDto): Promise<AdminUserDto> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new AppException(
        'CONFLICT',
        HttpStatus.CONFLICT,
        'Email already registered: change the role with PATCH /admin/users/:id',
      );
    }
    // Email ownership is proven by the set-password link, which is the only way in.
    const user = await this.prisma.user.create({
      data: { email: input.email, name: input.name, role: input.role, emailVerified: true },
    });
    await this.auth.sendStaffInvite(user);
    return toAdminUser(user);
  }

  async update(id: string, input: UpdateUserDto, actorId: string): Promise<AdminUserDto> {
    const changesAccess = input.role !== undefined || input.disabled !== undefined;
    if (id === actorId && changesAccess) {
      throw new AppException(
        'CANNOT_MODIFY_SELF',
        HttpStatus.CONFLICT,
        'You cannot change your own role or disable yourself',
      );
    }

    const user = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target) throw new AppException('NOT_FOUND', HttpStatus.NOT_FOUND, 'User not found');

      const losesAdmin =
        target.role === 'ADMIN' &&
        !target.banned &&
        ((input.role !== undefined && input.role !== 'ADMIN') || input.disabled === true);
      if (losesAdmin) {
        // Serialise concurrent demotions so two admins can't remove each other.
        await tx.$queryRaw`SELECT id FROM "User" WHERE role = 'ADMIN' FOR UPDATE`;
        const admins = await tx.user.count({ where: { role: 'ADMIN', banned: false } });
        if (admins <= 1) {
          throw new AppException('LAST_ADMIN', HttpStatus.CONFLICT, 'Keep at least one admin');
        }
      }

      return tx.user.update({
        where: { id },
        data: {
          name: input.name,
          role: input.role,
          ...(input.disabled !== undefined && {
            banned: input.disabled,
            banReason: input.disabled ? 'Disabled by an admin' : null,
            banExpires: null,
          }),
        },
      });
    });

    // Roles are read from the database on every request, so a role change applies at once;
    // disabling also signs the user out everywhere.
    if (input.disabled === true) await this.auth.revokeSessions(id);
    return toAdminUser(user);
  }
}
