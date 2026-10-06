import { Injectable } from '@nestjs/common';
import type { Query } from '@prisma/client';
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

  async create(input: CreateQueryDto): Promise<CreateQueryResponseDto> {
    const query = await this.prisma.query.create({
      data: {
        name: input.name,
        organization: input.organization ?? null,
        email: input.email,
        requirements: input.requirements,
      },
    });
    return { id: query.id, createdAt: query.createdAt.toISOString() };
  }

  async list(): Promise<QueryDto[]> {
    const queries = await this.prisma.query.findMany({ orderBy: { createdAt: 'desc' } });
    return queries.map(toQueryDto);
  }
}
