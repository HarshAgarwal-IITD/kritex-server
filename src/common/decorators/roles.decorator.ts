import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiCookieAuth, ApiResponse } from '@nestjs/swagger';
import type { Role } from '../dto/enums';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { SESSION_SECURITY } from './session-auth';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route (or controller) to users with one of the given roles, e.g.
 * `@Roles('STAFF', 'ADMIN')`. Enforced by the global AuthGuard (401 without a session, 403 for other roles); also
 * documents the session cookie + 401/403 responses in OpenAPI.
 */
export const Roles = (...roles: [Role, ...Role[]]) =>
  applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    ApiCookieAuth(SESSION_SECURITY),
    ApiResponse({ status: 401, type: ErrorResponseDto, description: 'UNAUTHORIZED: no session' }),
    ApiResponse({
      status: 403,
      type: ErrorResponseDto,
      description: 'FORBIDDEN: role not allowed',
    }),
  );
