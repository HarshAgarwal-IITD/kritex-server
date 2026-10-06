import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { ApiErrors } from '../../common/decorators/api-errors.decorator';
import { CurrentUser, type SessionUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { IdParamDto } from '../../common/dto/common';
import {
  AdminQuoteDetailDto,
  AdminQuoteListDto,
  ListAdminQuotesQueryDto,
  RejectQuoteDto,
  RespondQuoteDto,
} from '../dto/quote.dto';
import { AdminQuotesService } from './admin-quotes.service';

@ApiTags('admin-quotes')
@Roles('STAFF', 'ADMIN')
@Controller('admin/quotes')
export class AdminQuotesController {
  constructor(private readonly quotes: AdminQuotesService) {}

  @Get()
  @ApiOperation({ operationId: 'adminListQuotes', summary: 'Quotes inbox' })
  @ZodResponse({ status: 200, type: AdminQuoteListDto, description: 'Paginated quotes' })
  @ApiErrors(400)
  list(@Query() query: ListAdminQuotesQueryDto) {
    return this.quotes.list(query);
  }

  @Get(':id')
  @ApiOperation({ operationId: 'adminGetQuote', summary: 'Quote detail' })
  @ZodResponse({ status: 200, type: AdminQuoteDetailDto, description: 'Quote' })
  @ApiErrors(404)
  get(@Param() params: IdParamDto) {
    return this.quotes.get(params.id);
  }

  @Post(':id/respond')
  @ApiOperation({
    operationId: 'adminRespondQuote',
    summary: 'Send prices + validity (status → QUOTED; re-respond allowed while QUOTED)',
  })
  @ZodResponse({ status: 200, type: AdminQuoteDetailDto, description: 'Quoted' })
  @ApiErrors(400, 404, [409, 'INVALID_STATUS: not REQUESTED/QUOTED'], [422, 'QUOTE_ITEMS_UNPRICED'])
  respond(
    @Param() params: IdParamDto,
    @Body() body: RespondQuoteDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.quotes.respond(params.id, body, user?.id);
  }

  @Post(':id/reject')
  @ApiOperation({ operationId: 'adminRejectQuote', summary: 'Decline an RFQ (status → REJECTED)' })
  @ZodResponse({ status: 200, type: AdminQuoteDetailDto, description: 'Rejected' })
  @ApiErrors(400, 404, [409, 'INVALID_STATUS'])
  reject(
    @Param() params: IdParamDto,
    @Body() body: RejectQuoteDto,
    @CurrentUser() user: SessionUser | undefined,
  ) {
    return this.quotes.reject(params.id, body, user?.id);
  }
}
