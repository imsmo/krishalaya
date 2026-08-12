// modules/disputes/dto/query-dispute-console.dto.ts · W140's tab + keyset params (0139/TENANT-3b).
// Keyset only (opaque base64 cursor; never OFFSET) — the canon's "1 2" pager would need a COUNT(*) per keystroke
// over 34 disputes today and over millions at 15,000 tenants (the roster rule).
import { z } from 'zod';
import { DISPUTE_VIEWS } from '../domain/dispute-console';

export const QueryDisputeConsoleSchema = z.object({
  view: z.enum(DISPUTE_VIEWS as unknown as [string, ...string[]]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type QueryDisputeConsoleDto = z.infer<typeof QueryDisputeConsoleSchema>;

/** A cursor that cannot be parsed reads as the FIRST PAGE, never a 500: a stale bookmark is a normal event. */
export function parseDisputeCursor(raw?: string): { c: string; id: string } | null {
  if (!raw) return null;
  try {
    const [c, id] = Buffer.from(raw, 'base64').toString('utf8').split('|');
    if (!c || !id || Number.isNaN(Date.parse(c))) return null;
    return { c, id };
  } catch { return null; }
}
export function buildDisputeCursor(row: { createdAt: string | Date; id: string }): string {
  const at = typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString();
  return Buffer.from(`${at}|${row.id}`).toString('base64');
}

/** The refund gate is asked ABOUT AN AMOUNT — a gate with no figure would have nothing to compare to the threshold,
 *  which is exactly the bypass TENANT-3b closed on the resolve path. So the amount is required, not defaulted. */
export const RefundStateQuerySchema = z.object({
  amountMinor: z.string().regex(/^[1-9]\d{0,15}$/, 'must be a positive integer string of minor units'),
}).strict();
export type RefundStateQueryDto = z.infer<typeof RefundStateQuerySchema>;
