import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import type { ErrorResponse } from '../dto/error-response.dto';
import { AppException } from '../exceptions/app.exception';

interface MappedError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface ValidationIssue {
  path: string;
  code: string;
  message: string;
}

const GENERIC_500 = 'Internal server error';

/** Codes for the statuses Nest/Express throw on their own. Anything else is `HTTP_<status>`. */
export function codeForStatus(status: number): string {
  if (status === 500) return 'INTERNAL_ERROR';
  const name = (HttpStatus as Record<number, string | undefined>)[status];
  return name ?? `HTTP_${status}`;
}

/** Flattens zod issues to `{ path: "a.b", code, message }`. Duck-typed so zod v3/v4 errors both work. */
export function toValidationIssues(error: unknown): ValidationIssue[] | undefined {
  const issues =
    error instanceof ZodError ? error.issues : (error as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.map((raw) => {
    const issue = raw as { path?: unknown; code?: unknown; message?: unknown };
    return {
      path: Array.isArray(issue.path) ? issue.path.map(String).join('.') : '',
      code: typeof issue.code === 'string' ? issue.code : 'invalid',
      message: typeof issue.message === 'string' ? issue.message : 'Invalid value',
    };
  });
}

function messageFromHttpException(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const { message } = response;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
  }
  return exception.message;
}

/** body-parser errors (malformed JSON, payload too large) carry `status` + `type`. */
function isBodyParserError(
  exception: unknown,
): exception is { status: number; type: string; message: string } {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    typeof (exception as { status?: unknown }).status === 'number' &&
    typeof (exception as { type?: unknown }).type === 'string' &&
    (exception as { type: string }).type.startsWith('entity.')
  );
}

function mapPrismaKnownError(exception: Prisma.PrismaClientKnownRequestError): MappedError {
  switch (exception.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: 'CONFLICT',
        message: 'A record with these unique fields already exists',
        details: { target: exception.meta?.target },
      };
    case 'P2025':
      return { status: HttpStatus.NOT_FOUND, code: 'NOT_FOUND', message: 'Record not found' };
    default:
      if (exception.code.startsWith('P1')) {
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: 'SERVICE_UNAVAILABLE',
          message: 'Database unavailable',
        };
      }
      return { status: 500, code: 'INTERNAL_ERROR', message: GENERIC_500 };
  }
}

export function mapException(exception: unknown): MappedError {
  if (exception instanceof AppException) {
    return {
      status: exception.getStatus(),
      code: exception.code,
      message: exception.message,
      ...(exception.details !== undefined && { details: exception.details }),
    };
  }

  if (exception instanceof ZodValidationException) {
    return {
      status: HttpStatus.BAD_REQUEST,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: toValidationIssues(exception.getZodError()),
    };
  }

  if (exception instanceof ZodSerializationException) {
    // Our response didn't match its declared DTO: a server bug, never leak details.
    return { status: 500, code: 'INTERNAL_ERROR', message: GENERIC_500 };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    return {
      status,
      code: codeForStatus(status),
      message: status >= 500 ? GENERIC_500 : messageFromHttpException(exception),
    };
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    return mapPrismaKnownError(exception);
  }

  if (exception instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: 'SERVICE_UNAVAILABLE',
      message: 'Database unavailable',
    };
  }

  if (isBodyParserError(exception) && exception.status < 500) {
    return {
      status: exception.status,
      code: codeForStatus(exception.status),
      message: exception.type === 'entity.parse.failed' ? 'Malformed JSON body' : exception.message,
    };
  }

  return { status: 500, code: 'INTERNAL_ERROR', message: GENERIC_500 };
}

/**
 * Global filter: every error leaves the API as
 * `{ "error": { "code": string, "message": string, "details"?: unknown } }`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const mapped = mapException(exception);

    if (mapped.status >= 500) {
      this.logger.error(
        { err: exception, code: mapped.code },
        exception instanceof Error ? exception.message : 'Unhandled exception',
      );
    }

    const body: ErrorResponse = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details !== undefined && { details: mapped.details }),
      },
    };

    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.status).json(body);
  }
}
