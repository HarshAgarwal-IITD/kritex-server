import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { Authenticated } from './authenticated.decorator';

export const REQUIRE_VERIFIED_EMAIL_KEY = 'requireVerifiedEmail';

/**
 * Requires a signed-in user whose email is verified (enquiries: contact form and RFQs, ADR-018).
 * Enforced by the global AuthGuard: 401 without a session, 403 `EMAIL_NOT_VERIFIED` otherwise.
 */
export const RequireVerifiedEmail = () =>
  applyDecorators(
    Authenticated(),
    SetMetadata(REQUIRE_VERIFIED_EMAIL_KEY, true),
    ApiResponse({
      status: 403,
      type: ErrorResponseDto,
      description: 'EMAIL_NOT_VERIFIED: verify the account email first',
    }),
  );
