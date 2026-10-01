// modules/audit/domain/auditor-realm.ts · PC-56 TENANT-9c · THE AUDITOR REALM's pure rules (no I/O) — windows in the
// cooperative's own days, the fiscal year as DECLARED data, the read-log vocabulary, and the canon elements refused by name.
//
// WHY CIVIL DAYS AND NOT INSTANTS. The trail's day bounds were `${from}T00:00:00.000Z` — UTC days — and the page printed a
// hard "UTC" (F-9). An Anand cooperative's "13 Jul" starts at 18:30 UTC on the 12th. Every window here is a pair of CIVIL
// days (`YYYY-MM-DD`) in the cooperative's zone (`countries.timezone`); SQL turns a day into its instant with
// `(day)::timestamp AT TIME ZONE zone`, so no JavaScript Date ever guesses an offset.
//
// WHY THE FISCAL YEAR IS A REFUSAL WHEN UNDECLARED (F-17, rule zero). "FY 2026-27" compiled in as April–March is Indian law
// applied to a Bangladeshi (July–June) cooperative. 0181 declares it per country (IN = 4) and lets a tenant override it; a
// tenant whose year nobody declared gets `FY_NOT_DECLARED` and the page says so — never an assumed April.

/** The canon's own bound: *"filter by date (bounded, max 92 days per query)"* (W200, W436). */
export const MAX_LIVE_WINDOW_DAYS = 92;
/** W201: *"Bounded periods (max 1 FY per export)"* — a year is at most 366 days. */
export const MAX_EXPORT_WINDOW_DAYS = 366;

/** 0181's `audit_read_purposes`, in its order. The spec reads the migration and asserts the two lists are equal. */
export const READ_PURPOSES = [
  'auditor_overview', 'trail_page', 'trail_entry', 'trail_reveal', 'ledger_page', 'compliance_pack', 'export_list', 'export_enqueue',
] as const;
export type ReadPurpose = (typeof READ_PURPOSES)[number];

/** Canon promises this platform cannot back — each a sentence on the page, never a fake (the 9a list's shape). */
export const AUDITOR_REFUSED_BY_NAME = [
  'platformSignature',     // W201/W437 "platform signature", "verifiable", manifest key — no signing key (founder-physical)
  'sharedChain',           // W200/W437 "hash chain intact end to end" — platform accounts are striped across tenants (ADMIN-6)
  'recordedCheck',         // W200 "checked 02:10 today" — no recorded tenant verification exists; the check runs on demand
  'reversalsLinked',       // W200 "all reversals linked" — no reversal link column on ledger_transactions
  'numberingGaps',         // W200 "no gaps in numbering" — ids are bigserial; gaps exist by design
  'exceptionRegister',     // W200 "Open exceptions" — no exception register
  'accessWindow',          // W200 "expires 31 Aug 2026", engagement letter, notice of change — no expiry column, no event
  'firmIdentity',          // "CA R. Mehta & Associates" — no engagement record names a firm
  'pdfWatermark',          // W201/W437 "PDF (watermarked)" — the plane writes CSV only; no watermark exists
  'byteIdentical',         // W201 "re-run gives byte-identical output" — not claimed over live tables
  'irn',                   // W437 "IRN/ack per invoice" — no e-invoicing integration writes `trade_invoices.irn`
  'gstPayableTie',         // W437 "ties exactly to the gst_payable platform account" — a platform account shared by every tenant
  'ekycBlocked',           // W437 "59 e-KYC-blocked" — no link from a scheme application to an eKYC verdict
  'signAttest',            // W437 "Sign & attest" — no key, no attestation record
  'quarterClose',          // W437 "generate automatically at quarter-close" — the pack is computed on read, not generated
  'retry',                 // W2500–W2502 "Retry" — a page load, not a mutation
] as const;
export type AuditorRefusal = (typeof AUDITOR_REFUSED_BY_NAME)[number];

/** The standing note every auditor export receipt carries (W201 "sealed evidence bag" — the half that is true). */
export const UNSIGNED_NOTE = 'unsigned — no signing key on this platform (founder-physical); the sha256 on this receipt is a content hash, not a signature';

/* ------------------------------------------------------------------------------------------------------------ */
/* CIVIL DAYS                                                                                                   */
/* ------------------------------------------------------------------------------------------------------------ */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day (`2026-02-30` is not one). */
export function isCivilDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = DAY.exec(s);
  if (!m) return false;
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** Day arithmetic on the calendar (UTC used only as a calendar, never as the cooperative's clock). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Inclusive count of days from `a` to `b` (`a == b` → 1). */
export function daysInclusive(a: string, b: string): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000) + 1;
}

export type WindowRefusal = 'DATE_INVALID' | 'WINDOW_ORDER' | 'WINDOW_TOO_WIDE';
export type ResolvedWindow =
  | { ok: true; from: string; to: string; days: number; defaulted: boolean }
  | { ok: false; code: WindowRefusal; maxDays: number };

/**
 * The window a read runs over, in the cooperative's days. Both ends inclusive. Unset ends default to a window ENDING TODAY
 * of at most `maxDays`, starting no earlier than `floor` (the fiscal year's first day, when declared — W436 *"defaults to
 * the current FY for partition pruning"*). A window wider than the bound is REFUSED, never clipped: a clipped window prints
 * figures for a period the reader did not ask about.
 */
export function resolveWindow(fromRaw: string | null | undefined, toRaw: string | null | undefined, today: string, maxDays: number, floor?: string | null): ResolvedWindow {
  const from = (fromRaw ?? '').trim(); const to = (toRaw ?? '').trim();
  if ((from && !isCivilDay(from)) || (to && !isCivilDay(to))) return { ok: false, code: 'DATE_INVALID', maxDays };
  const end = to || today;
  let start = from;
  let defaulted = false;
  if (!start) {
    defaulted = true;
    start = addDays(end, -(maxDays - 1));
    if (floor && isCivilDay(floor) && floor > start && floor <= end) start = floor;
  }
  if (start > end) return { ok: false, code: 'WINDOW_ORDER', maxDays };
  const days = daysInclusive(start, end);
  if (days > maxDays) return { ok: false, code: 'WINDOW_TOO_WIDE', maxDays };
  return { ok: true, from: start, to: end, days, defaulted: defaulted || !to };
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE FISCAL YEAR (declared, never assumed)                                                                    */
/* ------------------------------------------------------------------------------------------------------------ */

export type FiscalYear =
  | { declared: true; startMonth: number; start: string; end: string; startYear: number; endYear: number }
  | { declared: false; code: 'FY_NOT_DECLARED' };

/** The fiscal year `day` falls in, for a year that starts on the 1st of `startMonth` (1–12). January → the calendar year. */
export function fiscalYearOf(day: string, startMonth: number | null | undefined): FiscalYear {
  if (!Number.isInteger(startMonth) || (startMonth as number) < 1 || (startMonth as number) > 12 || !isCivilDay(day)) return { declared: false, code: 'FY_NOT_DECLARED' };
  const sm = startMonth as number;
  const [y, m] = day.split('-').map(Number);
  const startYear = m >= sm ? y : y - 1;
  const start = `${startYear}-${String(sm).padStart(2, '0')}-01`;
  const nextStart = sm === 1 ? `${startYear + 1}-01-01` : `${startYear + 1}-${String(sm).padStart(2, '0')}-01`;
  const end = addDays(nextStart, -1);
  return { declared: true, startMonth: sm, start, end, startYear, endYear: Number(end.slice(0, 4)) };
}

/** The fiscal quarter (1–4) `day` falls in, and its first and last day. */
export function fiscalQuarterOf(day: string, startMonth: number | null | undefined): { declared: true; q: 1 | 2 | 3 | 4; start: string; end: string } | { declared: false; code: 'FY_NOT_DECLARED' } {
  const fy = fiscalYearOf(day, startMonth);
  if (!fy.declared) return fy;
  const [y, m] = day.split('-').map(Number);
  const monthsIn = (y - fy.startYear) * 12 + (m - fy.startMonth);   // 0..11
  const q = (Math.floor(monthsIn / 3) + 1) as 1 | 2 | 3 | 4;
  const qStartMonthAbs = fy.startMonth - 1 + (q - 1) * 3;           // months since Jan of startYear, 0-based
  const qy = fy.startYear + Math.floor(qStartMonthAbs / 12);
  const qm = (qStartMonthAbs % 12) + 1;
  const start = `${qy}-${String(qm).padStart(2, '0')}-01`;
  const nextAbs = qStartMonthAbs + 3;
  const ny = fy.startYear + Math.floor(nextAbs / 12);
  const nm = (nextAbs % 12) + 1;
  const end = addDays(`${ny}-${String(nm).padStart(2, '0')}-01`, -1);
  return { declared: true, q, start, end };
}

/** "2026-27" for a year spanning two calendar years; "2026" for a January year. */
export function fiscalYearLabel(fy: FiscalYear): string | null {
  if (!fy.declared) return null;
  return fy.startYear === fy.endYear ? String(fy.startYear) : `${fy.startYear}-${String(fy.endYear).slice(2)}`;
}

/* ------------------------------------------------------------------------------------------------------------ */
/* THE READ LOG                                                                                                 */
/* ------------------------------------------------------------------------------------------------------------ */

/** The first and last row a read returned — the "row span" the read log records. */
export function spanOf(ids: readonly string[]): { first: string | null; last: string | null; count: number } {
  return { first: ids.length ? ids[0].slice(0, 80) : null, last: ids.length ? ids[ids.length - 1].slice(0, 80) : null, count: ids.length };
}

/** The role set a read-log row records — the writer's rule (sorted, `+`-joined), never empty. */
export function roleSetOf(roles: readonly string[] | undefined): string {
  return ([...new Set(roles ?? [])].sort().join('+') || 'no_role').slice(0, 200);
}
