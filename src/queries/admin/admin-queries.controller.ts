import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import { QueryDto } from '../dto/query.dto';
import { UpdateQueryStatusDto } from '../dto/update-query-status.dto';
import { QueriesService } from '../queries.service';

/** Session-authenticated enquiry inbox (replaces the old API-key `GET /queries`, kept as an alias). */
@ApiTags('admin-queries')
@Roles('STAFF', 'ADMIN')
@Controller('admin/queries')
export class AdminQueriesController {
  constructor(private readonly queries: QueriesService) {}

  @Get()
  @ApiOperation({
    operationId: 'adminListQueries',
    summary: 'List enquiries, newest first (same shape as GET /queries)',
  })
  @ZodResponse({ status: 200, type: [QueryDto], description: 'All queries' })
  list(): Promise<QueryDto[]> {
    return this.queries.list();
  }

  @Patch(':id')
  @ApiOperation({ operationId: 'adminUpdateQuery', summary: 'Update enquiry status' })
  @ZodResponse({ status: 200, type: QueryDto, description: 'Updated query' })
  @ApiErrors(400, 404)
  update(@Param() params: IdParamDto, @Body() body: UpdateQueryStatusDto): Promise<QueryDto> {
    return this.queries.updateStatus(params.id, body.status);
  }
}
