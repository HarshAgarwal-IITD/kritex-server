import { Injectable } from '@nestjs/common';
import type { PlacedOrderDto } from '../checkout/dto/checkout.dto';
import { notImplemented } from '../common/exceptions/not-implemented';
import type {
  AcceptQuoteDto,
  CreateQuoteDto,
  CreateQuoteResponseDto,
  ListMyQuotesQueryDto,
  QuoteDetailDto,
  QuoteListDto,
} from './dto/quote.dto';

/**
 * B2B quotes (B2B-1). A user sees quotes they created while signed in, plus quotes whose email
 * matches their verified email.
 */
@Injectable()
export class QuotesService {
  create(_input: CreateQuoteDto, _userId?: string): Promise<CreateQuoteResponseDto> {
    return notImplemented('createQuote');
  }
  listMine(_userId: string, _query: ListMyQuotesQueryDto): Promise<QuoteListDto> {
    return notImplemented('listMyQuotes');
  }
  getMine(_userId: string, _number: string): Promise<QuoteDetailDto> {
    return notImplemented('getMyQuote');
  }
  accept(
    _userId: string,
    _number: string,
    _idempotencyKey: string | undefined,
    _input: AcceptQuoteDto,
  ): Promise<PlacedOrderDto> {
    return notImplemented('acceptMyQuote');
  }
}
