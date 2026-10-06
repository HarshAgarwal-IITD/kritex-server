import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isoDateTimeSchema } from '../../common/dto/common';
import { roleSchema } from '../../common/dto/enums';
import { emailInputSchema } from '../../common/dto/india';
import { paginatedSchema, paginationQueryShape } from '../../common/dto/pagination';

export const STAFF_ROLES = ['STAFF', 'ADMIN'] as const;
export const staffRoleSchema = z.enum(STAFF_ROLES);

export const listUsersQuerySchema = z.object({
  role: roleSchema.optional().meta({ description: 'Default: STAFF and ADMIN' }),
  q: z.string().trim().min(1).max(100).optional().meta({ description: 'Name or email' }),
  ...paginationQueryShape,
});
export class ListUsersQueryDto extends createZodDto(listUsersQuerySchema) {}

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: roleSchema,
  emailVerified: z.boolean(),
  disabled: z.boolean().meta({ description: 'Banned: cannot sign in, sessions revoked' }),
  lastSignInAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export class AdminUserDto extends createZodDto(adminUserSchema) {}
export class AdminUserListDto extends createZodDto(paginatedSchema(adminUserSchema)) {}

/** Invite a staff member: creates the user and emails a set-password link. */
export const createStaffUserSchema = z.object({
  email: emailInputSchema,
  name: z.string().trim().min(1).max(100),
  role: staffRoleSchema,
});
export class CreateStaffUserDto extends createZodDto(createStaffUserSchema) {}

/** Change role (promote/demote, any role) or disable an account. Admins cannot demote themselves. */
export const updateUserSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: roleSchema.optional(),
  disabled: z.boolean().optional(),
});
export class UpdateUserDto extends createZodDto(updateUserSchema) {}
