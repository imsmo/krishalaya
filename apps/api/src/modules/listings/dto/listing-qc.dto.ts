// modules/listings/dto/listing-qc.dto.ts · W123 console + W126/W127 QC (PC-56 TENANT-2a)
import { z } from 'zod';
import { LISTING_STATUSES } from '../domain/listing.state';

export const QcRejectSchema = z.object({
  reasonCode: z.string().min(1).max(80),   // validated against the lookup vocabulary in the SERVICE, in-tx
}).strict();
export type QcRejectDto = z.infer<typeof QcRejectSchema>;

export const ConsoleListSchema = z.object({
  status: z.enum(LISTING_STATUSES).optional(),     // the closed vocabulary IS the filter — no free-text status
  cursor: z.string().max(200).optional(),          // "createdAtIso_id" keyset token, parsed below
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export type ConsoleListDto = z.infer<typeof ConsoleListSchema>;

/** Cursor codec: "iso~id". Any malformed token reads as "first page" rather than a 500 — a stale bookmark must
 *  never break the console. */
export function parseConsoleCursor(cursor: string | undefined): { c: string; id: string } | null {
  if (!cursor) return null;
  const i = cursor.indexOf('~');
  if (i <= 0 || i === cursor.length - 1) return null;
  return { c: cursor.slice(0, i), id: cursor.slice(i + 1) };
}
export function buildConsoleCursor(row: { createdAt: string | Date; id: string }): string {
  return `${row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt}~${row.id}`;
}
