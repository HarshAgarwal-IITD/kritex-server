import { EventEmitter2 } from '@nestjs/event-emitter';
import { Injectable } from '@nestjs/common';
import type { Query, QueryStatus } from '@prisma/client';
import type { SessionUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateQueryDto } from './dto/create-query.dto';
import type { CreateQueryResponseDto } from './dto/create-query.dto';
import type { QueryDto } from './dto/query.dto';

function toQueryDto(query: Query): QueryDto {
  return { ...query, createdAt: query.createdAt.toISOString() };
}

/** Emitted after a contact / tender enquiry is stored: `{ queryId }`. */
export const QUERY_CREATED_EVENT = 'query.created';

@Injectable()
export class QueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** The reply address is the signed-in user's verified email; a body `email` is ignored. */
  async create(input: CreateQueryDto, user: SessionUser): Promise<CreateQueryResponseDto> {
    const query = await this.prisma.query.create({
      data: {
        name: input.name,
        organization: input.organization ?? null,
        email: user.email,
        requirements: input.requirements,
      },
    });
    // Staff alert (NotificationsService); a failing listener never fails the enquiry.
    try {
      await this.events.emitAsync(QUERY_CREATED_EVENT, { queryId: query.id });
    } catch {
      // logged by the listener
    }
    return { id: query.id, createdAt: query.createdAt.toISOString() };
  }

  async list(): Promise<QueryDto[]> {
    const queries = await this.prisma.query.findMany({ orderBy: { createdAt: 'desc' } });
    return queries.map(toQueryDto);
  }

  /** P2025 (unknown id) becomes 404 NOT_FOUND in the global filter. */
  async updateStatus(id: string, status: QueryStatus): Promise<QueryDto> {
    const query = await this.prisma.query.update({ where: { id }, data: { status } });
    return toQueryDto(query);
  }
}
