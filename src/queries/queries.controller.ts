import { Body, Controller, Get, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ADMIN_API_KEY_SECURITY, AdminApiKeyGuard } from '../common/guards/admin-api-key.guard';
import { CreateQueryDto, CreateQueryResponseDto } from './dto/create-query.dto';
import { QueryDto } from './dto/query.dto';
import { QueriesService } from './queries.service';

@ApiTags('queries')
@Controller('queries')
export class QueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'createQuery',
    summary: 'Submit a contact / tender inquiry (public)',
  })
  @ZodResponse({ status: HttpStatus.CREATED, type: CreateQueryResponseDto, description: 'Created' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'TOO_MANY_REQUESTS' })
  create(@Body() body: CreateQueryDto) {
    return this.queries.create(body);
  }

  @Get()
  @UseGuards(AdminApiKeyGuard)
  @ApiBearerAuth(ADMIN_API_KEY_SECURITY)
  @ApiOperation({
    operationId: 'listQueries',
    summary: 'List submitted inquiries, newest first (admin)',
  })
  @ZodResponse({ status: HttpStatus.OK, type: [QueryDto], description: 'All queries' })
  @ApiResponse({ status: 401, type: ErrorResponseDto, description: 'UNAUTHORIZED' })
  list() {
    return this.queries.list();
  }
}
