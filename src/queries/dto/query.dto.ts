import { QueryStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const queryStatusSchema = z.enum(QueryStatus);

export const querySchema = z.object({
  id: z.string(),
  name: z.string(),
  organization: z.string().nullable(),
  email: z.string(),
  requirements: z.string(),
  status: queryStatusSchema,
  createdAt: z.iso.datetime(),
});

/** A stored contact / tender inquiry, as returned to admins. */
export class QueryDto extends createZodDto(querySchema) {}
