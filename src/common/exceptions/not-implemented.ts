import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

/** Stage 1 stub body: `501 NOT_IMPLEMENTED`. Replaced as each module is implemented. */
export function notImplemented(operationId: string): never {
  throw new AppException(
    'NOT_IMPLEMENTED',
    HttpStatus.NOT_IMPLEMENTED,
    `${operationId} not implemented yet`,
  );
}
