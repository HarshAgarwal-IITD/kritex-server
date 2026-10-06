import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createQuerySchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Optional; an empty (or whitespace-only) string is stored as null. */
  organization: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((value) => (value ? value : null)),
  // `.email()` after `.trim()` so surrounding whitespace is stripped before the format check
  // (zod 4's top-level `z.email()` would check first, then trim).
  email: z.string().trim().max(200).email(),
  requirements: z.string().trim().min(1).max(5000),
});

/** Body of `POST /api/v1/queries` (contact / tender inquiry form). */
export class CreateQueryDto extends createZodDto(createQuerySchema) {}

export const createQueryResponseSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
});

export class CreateQueryResponseDto extends createZodDto(createQueryResponseSchema) {}
