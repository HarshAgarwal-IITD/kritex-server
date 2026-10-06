import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { Public } from '../common/decorators/public.decorator';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { HealthResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('health')
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ operationId: 'getHealth', summary: 'Liveness + database check' })
  @ZodResponse({ status: 200, type: HealthResponseDto, description: 'API and database are up' })
  @ApiResponse({ status: 503, type: ErrorResponseDto, description: 'Database unavailable' })
  check() {
    return this.health.check();
  }
}
