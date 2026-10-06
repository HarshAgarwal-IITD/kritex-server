import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '../dto/enums';

/** The signed-in user the global AuthGuard attaches to `req.user` (role read fresh per request). */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
}

/**
 * Injects `req.user`. Always set on routes that are not `@Public()` (the guard has already
 * answered 401 otherwise), so type it `SessionUser` there; on `@Public()` routes it is
 * `SessionUser | undefined`.
 *
 * @example me(@CurrentUser() user: SessionUser)
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined =>
    context.switchToHttp().getRequest<{ user?: SessionUser }>().user,
);
