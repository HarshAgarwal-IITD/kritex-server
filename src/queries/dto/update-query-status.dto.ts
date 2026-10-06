import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { queryStatusSchema } from './query.dto';

export const updateQueryStatusSchema = z.object({ status: queryStatusSchema });

/** Body of `PATCH /api/v1/admin/queries/:id`. */
export class UpdateQueryStatusDto extends createZodDto(updateQueryStatusSchema) {}
