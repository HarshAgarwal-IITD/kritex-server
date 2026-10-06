import { Injectable } from '@nestjs/common';
import { notImplemented } from '../../common/exceptions/not-implemented';
import type {
  AdminQuoteDetailDto,
  AdminQuoteListDto,
  ListAdminQuotesQueryDto,
  RejectQuoteDto,
  RespondQuoteDto,
} from '../dto/quote.dto';

@Injectable()
export class AdminQuotesService {
  list(_query: ListAdminQuotesQueryDto): Promise<AdminQuoteListDto> {
    return notImplemented('adminListQuotes');
  }
  get(_id: string): Promise<AdminQuoteDetailDto> {
    return notImplemented('adminGetQuote');
  }
  /** Prices every item, sets validUntil, status → QUOTED, emits `quote.responded`. */
  respond(_id: string, _input: RespondQuoteDto, _actorId?: string): Promise<AdminQuoteDetailDto> {
    return notImplemented('adminRespondQuote');
  }
  reject(_id: string, _input: RejectQuoteDto, _actorId?: string): Promise<AdminQuoteDetailDto> {
    return notImplemented('adminRejectQuote');
  }
}
