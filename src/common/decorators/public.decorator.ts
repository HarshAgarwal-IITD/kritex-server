import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route (or controller) as reachable without a session. Every other route requires a
 * signed-in user once the global AuthGuard lands (Stage 2, AUTH-2). Until then this only sets metadata.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
