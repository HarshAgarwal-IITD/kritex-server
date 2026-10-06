import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Role } from '../dto/enums';

/** The signed-in user the AuthGuard (Stage 2) attaches to `req.user`. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  emailVerified: boolean;
}

/**
 * Injects `req.user` (or `undefined` for anonymous requests on `@Public()` routes).
 *
 * @example me(@CurrentUser() user: SessionUser | undefined)
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SessionUser | undefined =>
    context.switchToHttp().getRequest<{ user?: SessionUser }>().user,
);
