// core/database/pg-date.ts · the ONE correct way to read a PostgreSQL `date` in this codebase.
//
// **Why this file exists, and why it lives in core rather than in a module.** `node-pg` parses PostgreSQL `date`
// (oid 1082) into a JS `Date` at **LOCAL midnight**, and this repository sets no type parser anywhere
// (`grep -r setTypeParser apps/` → zero hits) and pins no `TZ`. So a column holding `2026-07-13` arrives as
// `Mon Jul 13 2026 00:00:00 GMT+0530` on a box in India, and the two obvious one-liners are BOTH wrong:
//
//   • `String(v).slice(0, 10)`            → `"Mon Jul 13"`. A label nobody can parse. (Live in this codebase.)
//   • `v.toISOString().slice(0, 10)`      → `"2026-07-12"` under any timezone AHEAD of UTC — Asia/Kolkata, the launch
//                                           market. A DAY EARLY. (Live in this codebase, 23 times.)
//
// Reading the LOCAL Y-M-D components is the only reading that returns the date PostgreSQL actually holds, in every
// timezone, which is the whole point: a date column is a calendar day, not an instant, and it must survive the round
// trip regardless of where the process runs (Rule Zero — a money path that is only correct on a UTC box caps this
// platform to UTC boxes).
//
// [PC-56 TENANT-6b-1] Promoted here from `modules/logistics/repositories/freight-invoice.repository.ts`, where
// TENANT-5c wrote it and deferred the sweep. The sweep is this wave: every site where a mis-mapped date feeds a WRITE
// PREDICATE or a MONEY/ELIGIBILITY DECISION now uses these functions. The proven defect that forced it: the dairy
// bill-attach `UPDATE ... WHERE collected_on = $2::date` matched ZERO rows under IST, so a farmer's pours were paid,
// left unstamped, and paid AGAIN the next cycle (see `dairy/__tests__/tenant6b-money.integration.spec.ts`).
//
// USE THIS, not a hand-rolled conversion. New code that formats a `date` column any other way is a defect, and
// `core/database/__tests__/pg-date.spec.ts` sweeps the repository for the wrong shapes.

/** The local-date parts of a JS Date, zero-padded — never an instant, never an offset. */
function ymd(v: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}

/**
 * A `date` column as the `YYYY-MM-DD` string the rest of the platform speaks. Returns `null` for SQL NULL.
 *
 * Accepts what node-pg can hand back for a date-ish column: a `Date` (the normal case), an already-formatted string
 * (if a type parser is ever installed, or the column was cast with `::text` in SQL), or null/undefined. A string is
 * truncated to 10 characters, which is correct for both `YYYY-MM-DD` and `YYYY-MM-DDTHH:mm:ss` forms.
 */
export function pgDateOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return ymd(v);
  return String(v).slice(0, 10);
}

/** As `pgDateOrNull`, for a NOT NULL column. Empty string for null keeps the old call sites' shape — a caller that
 *  wants the failure to be loud should assert on the column's nullability, which the schema already does. */
export function pgDate(v: unknown): string {
  return pgDateOrNull(v) ?? '';
}

/**
 * The same reading for a `timestamptz` whose CALENDAR DAY is what matters (an "as of" day, a bucket key).
 *
 * Kept separate and named for the intent, because the two cases fail differently: a `date` has no time zone at all
 * and must round-trip exactly, while a `timestamptz` is a real instant whose local day genuinely depends on where you
 * stand. Anything that groups instants into days across tenants in different zones must decide WHOSE day it is —
 * that decision belongs in SQL (`AT TIME ZONE`), not here.
 */
export function pgLocalDay(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return ymd(v);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : null;
}
