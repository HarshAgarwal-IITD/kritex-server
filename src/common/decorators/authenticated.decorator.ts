import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiCookieAuth, ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { SESSION_SECURITY } from './session-auth';

export const IS_AUTHENTICATED_KEY = 'isAuthenticated';

/**
 * Documents a route (or controller) as requiring a signed-in user of any role: adds the session
 * cookie security requirement and a 401 response. Authentication is the default for every route
 * without `@Public()`; this decorator only makes it explicit (metadata + OpenAPI).
 */
export const Authenticated = () =>
  applyDecorators(
    SetMetadata(IS_AUTHENTICATED_KEY, true),
    ApiCookieAuth(SESSION_SECURITY),
    ApiResponse({ status: 401, type: ErrorResponseDto, description: 'UNAUTHORIZED: no session' }),
  );
