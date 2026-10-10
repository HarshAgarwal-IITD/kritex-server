import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { createQuerySchema } from './dto/create-query.dto';
import { QueriesService } from './queries.service';

describe('QueriesService', () => {
  const createdAt = new Date('2026-10-06T10:00:00.000Z');
  const prisma = {
    query: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };
  let service: QueriesService;

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        QueriesService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emitAsync: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(QueriesService);
  });

  it('create() persists the input with the account email and returns { id, createdAt ISO }', async () => {
    prisma.query.create.mockResolvedValue({ id: 'q1', createdAt });
    const input = createQuerySchema.parse({
      name: 'A',
      organization: '',
      email: 'ignored@elsewhere.co',
      requirements: 'r',
    });
    const user = {
      id: 'u1',
      email: 'a@b.co',
      name: 'A',
      role: 'CUSTOMER' as const,
      emailVerified: true,
    };

    await expect(service.create(input, user)).resolves.toEqual({
      id: 'q1',
      createdAt: '2026-10-06T10:00:00.000Z',
    });
    expect(prisma.query.create).toHaveBeenCalledWith({
      data: { name: 'A', organization: null, email: 'a@b.co', requirements: 'r' },
    });
  });

  it('list() returns newest first with ISO dates', async () => {
    prisma.query.findMany.mockResolvedValue([
      {
        id: 'q1',
        name: 'A',
        organization: null,
        email: 'a@b.co',
        requirements: 'r',
        status: 'NEW',
        createdAt,
      },
    ]);
    await expect(service.list()).resolves.toEqual([
      expect.objectContaining({ id: 'q1', createdAt: '2026-10-06T10:00:00.000Z' }),
    ]);
    expect(prisma.query.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' } });
  });
});

describe('createQuerySchema', () => {
  const valid = { name: 'A', email: 'a@b.co', requirements: 'r' };

  it('trims strings and normalises organization to null', () => {
    expect(
      createQuerySchema.parse({ ...valid, name: '  A ', email: ' a@b.co ', organization: '  ' }),
    ).toEqual({ ...valid, organization: null });
    expect(createQuerySchema.parse({ ...valid, organization: ' Kritex ' }).organization).toBe(
      'Kritex',
    );
  });

  it('enforces length limits', () => {
    expect(createQuerySchema.safeParse({ ...valid, name: 'x'.repeat(201) }).success).toBe(false);
    expect(createQuerySchema.safeParse({ ...valid, name: 'x'.repeat(200) }).success).toBe(true);
    expect(createQuerySchema.safeParse({ ...valid, requirements: 'x'.repeat(5001) }).success).toBe(
      false,
    );
    expect(createQuerySchema.safeParse({ ...valid, organization: 'x'.repeat(201) }).success).toBe(
      false,
    );
    expect(
      createQuerySchema.safeParse({ ...valid, email: `${'x'.repeat(196)}@b.co` }).success,
    ).toBe(false);
  });

  it('rejects invalid emails and blank required fields', () => {
    expect(createQuerySchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
    expect(createQuerySchema.safeParse({ ...valid, requirements: '   ' }).success).toBe(false);
  });
});
