import {
  type ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { AppException } from '../exceptions/app.exception';
import { AllExceptionsFilter, codeForStatus, mapException } from './all-exceptions.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

const prismaKnown = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('prisma failure', { code, clientVersion: 'test', meta });

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes { error: { code, message, details } } with the mapped status', () => {
    const { host, status, json } = mockHost();
    filter.catch(
      new AppException('OUT_OF_STOCK', HttpStatus.CONFLICT, 'Variant is out of stock', {
        variantId: 'v1',
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'OUT_OF_STOCK',
        message: 'Variant is out of stock',
        details: { variantId: 'v1' },
      },
    });
  });

  it('omits details when there are none', () => {
    const { host, json } = mockHost();
    filter.catch(new NotFoundException('nope'), host);
    expect(json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'nope' } });
  });

  it('logs 5xx errors but not 4xx', () => {
    const { host } = mockHost();
    filter.catch(new BadRequestException(), host);
    expect(Logger.prototype.error).not.toHaveBeenCalled();
    filter.catch(new Error('boom'), host);
    expect(Logger.prototype.error).toHaveBeenCalledTimes(1);
  });
});

describe('mapException', () => {
  it('maps AppException as-is', () => {
    expect(mapException(new AppException('COUPON_EXPIRED', 422, 'Coupon expired'))).toEqual({
      status: 422,
      code: 'COUPON_EXPIRED',
      message: 'Coupon expired',
    });
  });

  it('maps zod validation errors → 400 VALIDATION_ERROR with flattened issues', () => {
    const result = z
      .object({ email: z.email(), items: z.array(z.object({ qty: z.number().min(1) })) })
      .safeParse({ email: 'x', items: [{ qty: 0 }] });
    expect(result.success).toBe(false);

    const mapped = mapException(new ZodValidationException(result.error));
    expect(mapped).toEqual({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: [
        { path: 'email', code: 'invalid_format', message: expect.any(String) },
        { path: 'items.0.qty', code: 'too_small', message: expect.any(String) },
      ],
    });
  });

  it.each([
    [new NotFoundException(), 404, 'NOT_FOUND'],
    [new UnauthorizedException(), 401, 'UNAUTHORIZED'],
    [new ForbiddenException(), 403, 'FORBIDDEN'],
    [new BadRequestException('bad'), 400, 'BAD_REQUEST'],
    [new ThrottlerException(), 429, 'TOO_MANY_REQUESTS'],
  ])('maps %p → %i %s', (exception, status, code) => {
    expect(mapException(exception)).toMatchObject({ status, code });
  });

  it('joins array messages from HttpExceptions', () => {
    expect(mapException(new BadRequestException(['a is bad', 'b is bad'])).message).toBe(
      'a is bad; b is bad',
    );
  });

  it('hides messages of 5xx HttpExceptions', () => {
    expect(mapException(new InternalServerErrorException('db password is hunter2'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('treats response serialization failures as INTERNAL_ERROR without leaking the zod error', () => {
    const mapped = mapException(new ZodSerializationException(new Error('id: expected string')));
    expect(mapped).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('maps Prisma P2002 → 409 CONFLICT with the unique target', () => {
    expect(mapException(prismaKnown('P2002', { target: ['email'] }))).toEqual({
      status: 409,
      code: 'CONFLICT',
      message: expect.any(String),
      details: { target: ['email'] },
    });
  });

  it('maps Prisma P2025 → 404 NOT_FOUND', () => {
    expect(mapException(prismaKnown('P2025'))).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });

  it('maps Prisma connection errors → 503 SERVICE_UNAVAILABLE', () => {
    expect(mapException(prismaKnown('P1001'))).toMatchObject({
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
    expect(
      mapException(new Prisma.PrismaClientInitializationError('cannot reach db', 'test')),
    ).toMatchObject({ status: 503, code: 'SERVICE_UNAVAILABLE' });
  });

  it('maps other Prisma errors → 500 INTERNAL_ERROR without leaking the query', () => {
    expect(mapException(prismaKnown('P2003'))).toEqual({
      status: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });

  it('maps body-parser errors to their 4xx status', () => {
    const parseError = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    expect(mapException(parseError)).toEqual({
      status: 400,
      code: 'BAD_REQUEST',
      message: 'Malformed JSON body',
    });
  });

  it.each([new Error('secret internals'), 'a string', null, { weird: true }])(
    'maps unknown error %p → 500 INTERNAL_ERROR with a generic message',
    (exception) => {
      expect(mapException(exception)).toEqual({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      });
    },
  );
});

describe('codeForStatus', () => {
  it.each([
    [400, 'BAD_REQUEST'],
    [404, 'NOT_FOUND'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [429, 'TOO_MANY_REQUESTS'],
    [500, 'INTERNAL_ERROR'],
    [503, 'SERVICE_UNAVAILABLE'],
    [499, 'HTTP_499'],
  ])('%i → %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});
