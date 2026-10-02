// modules/requirements/domain/cursor.ts · PC-56 TENANT-11d · F-25 (copied from group-lots/domain/cursor.ts, 11c — not imported across
// modules) — THE MICROSECOND CURSOR. PURE.
//
// The requirement list and the responses list used to mint their cursor from `createdAt.toISOString()` — a JS Date,
// milliseconds — and compare it against a `timestamptz` column that holds MICROSECONDS, so a row written in the same
// millisecond as a page's last row (but earlier in microseconds) was skipped at every page break. The cursor is now minted
// from the column's own TEXT (`created_at::text`, every digit Postgres stored) and compared as `$c::timestamptz`.
//
// W131's "Need by ▴" sort keys on (COALESCE(need_by, 'infinity'), id): its cursor carries the DATE (or `infinity` for a
// requirement with no need-by, which sorts last) and the id. Encoded `base64url(<kind>:<raw>|<id>)`; decoding refuses
// anything that is not the right shape, so a hand-edited cursor is "no cursor", never a SQL error or an injection surface.
const TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;
const DAY = /^(\d{4}-\d{2}-\d{2}|infinity)$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export type CursorKind = 'created' | 'need_by';
export interface Cursor { kind: CursorKind; c: string; id: string }

export function encodeCursor(kind: CursorKind, raw: string | null | undefined, id: string): string | null {
  if (!raw || !UUID.test(id)) return null;
  if (kind === 'created' ? !TS.test(raw) : !DAY.test(raw)) return null;
  return Buffer.from(`${kind}:${raw}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(c: string | null | undefined, kind: CursorKind = 'created'): Cursor | undefined {
  if (!c || c.length > 200) return undefined;
  let s: string;
  try { s = Buffer.from(c, 'base64url').toString('utf8'); } catch { return undefined; }
  const colon = s.indexOf(':');
  const bar = s.lastIndexOf('|');
  if (colon < 0 || bar < colon) return undefined;
  const k = s.slice(0, colon); const raw = s.slice(colon + 1, bar); const id = s.slice(bar + 1);
  if (k !== kind || !UUID.test(id)) return undefined;
  if (kind === 'created' ? !TS.test(raw) : !DAY.test(raw)) return undefined;
  return { kind, c: raw, id };
}
