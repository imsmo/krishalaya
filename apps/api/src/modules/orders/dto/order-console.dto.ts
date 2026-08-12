// modules/orders/dto/order-console.dto.ts · W133's console query (PC-56 TENANT-3a)
import { z } from 'zod';
import { ORDER_VIEWS } from '../domain/order-money';

export const ConsoleOrdersSchema = z.object({
  view: z.enum(ORDER_VIEWS).optional(),          // the closed working-view vocabulary IS the filter
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type ConsoleOrdersDto = z.infer<typeof ConsoleOrdersSchema>;

/** "iso~id" keyset token. A malformed/stale bookmark reads as the FIRST page rather than a 500 — a saved link
 *  from last month must never break the worklist. */
export function parseOrderCursor(cursor: string | undefined): { c: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf('~');
  if (i <= 0 || i === cursor.length - 1) return null;
  return { c: cursor.slice(0, i), id: cursor.slice(i + 1) };
}
export function buildOrderCursor(row: { createdAt: string | Date; id: string }): string {
  return `${row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt}~${row.id}`;
}
