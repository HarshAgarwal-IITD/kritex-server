import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const healthResponseSchema = z.object({ status: z.literal('ok') });

export class HealthResponseDto extends createZodDto(healthResponseSchema) {}
