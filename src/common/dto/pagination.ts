import { z } from 'zod';

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

/** `?page=&limit=` (1-based page; limit 1..100, default 20). Spread into list query schemas. */
export const paginationQueryShape = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
};

export const paginationQuerySchema = z.object(paginationQueryShape);
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Paginated response envelope: `{ items, page, limit, total }` (`total` = all matching rows). */
export function paginatedSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    limit: z.number().int().min(1).max(MAX_PAGE_LIMIT),
    total: z.number().int().nonnegative(),
  });
}

/** Non-paginated list envelope: `{ items }` (an object, so fields can be added later). */
export function listSchema<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item) });
}
