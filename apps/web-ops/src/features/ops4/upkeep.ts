// apps/web-ops/src/features/ops4/upkeep.ts · PC-56 OPS-4b · THE RECORDS — PURE helpers for `/chc/maintenance` (W408) and its REAL form chain
// (W3300–W3303), and the animal pages' addresses (W394–W396). NO MONEY MATH (E3): the cost a person types in rupees becomes a minor-unit string by
// MOVING THE DECIMAL POINT in the text (whole digits + two fraction digits) — nothing is added, multiplied or divided, and no float is made.
// Every value is checked against the API's own pattern (dto/create-maintenance-log.dto.ts) and kept as typed.
import { MAINTENANCE_TYPES, idParam, isMinorString } from './chc';

export const MAINT = '/chc/maintenance';
export const ANIMALS = { eartag: '/animals/eartag-scan', register: '/animals/register', transfer: '/animals/transfer' } as const;
/** The machines whose entries the page reads (one read per machine). */
export const MAINT_MACHINES = 20;
/** The success state's kept answer: httpOnly, path /chc/maintenance, ten minutes (the OPS-3b reading-cookie shape). */
export const ENTRY_COOKIE = 'kv_ops4_maint';
export const ENTRY_COOKIE_MAX_AGE_SEC = 600;

export type MaintType = (typeof MAINTENANCE_TYPES)[number];
export function parseLogType(v: unknown): MaintType | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && (MAINTENANCE_TYPES as readonly string[]).includes(s) ? (s as MaintType) : null;
}
/** A real calendar day `YYYY-MM-DD` (2026-02-31 is not one), or null. */
export function parseDay(v: unknown): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}
/** Rupees as typed ("1250", "1250.5", "1250.50") give the minor-unit STRING ("125000", "125050"), by moving the point; anything else gives null. */
export function rupeesToMinorText(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const minor = `${whole}${frac.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  return isMinorString(minor) ? minor : null;
}
/** Engine hours as typed, one decimal at most (`numeric(10,1)`), or null. */
export function parseHours(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^\d{1,9}(\.\d)?$/.test(s) ? s : null;
}
/** A typed value kept for the form, bounded (never trusted, only echoed back into an input's value). */
export function kept(v: unknown): string {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' ? s.slice(0, 40) : '';
}
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** What the person typed, as the form posts it (GET to `?form=review`). */
export interface MaintDraftInput { asset: string; logType: string; performedOn: string; cost: string; hours: string }
export type MaintFieldError = 'machine' | 'type' | 'day' | 'cost' | 'hours';
/** A checked entry, ready for the API: the cost already a minor-unit string. */
export interface MaintBody { assetId: string; logType: MaintType; performedOn: string; costMinor: string | null; engineHoursAt: string | null }
export function draftInput(sp: Record<string, string | string[] | undefined> | undefined): MaintDraftInput {
  return { asset: kept(sp?.asset), logType: kept(sp?.logType), performedOn: kept(sp?.performedOn), cost: kept(sp?.cost), hours: kept(sp?.hours) };
}
/** The field rules the API applies, checked here first (the first failing field is named), against the person's OWN machines. */
export function checkDraft(d: MaintDraftInput, mine: readonly string[]): { body: MaintBody | null; error: MaintFieldError | null } {
  const assetId = idParam(d.asset);
  if (!assetId || !mine.includes(assetId)) return { body: null, error: 'machine' };
  const logType = parseLogType(d.logType);
  if (!logType) return { body: null, error: 'type' };
  const performedOn = parseDay(d.performedOn);
  if (!performedOn) return { body: null, error: 'day' };
  const costMinor = d.cost.trim() === '' ? null : rupeesToMinorText(d.cost);
  if (d.cost.trim() !== '' && !costMinor) return { body: null, error: 'cost' };
  const engineHoursAt = d.hours.trim() === '' ? null : parseHours(d.hours);
  if (d.hours.trim() !== '' && !engineHoursAt) return { body: null, error: 'hours' };
  return { body: { assetId, logType, performedOn, costMinor, engineHoursAt }, error: null };
}
export const FIELD_ERRORS: readonly MaintFieldError[] = ['machine', 'type', 'day', 'cost', 'hours'];
/** `change` = she chose to change what she typed (from the review); `api` = the API refused a field (422). */
export function parseFieldError(v: string | string[] | undefined): MaintFieldError | 'api' | 'change' {
  const s = one(v);
  if (s === 'change') return 'change';
  return (FIELD_ERRORS as readonly string[]).includes(s ?? '') ? (s as MaintFieldError) : 'api';
}
/** The form's query string, values kept (for the form-error state and the "change" link). */
export function draftQuery(d: MaintDraftInput): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(d)) if (v) q.set(k, v);
  return q.toString();
}

/** Why the act recorded nothing — each a key `ops4.upkeep.failure.<reason>` ×3. */
export const MAINT_FAILURES = ['not_your_machine', 'date_in_future', 'not_found', 'key', 'record'] as const;
export type MaintFailure = (typeof MAINT_FAILURES)[number];
/** The API's answer gives the named reason; `null` = the API refused a field (422), so the form-error state with the values kept. */
export function maintFailureReason(status: number | undefined, code: string | undefined | null): MaintFailure | null {
  if (code === 'MAINTENANCE_NOT_YOUR_MACHINE') return 'not_your_machine';
  if (code === 'MAINTENANCE_DATE_IN_FUTURE') return 'date_in_future';
  if (status === 422) return null;
  if (status === 404) return 'not_found';
  if (status === 400) return 'key';
  return 'record';
}
export function parseFailure(v: string | string[] | undefined): MaintFailure {
  const s = one(v);
  return (MAINT_FAILURES as readonly string[]).includes(s ?? '') ? (s as MaintFailure) : 'record';
}

/** The entry the SERVER returned (`maintenance.service.ts` record): kept for this browser to print on the success state. */
export interface RecordedEntry { id: string; assetId: string; logType: MaintType; costMinor: string | null; engineHoursAt: string | null; performedOn: string }
export function asRecorded(v: unknown): RecordedEntry | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const logType = parseLogType(r.logType); const performedOn = parseDay(r.performedOn);
  if (typeof r.id !== 'string' || !idParam(r.assetId as string) || !logType || !performedOn) return null;
  return { id: r.id, assetId: r.assetId as string, logType, performedOn, costMinor: isMinorString(r.costMinor) ? (r.costMinor as string) : null,
    engineHoursAt: typeof r.engineHoursAt === 'string' && parseHours(r.engineHoursAt) ? r.engineHoursAt : null };
}
export function encodeRecorded(e: RecordedEntry): string { return Buffer.from(JSON.stringify(e), 'utf8').toString('base64url'); }
export function decodeRecorded(v: string | undefined): RecordedEntry | null {
  if (!v || !/^[A-Za-z0-9_-]{1,2000}$/.test(v)) return null;
  try { return asRecorded(JSON.parse(Buffer.from(v, 'base64url').toString('utf8'))); } catch { return null; }
}

/** The server's two alerts (`maintenance.repository.ts` alerts), for the caller's machines. Anything else is dropped. */
export type MaintAlert = 'needs_attention' | 'service_due';
export function asAlerts(rows: ReadonlyArray<Record<string, unknown>>): Array<{ assetId: string; alert: MaintAlert }> {
  return rows.filter((r) => typeof r.assetId === 'string' && (r.alert === 'needs_attention' || r.alert === 'service_due'))
    .map((r) => ({ assetId: r.assetId as string, alert: r.alert as MaintAlert }));
}
/** An Idempotency-Key shape (minted when the review is shown; a double submit replays the same answer). */
export function keyParam(v: unknown): string | null { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v) ? v : null; }
