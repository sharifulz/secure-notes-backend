import { z } from 'zod';

const integer = (fallback: number, max: number) => z.preprocess(
  value => value === undefined ? fallback : value,
  z.union([z.number(), z.string().regex(/^\d+$/)]).pipe(z.coerce.number<string | number>().int().min(1).max(max)),
);
export const paginationSchema = z.object({
  page: integer(1, 100000), limit: integer(10, 100),
}).strict();
export type Page = z.infer<typeof paginationSchema>;
export const sortNewest = { createdAt: -1, _id: -1 } as const;
export const offset = (page: Page) => (page.page - 1) * page.limit;
export function paginated<T>(data: T[], total: number, page: Page) {
  return { success: true, data, pagination: {
    ...page, total, totalPages: Math.ceil(total / page.limit),
    hasNext: page.page * page.limit < total,
  } };
}
