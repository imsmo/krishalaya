// apps/web-ops/src/features/ops2/receipts.ts · PC-56 OPS-2b · W372 / W373 / W375 / W376 (+ the receipt drill-in) — PURE helpers. No IO, no money
// math (E3): nothing here adds, multiplies or totals an amount; a receipt's value is never read (founder Q4-A) and its holder never (Q9-A).
import { BOOKING_STATUSES } from '../warehouse/manage';

export const ASSAY_PAGE = '/warehouse/assay';
export const ASSAY_RECORD_PAGE = '/warehouse/assay/certificate';
export const ENWR_ISSUE_PAGE = '/warehouse/enwr/issue';
export const ENWR_REGISTRY_PAGE = '/warehouse/enwr/registry';
export const WAREHOUSE_PAGE = '/warehouse';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** An id travels in a URL as an id ONLY (a UUID) — anything else (a name, a number, a script) is dropped, never echoed into a request or a link. */
export function parseId(raw: string | string[] | undefined): string | undefined {
  const v = first(raw);
  return v && UUID.test(v) ? v.toLowerCase() : undefined;
}
export function assayHref(bookingId: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ booking: bookingId, ...(extra ?? {}) });
  return `${ASSAY_PAGE}?${q.toString()}`;
}
export function assayRecordHref(bookingId: string, assayId: string, extra?: Record<string, string>): string {
  const q = new URLSearchParams({ booking: bookingId, assay: assayId, ...(extra ?? {}) });
  return `${ASSAY_RECORD_PAGE}?${q.toString()}`;
}
export function enwrReceiptHref(id: string): string { return `/warehouse/enwr/${encodeURIComponent(id)}`; }

/**
 * Where a chain state's "Back" goes (survey E4, mutant 13): the assay ACT chain (W3297–W3299) returns to W372 for its booking — never W373; the
 * assay EXPORT chain (W3295–W3296, triggered from W373 "Download PDF") returns to W373, the trigger — never the canon's W372 (DELTA
 * `assay_export_back`); the enwr export chain to W376 (its trigger — never the canon's W375); the enwr act chain to W375.
 */
export function chain2bBack(id: 'assay_act' | 'assay_export' | 'enwr_export' | 'enwr_act', ctx: { booking?: string; assay?: string } = {}): string {
  if (id === 'assay_act') return ctx.booking ? assayHref(ctx.booking) : ASSAY_PAGE;
  if (id === 'assay_export') return ctx.booking && ctx.assay ? assayRecordHref(ctx.booking, ctx.assay) : ASSAY_RECORD_PAGE;
  if (id === 'enwr_export') return ENWR_REGISTRY_PAGE;
  return ENWR_ISSUE_PAGE;
}

/** F-16: the record form is offered on a STORED booking only, and only to that warehouse's named operator (the server refuses everyone else). */
export function canRecordAssay(status: string | undefined | null, isOperator: boolean): boolean { return status === 'stored' && isOperator; }

/** W372's page state from what the reads answered. 404 = no such booking here, not readable by this person, or the module switched off. */
export type AssayPageState = 'ok' | 'pick' | 'unavailable' | 'error';
export function assayPageState(booking: string | undefined, status: 'ok' | number | 'failed'): AssayPageState {
  if (!booking) return 'pick';
  if (status === 'ok') return 'ok';
  return status === 404 || status === 403 ? 'unavailable' : 'error';
}

/** The assay record act's failure reasons — the SERVER's (by status / code), or the console's own pre-check (`buildAssay`). */
export const ASSAY_FAILURE_REASONS = ['notStored', 'notOperator', 'off', 'invalid', 'assayer', 'params', 'validuntil', 'record'] as const;
export type AssayFailureReason = (typeof ASSAY_FAILURE_REASONS)[number];
export function assayFailureReason(status: number, code: string | undefined | null): AssayFailureReason {
  if (code === 'BOOKING_NOT_STORED') return 'notStored';
  if (status === 403) return 'notOperator';
  if (status === 404) return 'off';
  if (status === 400 || status === 422) return 'invalid';
  return 'record';
}
export function parseAssayReason(searchParams: Record<string, string | string[] | undefined> | undefined): AssayFailureReason {
  const v = first(searchParams?.reason);
  return v && (ASSAY_FAILURE_REASONS as readonly string[]).includes(v) ? (v as AssayFailureReason) : 'record';
}

/** An assay parameter printed EXACTLY as recorded: `name = value`, no unit and no percentage added (E3). */
export function assayParamLines(parameters: Record<string, string | number | boolean> | null | undefined): string[] {
  return Object.entries(parameters ?? {}).map(([k, v]) => `${k} = ${String(v)}`);
}

// ── the receipt register ──
/** The receipt statuses VERBATIM (`nwr-receipt.state.ts`). Only these three can be reached; the other three have no transition on this platform. */
export const NWR_STATUSES = ['issued', 'pledged', 'partially_released', 'released', 'cancelled', 'defaulted'] as const;
export const NWR_REACHABLE = ['issued', 'released', 'cancelled'] as const;
export const NWR_UNREACHABLE = ['pledged', 'partially_released', 'defaulted'] as const;
export function isNwrStatus(v: unknown): v is (typeof NWR_STATUSES)[number] { return typeof v === 'string' && (NWR_STATUSES as readonly string[]).includes(v); }

/** The ONE input on W376: a GET page-size select. */
export const PAGE_SIZES = [25, 50] as const;
export function parsePageSize(raw: string | string[] | undefined): 25 | 50 { return first(raw) === '50' ? 50 : 25; }
export function registryHref(size: number, cursor?: string): string {
  const q = new URLSearchParams({ size: String(size) });
  if (cursor) q.set('cursor', cursor);
  return `${ENWR_REGISTRY_PAGE}?${q.toString()}`;
}
export type RegistryState = 'ok' | 'none' | 'forbidden' | 'off' | 'error';
export function registryState(status: 'ok' | number | 'failed', count: number): RegistryState {
  if (status === 404) return 'off';
  if (status === 403) return 'forbidden';
  if (status !== 'ok') return 'error';
  return count > 0 ? 'ok' : 'none';
}
/** A quantity is printed only when the server sent the three-place decimal string it prints (`formatQuantityMilli`); anything else is not shown. */
export function isQuantityString(v: string | null | undefined): v is string { return typeof v === 'string' && /^\d{1,12}\.\d{3}$/.test(v); }
/** The booking's unit, printed only when it is a plain unit code (the receipt itself stores no unit). */
export function isUnitCode(v: string | null | undefined): v is string { return typeof v === 'string' && /^[a-z_]{1,30}$/.test(v); }
export { BOOKING_STATUSES };
