import { HttpException, type HttpStatus } from '@nestjs/common';

/**
 * The one exception type domain code should throw. The global filter turns it
 * into `{ error: { code, message, details? } }` with the given HTTP status.
 *
 * @example throw new AppException('OUT_OF_STOCK', HttpStatus.CONFLICT, 'Variant is out of stock', { variantId });
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    status: HttpStatus | number,
    message: string,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
    this.name = 'AppException';
  }
}
