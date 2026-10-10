import { Body, Controller, Get, Headers, Param, Post, Query } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ZodResponse } from 'nestjs-zod';
import { PlacedOrderDto } from '../checkout/dto/checkout.dto';
import { ApiErrors } from '../common/decorators/api-errors.decorator';
import { Authenticated } from '../common/decorators/authenticated.decorator';
import { CurrentUser, type SessionUser } from '../common/decorators/current-user.decorator';
import { RequireVerifiedEmail } from '../common/decorators/verified-email.decorator';
import { IDEMPOTENCY_KEY_HEADER, QuoteNumberParamDto } from '../common/dto/common';
import {
  AcceptQuoteDto,
  CreateQuoteDto,
  CreateQuoteResponseDto,
  ListMyQuotesQueryDto,
  QuoteDetailDto,
  QuoteListDto,
} from './dto/quote.dto';
import { QuotesService } from './quotes.service';

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Post()
  @RequireVerifiedEmail()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'createQuote',
    summary:
      'Request for quote (signed in, verified email); linked to the user, replies go to the account email',
  })
  @ZodResponse({ status: 201, type: CreateQuoteResponseDto, description: 'RFQ received' })
  @ApiErrors(400, [404, 'NOT_FOUND: product/variant'], 429)
  create(@Body() body: CreateQuoteDto, @CurrentUser() user: SessionUser) {
    return this.quotes.create(body, user);
  }
}

@ApiTags('quotes')
@Authenticated()
@Controller('me/quotes')
export class MyQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ApiOperation({ operationId: 'listMyQuotes', summary: "The signed-in user's quotes" })
  @ZodResponse({ status: 200, type: QuoteListDto, description: 'Paginated quotes' })
  @ApiErrors(400)
  list(@CurrentUser() user: SessionUser, @Query() query: ListMyQuotesQueryDto) {
    return this.quotes.listMine(user, query);
  }

  @Get(':number')
  @ApiOperation({ operationId: 'getMyQuote', summary: 'Quote detail' })
  @ZodResponse({ status: 200, type: QuoteDetailDto, description: 'Quote' })
  @ApiErrors(404)
  get(@CurrentUser() user: SessionUser, @Param() params: QuoteNumberParamDto) {
    return this.quotes.getMine(user, params.number);
  }

  @Post(':number/accept')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    operationId: 'acceptMyQuote',
    summary:
      'Accept a QUOTED quote: creates an order at the quoted prices (→ Razorpay or bank transfer); the quote becomes CONVERTED',
  })
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    description: 'Same semantics as POST /checkout',
  })
  @ZodResponse({ status: 201, type: PlacedOrderDto, description: 'Order created' })
  @ApiErrors(
    400,
    [403, 'PAYMENT_METHOD_NOT_ALLOWED'],
    404,
    [409, 'QUOTE_NOT_ACCEPTABLE: not QUOTED / expired | OUT_OF_STOCK | IDEMPOTENCY_KEY_REUSED'],
    429,
  )
  accept(
    @CurrentUser() user: SessionUser,
    @Param() params: QuoteNumberParamDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: AcceptQuoteDto,
  ) {
    return this.quotes.accept(user, params.number, idempotencyKey, body);
  }
}
