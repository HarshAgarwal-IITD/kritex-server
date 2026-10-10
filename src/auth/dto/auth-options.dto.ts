import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const authOptionsSchema = z.object({
  google: z.boolean().meta({ description: 'true when "Continue with Google" is configured' }),
});
export class AuthOptionsDto extends createZodDto(authOptionsSchema) {}
