// shared/pagination/us-keyset.ts · PC-56 TENANT-9a · A MICROSECOND-SAFE KEYSET CURSOR (F-7, 8b's fix).
//
// The review queue's cursor was `created_at.toISOString()` — a JS Date, MILLISECONDS — compared against a MICROSECOND
// column: rows written in the same millisecond as a page boundary were skipped (the survey's probe: four rows in one
// millisecond, page two showed one of the three left). The cursor now carries the instant AS THE DATABASE PRINTED IT
// (`to_char(… 'US')`, six fractional digits) and SQL compares it as `timestamptz` — it never passes through a Date.
export interface KeysetCursor { ts: string; id: string }

/** `2026-10-04T10:00:00.123456Z` — exactly six fractional digits, UTC. */
const US_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function encodeKeyset(ts: string, id: string): string {
  if (!US_INSTANT.test(ts)) throw new Error(`keyset: '${ts}' is not a microsecond instant`);
  return Buffer.from(`${ts}|${id}`, 'utf8').toString('base64url');
}

/** Defensive: anything malformed is "no cursor" (page one), never a throw and never a millisecond guess. */
export function decodeKeyset(raw: string | null | undefined, idPattern: RegExp): KeysetCursor | undefined {
  if (!raw) return undefined;
  let s: string;
  try { s = Buffer.from(raw, 'base64url').toString('utf8'); } catch { return undefined; }
  const i = s.indexOf('|');
  if (i < 0) return undefined;
  const ts = s.slice(0, i); const id = s.slice(i + 1);
  if (!US_INSTANT.test(ts) || !idPattern.test(id)) return undefined;
  return { ts, id };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const BIGINT_RE = /^\d{1,19}$/;

/** The SQL that prints a column in the cursor's own format. */
export const US_SQL = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
