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

@Injectable()
export class QueriesService {
  constructor(private readonly prisma: PrismaService) {}

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
