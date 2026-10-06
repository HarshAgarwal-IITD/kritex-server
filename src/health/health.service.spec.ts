import { Logger } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('returns ok when SELECT 1 succeeds', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    await expect(new HealthService(prisma as unknown as PrismaService).check()).resolves.toEqual({
      status: 'ok',
    });
  });

  it('throws 503 SERVICE_UNAVAILABLE when the DB is unreachable', async () => {
    const prisma = { $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) };
    const error = await new HealthService(prisma as unknown as PrismaService)
      .check()
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect((error as AppException).getStatus()).toBe(503);
  });
});
