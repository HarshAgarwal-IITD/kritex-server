import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string().meta({ example: 'VALIDATION_ERROR' }),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;

/** Contract error shape. Every non-2xx response from the API uses it. */
export class ErrorResponseDto extends createZodDto(errorResponseSchema) {}
