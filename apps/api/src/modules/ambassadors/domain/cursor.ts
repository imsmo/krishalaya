// modules/ambassadors/domain/cursor.ts · PC-56 TENANT-10a · F-17 — THE MICROSECOND CURSOR. PURE.
//
// Every keyset list in this module used to mint its cursor from `createdAt.toISOString()` — a JS Date, milliseconds — and
// compare it against a `timestamptz` column that holds MICROSECONDS. A row written in the same millisecond as the page's
// last row but earlier in microseconds compared as `created_at < cursor` FALSE and `created_at = cursor` FALSE, so it was
// skipped at every page boundary — on the earnings ledger that hid unpaid rows from the admin view (the read-side twin of
// DEV-55). The cursor is now minted from the column's own TEXT (`created_at::text`, every digit Postgres stored) and
// compared as `created_at < $c::timestamptz`, which round-trips exactly.
//
// The encoded form is `base64url(<raw>|<id>)`. Decoding refuses anything that is not a timestamp-shaped string and a UUID,
// so a hand-edited cursor is "no cursor", never a SQL error and never an injection surface.
const TS = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)?$/;
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface Cursor { c: string; id: string }

export function encodeCursor(raw: string | null | undefined, id: string): string | null {
  if (!raw || !TS.test(raw) || !UUID.test(id)) return null;
  return Buffer.from(`${raw}|${id}`, 'utf8').toString('base64url');
}

export function decodeCursor(c: string | null | undefined): Cursor | undefined {
  if (!c || c.length > 200) return undefined;
  let s: string;
  try { s = Buffer.from(c, 'base64url').toString('utf8'); } catch { return undefined; }
  const i = s.lastIndexOf('|');
  if (i < 0) return undefined;
  const raw = s.slice(0, i); const id = s.slice(i + 1);
  return TS.test(raw) && UUID.test(id) ? { c: raw, id } : undefined;
}

/** A keyset cursor over a NON-timestamp sort key (the roster's "Owed ▾": `owed_minor|id`). Integer minor units only. */
export function encodeAmountCursor(amountMinor: string, id: string): string | null {
  if (!/^\d{1,19}$/.test(amountMinor) || !UUID.test(id)) return null;
  return Buffer.from(`${amountMinor}|${id}`, 'utf8').toString('base64url');
}
export function decodeAmountCursor(c: string | null | undefined): { amount: string; id: string } | undefined {
  if (!c || c.length > 200) return undefined;
  let s: string;
  try { s = Buffer.from(c, 'base64url').toString('utf8'); } catch { return undefined; }
  const [amount, id, extra] = s.split('|');
  return extra === undefined && /^\d{1,19}$/.test(amount ?? '') && UUID.test(id ?? '') ? { amount, id } : undefined;
}
