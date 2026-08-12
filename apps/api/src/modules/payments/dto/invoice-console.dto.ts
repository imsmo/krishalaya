// modules/payments/dto/invoice-console.dto.ts · zod .strict() params for W151/W152 (PC-56 TENANT-3c-1).
// Keyset only (opaque base64 cursor; never OFFSET) — W151 draws "‹ 1 2 … 49 ›" and a rows-per-page select, and both
// are a COUNT(*) per keystroke over a table that grows by a row per order (the roster rule, fifth application).
import { z } from 'zod';
import { CREDIT_NOTE_REASONS, MIN_REASON_CHARS } from '../domain/credit-note';

export const QueryInvoicesSchema = z.object({
  /** A GST period, YYYY-MM. Absent = the most recent invoices regardless of month. */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM').optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();
export type QueryInvoicesDto = z.infer<typeof QueryInvoicesSchema>;

export const Gstr1ExportSchema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period must be YYYY-MM'),
}).strict();
export type Gstr1ExportDto = z.infer<typeof Gstr1ExportSchema>;

export const IssueCreditNoteSchema = z.object({
  approvalId: z.string().uuid(),
  reasonCode: z.enum(CREDIT_NOTE_REASONS as unknown as [string, ...string[]]),
  reasonText: z.string().min(MIN_REASON_CHARS, `at least ${MIN_REASON_CHARS} characters`).max(2000),
}).strict();
export type IssueCreditNoteDto = z.infer<typeof IssueCreditNoteSchema>;

/** A stale or malformed cursor reads as the FIRST PAGE, never a 500 — a bookmarked invoice list is a normal thing. */
export function parseInvoiceCursor(raw?: string): { c: string; id: string } | null {
  if (!raw) return null;
  try {
    const [c, id] = Buffer.from(raw, 'base64').toString('utf8').split('|');
    if (!c || !id || Number.isNaN(Date.parse(c))) return null;
    return { c, id };
  } catch { return null; }
}
export function buildInvoiceCursor(row: { createdAt: string | Date; id: string }): string {
  const at = typeof row.createdAt === 'string' ? row.createdAt : row.createdAt.toISOString();
  return Buffer.from(`${at}|${row.id}`).toString('base64');
}
