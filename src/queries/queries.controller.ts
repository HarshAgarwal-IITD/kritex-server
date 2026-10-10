import { Body, Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RequireVerifiedEmail } from '../common/decorators/verified-email.decorator';
import { CreateQueryDto, CreateQueryResponseDto } from './dto/create-query.dto';
import { QueryDto } from './dto/query.dto';
import { QueriesService } from './queries.service';

@ApiTags('queries')
@Controller('queries')
export class QueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Post()
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'createQuery',
    summary:
      'Submit a contact / tender inquiry (signed in, verified email; replies go to the account email)',
  })
  @ZodResponse({ status: HttpStatus.CREATED, type: CreateQueryResponseDto, description: 'Created' })
  @ApiResponse({ status: 400, type: ErrorResponseDto, description: 'VALIDATION_ERROR' })
  @ApiResponse({ status: 429, type: ErrorResponseDto, description: 'TOO_MANY_REQUESTS' })
  create(@Body() body: CreateQueryDto, @CurrentUser() user: SessionUser) {
    return this.queries.create(body, user);
  }

  @Get()
  @Roles('STAFF', 'ADMIN')
  @ApiOperation({
    operationId: 'listQueries',
    summary:
      'List submitted inquiries, newest first (STAFF/ADMIN session; same as adminListQueries)',
  })
  @ZodResponse({ status: HttpStatus.OK, type: [QueryDto], description: 'All queries' })
  list() {
    return this.queries.list();
  }
}
