// apps/web-ops/src/features/ops3/counter.ts · PC-56 OPS-3a · THE COUNTER (W360–W365 + the pos chain W3335–W3337) — PURE helpers.
//
// NO MONEY MATH (E3): every amount is the server's minor string, handed to the money formatter as it came; nothing here adds, multiplies,
// divides, averages or totals an amount, and no per-kg rate is worked out. NO FLOAT ON THE READING PATH (OPS3-B18): weight, fat and SNF stay
// the strings the person typed — checked by pattern only and sent as typed; the SERVER parses them into scaled integers and prices the pour.
// The only comparisons are between `YYYY-MM-DD` day strings (a day after the organisation's today is refused before anything is sent —
// the server refuses it again by name, POUR_DATE_IN_FUTURE).
import { ADULTERATION_FLAGS } from '../dairy/pos';
import type { DairyDaySummaryRow, DairyMcc, DairyShiftWindow } from '@krishalaya/sdk-js';

export const POS = {
  home: '/pos/home', collect: '/pos/collect', quality: '/pos/quality', slip: '/pos/slip', exceptions: '/pos/exceptions', shift: '/pos/shift-close',
} as const;
export const POUR_SHIFTS = ['morning', 'evening'] as const;
export type PourShift = (typeof POUR_SHIFTS)[number];
export const POUR_FLAGS = ADULTERATION_FLAGS;
/** The record response is kept for THIS browser (httpOnly, path /pos, an hour) so `/pos/slip` can show "what was recorded" — see DELTA `slip_source`. */
export const SLIP_COOKIE = 'kv_pos_recorded';
export const SLIP_COOKIE_MAX_AGE_SEC = 3600;
export const ROLL_PAGE_SIZE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WEIGHT = /^\d{1,5}(\.\d{1,3})?$/;      // the API's own pattern (create-milk-collection.dto.ts)
const PCT = /^\d{1,2}(\.\d{1,2})?$/;
/** 0 < reading ≤ 15 %, by PATTERN (the bound the old `/dairy` form held with `Number(…)`): 0–14.99 or exactly 15 / 15.0 / 15.00. */
const PCT_15 = /^(0?\d|1[0-4])(\.\d{1,2})?$|^15(\.0{1,2})?$/;
const NONZERO = /[1-9]/;
const one = (v: string | string[] | undefined | null): string => (Array.isArray(v) ? v[0] ?? '' : v ?? '').trim();

export function parseId(v: string | string[] | undefined | null): string | null { const s = one(v); return UUID.test(s) ? s : null; }
export function parseDay(v: string | string[] | undefined | null): string | null { const s = one(v); return DAY.test(s) ? s : null; }
/** A member-code search term: a short printable string (the API takes a case-blind prefix, ≤ 40). Never a name. */
export function parseCode(v: string | string[] | undefined | null): string | null { const s = one(v); return s && s.length <= 40 && /^[\p{L}\p{N}_\-./]+$/u.test(s) ? s : null; }

export type CounterState = 'ok' | 'noCustody' | 'off' | 'forbidden' | 'error';
/** The page's state from `GET /v1/dairy/mccs/mine`. A 404 is the `dairy` flag being off (switched-off routes answer 404); 403 a person with no dairy read. */
export function counterState(status: 'ok' | number | 'failed', centres: number): CounterState {
  if (status === 404) return 'off';
  if (status === 403) return 'forbidden';
  if (status !== 'ok') return 'error';
  return centres > 0 ? 'ok' : 'noCustody';
}
/** The centre the page works for: the one named in `?mcc=` IF it is in the person's custody, else the only one; else none (choose). */
export function pickCentre(centres: readonly DairyMcc[], mcc: string | null): DairyMcc | null {
  if (mcc) return centres.find((c) => c.id === mcc) ?? null;
  return centres.length === 1 ? centres[0] : null;
}
/** The centre's recorded hours for a shift, or null ("not recorded for this centre"). */
export function shiftHours(c: DairyMcc, shift: PourShift): DairyShiftWindow | null { return c.shiftWindows?.[shift] ?? null; }
/** The day sheet's row for a shift, or null (no pour recorded in it yet). */
export function rowFor(rows: readonly DairyDaySummaryRow[], shift: PourShift): DairyDaySummaryRow | null { return rows.find((r) => r.shift === shift) ?? null; }
/** A minor string the formatter may print; anything else is "not read" — never a guess, never a zero. */
export function isMinor(v: string | null | undefined): v is string { return typeof v === 'string' && /^\d{1,18}$/.test(v); }

export interface PourValue {
  membershipId: string; shift: PourShift; collectedOn: string; weightKg: string; fatPct: string; snfPct: string;
  waterFlag?: boolean; adulterationFlags?: string[];
}
export type PourError = 'member' | 'shift' | 'date' | 'future' | 'weight' | 'fat' | 'snf';
export type PourResult = { ok: true; value: PourValue } | { ok: false; error: PourError };

/** The record form, checked by PATTERN only — the readings stay the strings typed (no `Number`), the server prices and refuses by name. */
export function buildPour(raw: { membershipId: string; shift: string; collectedOn: string; weightKg: string; fatPct: string; snfPct: string; waterFlag: boolean; adulteration: string[] }, today: string): PourResult {
  const membershipId = raw.membershipId.trim();
  if (!UUID.test(membershipId)) return { ok: false, error: 'member' };
  if (!(POUR_SHIFTS as readonly string[]).includes(raw.shift)) return { ok: false, error: 'shift' };
  const collectedOn = raw.collectedOn.trim();
  if (!DAY.test(collectedOn)) return { ok: false, error: 'date' };
  if (collectedOn > today) return { ok: false, error: 'future' };
  const weightKg = raw.weightKg.trim();
  if (!WEIGHT.test(weightKg) || !NONZERO.test(weightKg)) return { ok: false, error: 'weight' };
  const fatPct = raw.fatPct.trim();
  if (!PCT.test(fatPct) || !PCT_15.test(fatPct) || !NONZERO.test(fatPct)) return { ok: false, error: 'fat' };
  const snfPct = raw.snfPct.trim();
  if (!PCT.test(snfPct) || !PCT_15.test(snfPct) || !NONZERO.test(snfPct)) return { ok: false, error: 'snf' };
  const value: PourValue = { membershipId, shift: raw.shift as PourShift, collectedOn, weightKg, fatPct, snfPct };
  if (raw.waterFlag) value.waterFlag = true;
  const flags = raw.adulteration.filter((f) => (POUR_FLAGS as readonly string[]).includes(f));
  if (flags.length) value.adulterationFlags = flags;
  return { ok: true, value };
}
/** The roll's `<option value>`: the membership id and its member code, `id|code` — the code is what the page prints; the id is what is sent. */
export function memberValue(id: string, code: string): string { return `${id}|${code}`; }
export function parseMember(v: string | string[] | undefined | null): { membershipId: string; code: string } | null {
  const [id, code] = one(v).split('|');
  return id && UUID.test(id) && parseCode(code) ? { membershipId: id, code: code as string } : null;
}
/** The pour as query parameters (the check step `/pos/quality` echoes them; nothing is stored until "Record this pour"). */
export function pourQuery(v: PourValue, mcc: string, code: string): string {
  const q = new URLSearchParams({ mcc, member: memberValue(v.membershipId, code), shift: v.shift, collectedOn: v.collectedOn, weightKg: v.weightKg, fatPct: v.fatPct, snfPct: v.snfPct });
  if (v.waterFlag) q.set('waterFlag', '1');
  for (const f of v.adulterationFlags ?? []) q.append('adulteration', f);
  return q.toString();
}
/** The pour from the record form's fields (`member`, `shift`, `collectedOn`, the readings, the flags) — a query string or form data alike. */
export function pourFromParams(sp: Record<string, string | string[] | undefined> | undefined, today: string): PourResult & { code: string | null } {
  const all = (k: string) => { const v = sp?.[k]; return Array.isArray(v) ? v.map(String) : v ? [String(v)] : []; };
  const m = parseMember(sp?.member);
  const r = buildPour({ membershipId: m?.membershipId ?? '', shift: one(sp?.shift), collectedOn: one(sp?.collectedOn), weightKg: one(sp?.weightKg),
    fatPct: one(sp?.fatPct), snfPct: one(sp?.snfPct), waterFlag: one(sp?.waterFlag) === '1', adulteration: all('adulteration') }, today);
  return { ...r, code: m?.code ?? null };
}
/** FormData as the same record of fields (repeated `adulteration` kept). */
export function formFields(fd: { getAll(k: string): unknown[]; get(k: string): unknown }): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of ['mcc', 'member', 'shift', 'collectedOn', 'weightKg', 'fatPct', 'snfPct', 'waterFlag']) out[k] = String(fd.get(k) ?? '');
  out.adulteration = fd.getAll('adulteration').map(String);
  return out;
}

/** The pos chain's failure reasons, named. Server codes first (each a sentence on the page), then the console's own pre-checks. */
export const POUR_REASONS = ['future', 'billed', 'duplicate', 'noCard', 'notHere', 'member', 'invalid', 'forbidden', 'off', 'custody', 'record',
  'date', 'weight', 'fat', 'snf', 'shift'] as const;
export type PourReason = (typeof POUR_REASONS)[number];
export function pourFailureReason(status: number, code: string | undefined): PourReason {
  switch (code) {
    case 'POUR_DATE_IN_FUTURE': return 'future';
    case 'POUR_WINDOW_ALREADY_BILLED': return 'billed';
    case 'DUPLICATE_COLLECTION': return 'duplicate';
    case 'NO_ACTIVE_RATE_CARD': return 'noCard';
    case 'POUR_NOT_AT_THIS_CENTRE': return 'notHere';
    case 'DAIRY_MEMBERSHIP_NOT_FOUND': return 'member';
    case 'COLLECTION_INVALID': return 'invalid';
    // [PC-56 OPS-3b · L1] the API's own custody refusal: the member's centre (or the named one) is not in the signed-in person's open custody
    case 'DAIRY_CENTRE_NOT_IN_CUSTODY': return 'custody';
    default: break;
  }
  if (status === 403) return 'forbidden';
  if (status === 404) return 'off';
  if (status === 400 || status === 422) return 'invalid';
  if (status === 409) return 'duplicate';
  return 'record';
}
export function parseReason(sp: Record<string, string | string[] | undefined> | undefined): PourReason {
  const r = one(sp?.reason);
  return (POUR_REASONS as readonly string[]).includes(r) ? (r as PourReason) : 'record';
}

/** What `POST /v1/dairy/collections` answered, kept for the slip page — only these fields, each checked on the way back in. */
export interface RecordedPour {
  id: string; memberCode: string; mccId: string; shift: PourShift; collectedOn: string; weightKg: string; fatPct: string; snfPct: string;
  amountMinor: string; rateCardId: string; holdState: string; createdAt: string | null; waterFlag: boolean; adulterationFlags: string[];
}
const HOLD = ['none', 'held', 'released', 'rejected'];
export function encodeRecorded(r: RecordedPour): string { return Buffer.from(JSON.stringify(r), 'utf8').toString('base64url'); }
export function decodeRecorded(raw: string | undefined | null): RecordedPour | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const id = s('id'); const memberCode = s('memberCode'); const mccId = s('mccId'); const shift = s('shift'); const collectedOn = s('collectedOn');
  const weightKg = s('weightKg'); const fatPct = s('fatPct'); const snfPct = s('snfPct'); const amountMinor = s('amountMinor'); const rateCardId = s('rateCardId');
  const holdState = s('holdState');
  if (!id || !UUID.test(id) || !memberCode || !parseCode(memberCode) || !mccId || !UUID.test(mccId) || !shift || !(POUR_SHIFTS as readonly string[]).includes(shift)
    || !collectedOn || !DAY.test(collectedOn) || !weightKg || !/^\d{1,5}\.\d{3}$/.test(weightKg) || !fatPct || !/^\d{1,2}\.\d{2}$/.test(fatPct)
    || !snfPct || !/^\d{1,2}\.\d{2}$/.test(snfPct) || !isMinor(amountMinor) || !rateCardId || !UUID.test(rateCardId) || !holdState || !HOLD.includes(holdState)) return null;
  const flags = Array.isArray(o.adulterationFlags) ? (o.adulterationFlags as unknown[]).filter((f): f is string => typeof f === 'string' && f.length <= 40) : [];
  return { id, memberCode, mccId, shift: shift as PourShift, collectedOn, weightKg, fatPct, snfPct, amountMinor, rateCardId, holdState,
    createdAt: s('createdAt'), waterFlag: o.waterFlag === true, adulterationFlags: flags };
}
/** `createdAt` as the server sent it, shown as its own date and minute text (string placement, no clock arithmetic). */
export function recordedAtText(iso: string | null): string | null {
  const m = iso ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m ? `${m[1]} ${m[2]} UTC` : null;
}
