// modules/audit/domain/audit.cursor.ts · PURE keyset-cursor codec for the audit trail (no I/O).
//
// [PC-56 TENANT-9a · F-7] THE TRAIL SKIPPED ROWS. The cursor was `createdAt.toISOString()` — a JS Date, MILLISECONDS — and
// the predicate compared it with a MICROSECOND column: the survey's probe wrote four rows in one millisecond and page two
// showed one of the three left (`probe.b` and `probe.c` were never shown) — on the one screen whose claim is completeness.
// The cursor now carries the instant AS THE DATABASE PRINTED IT (six fractional digits, `AuditRow.cursorTs`) and the id;
// it never passes through a Date. A malformed or legacy (millisecond) cursor decodes to "no cursor" (page one), never a
// guess. Shared shape with identity's `kyc-cursor` (8b's fix).
import { decodeKeyset, encodeKeyset, BIGINT_RE } from '../../../shared/pagination/us-keyset';

export interface AuditCursor { ts: string; id: string; }

export function encodeAuditCursor(cursorTs: string, id: string): string {
  return encodeKeyset(cursorTs, id);
}

export function decodeAuditCursor(cursor?: string): AuditCursor | undefined {
  return decodeKeyset(cursor, BIGINT_RE);
}
