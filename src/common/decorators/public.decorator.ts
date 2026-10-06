import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as reachable without a session. Every other route requires a
 * signed-in user (global `AuthGuard`). `@CurrentUser()` is still set on public routes when the
 * request carries a valid session. `@Roles()` on the same route wins over `@Public()`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
