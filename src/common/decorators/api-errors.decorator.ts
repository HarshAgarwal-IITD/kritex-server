import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { ErrorResponseDto } from '../dto/error-response.dto';

const DESCRIPTIONS: Record<number, string> = {
  400: 'VALIDATION_ERROR / BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'Business rule violated (see error.code)',
  429: 'TOO_MANY_REQUESTS',
};

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 422 | 429;

/**
 * Documents error responses (all use `ErrorResponseDto`). Pass `[status, description]` to name
 * the specific error codes a route can return.
 *
 * @example @ApiErrors(400, [409, 'OUT_OF_STOCK'], 429)
 */
export const ApiErrors = (...errors: (ApiErrorStatus | [ApiErrorStatus, string])[]) =>
  applyDecorators(
    ...errors.map((error) => {
      const [status, description] = Array.isArray(error) ? error : [error, DESCRIPTIONS[error]];
      return ApiResponse({ status, type: ErrorResponseDto, description });
    }),
  );
