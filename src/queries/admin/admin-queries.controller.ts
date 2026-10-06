import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import { notImplemented } from '../../common/exceptions/not-implemented';
import { QueryDto } from '../dto/query.dto';
import { UpdateQueryStatusDto } from '../dto/update-query-status.dto';

/**
 * Session-authenticated enquiry inbox. Stays a 501 stub until AUTH-2 lands (so enquiry PII is
 * never exposed without the AuthGuard); then it replaces the API-key `GET /queries`, which is
 * kept unchanged until the website has migrated (additive-only).
 */
@ApiTags('admin-queries')
@Roles('STAFF', 'ADMIN')
@Controller('admin/queries')
export class AdminQueriesController {
  @Get()
  @ApiOperation({
    operationId: 'adminListQueries',
    summary: 'List enquiries, newest first (same shape as GET /queries)',
  })
  @ZodResponse({ status: 200, type: [QueryDto], description: 'All queries' })
  list(): Promise<QueryDto[]> {
    return notImplemented('adminListQueries');
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'adminUpdateQuery', summary: 'Update enquiry status' })
  @ZodResponse({ status: 200, type: QueryDto, description: 'Updated query' })
  @ApiErrors(400, 404)
  update(@Param() _params: IdParamDto, @Body() _body: UpdateQueryStatusDto): Promise<QueryDto> {
    return notImplemented('adminUpdateQuery');
  }
}
