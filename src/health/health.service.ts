import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      this.logger.warn({ err }, 'Health check: database unreachable');
      throw new AppException(
        'SERVICE_UNAVAILABLE',
        HttpStatus.SERVICE_UNAVAILABLE,
        'Database unavailable',
      );
    }
    return { status: 'ok' };
  }
}
