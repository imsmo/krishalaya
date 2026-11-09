// apps/web-ops/src/features/ops4/chc.ts · PC-56 OPS-4a · THE HIRE — PURE helpers for `/chc/*` (W405, W406, W407, W409). NO MONEY MATH (E3):
// every amount is the server's minor string through the money formatter; every quantity is the server's scaled string, printed as sent
// (checked against the API's own pattern, never parsed into a number). Nothing here adds, multiplies, subtracts, divides, averages or
// takes a percentage of a figure. The ONLY arithmetic is counting hires by status — a tally of rows the server listed, never a sum of
// money — and it says how many rows it counted ("the latest N" when the list was paged).
import type { CategoryNode, EquipmentAsset, EquipmentRental } from '@krishalaya/sdk-js';

export const CHC = { dashboard: '/chc/dashboard', detail: '/chc/equipment-detail', bookings: '/chc/bookings', insights: '/chc/insights' } as const;
/** next.config.js `redirects()` mirrors these as REAL 307s (permanent: false); pinned equal by test/ops4a-pages.spec.ts. */
export const OPS4A_REDIRECTS: ReadonlyArray<{ source: string; destination: string }> = [
  { source: '/equipment', destination: CHC.dashboard },
  { source: '/equipment/:id', destination: CHC.bookings },
];

/** The seven statuses the hire machine moves through (`RENTAL_STATUSES`, apps/api …/equipment-booking.state.ts). "disputed" is in the
 *  database enum but no route reaches it, so it is never offered or counted. */
export const RENTAL_STATUSES = ['requested', 'quoted', 'confirmed', 'in_progress', 'completed', 'settled', 'cancelled'] as const;
export type RentalStatus = (typeof RENTAL_STATUSES)[number];
export function isRentalStatus(v: unknown): v is RentalStatus { return typeof v === 'string' && (RENTAL_STATUSES as readonly string[]).includes(v); }
export const RATE_BASES = ['per_hour', 'per_acre', 'per_day', 'per_job', 'per_km'] as const;
export const ASSET_STATUSES = ['active', 'maintenance', 'retired'] as const;
export const MAINTENANCE_TYPES = ['service', 'repair', 'breakdown', 'inspection'] as const;

/** Page sizes: the dashboard reads the latest 100 hires and the first 100 machines; the hires page 50 a page (keyset). */
export const DASH_LIMIT = 100;
export const BOOKINGS_PAGE = 50;

export type ChcState = 'ok' | 'off' | 'error';
/** A read's outcome gives the page state. 404 is the `equipment` flag being OFF (the API hides switched-off routes as 404). */
export function chcState(status: 'ok' | number | 'failed'): ChcState {
  if (status === 404) return 'off';
  return status === 'ok' ? 'ok' : 'error';
}

/** A minor string the server sent (non-negative integer), or null — never a guess. */
export function isMinorString(v: unknown): v is string { return typeof v === 'string' && /^\d{1,18}$/.test(v); }
/** A scaled quantity exactly as the API writes it (`formatScaled(…, 2)`: digits, a point, two digits) — printed as sent, or null. */
export function qtyText(v: unknown): string | null { return typeof v === 'string' && /^\d{1,8}\.\d{2}$/.test(v) ? v : null; }
/** A `YYYY-MM-DD` day as the server sent it (the first ten characters of an ISO instant are NOT used: that is the UTC day). */
export function dayText(v: unknown): string | null { return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null; }

/** The machine's words: its category's name and its registration number (an asset has no name — survey C-13). Never a person. */
export function categoryName(categories: readonly CategoryNode[], id: string): string | null {
  return categories.find((c) => c.id === id)?.defaultName ?? null;
}
export function machineOf(assets: readonly EquipmentAsset[], id: string): EquipmentAsset | null { return assets.find((a) => a.id === id) ?? null; }

/** Hires counted by the status the SERVER gave each, in the machine's order; statuses with no hire are listed with 0. A tally of rows. */
export function countByStatus(rows: readonly Pick<EquipmentRental, 'status'>[]): Array<{ status: RentalStatus; count: number }> {
  return RENTAL_STATUSES.map((status) => ({ status, count: rows.filter((r) => r.status === status).length }));
}

/** `?status=` is a known status or undefined (never forwarded unknown); `?cursor=` a short opaque token or undefined. */
export function statusParam(v: string | string[] | undefined): RentalStatus | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return isRentalStatus(s) ? s : undefined;
}
export function cursorParam(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^[A-Za-z0-9+/=_-]{1,200}$/.test(s) ? s : undefined;
}
export function idParam(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s : null;
}
/** The next page's link, keeping the status filter. */
export function bookingsHref(status: RentalStatus | undefined, cursor?: string): string {
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (cursor) qs.set('cursor', cursor);
  const q = qs.toString();
  return q ? `${CHC.bookings}?${q}` : CHC.bookings;
}

/** One maintenance entry as the API returns it (`maintenance.repository.ts` `listLogs`: `performedOn` the calendar day via `pgDate`). */
export interface MaintenanceEntry { id: string; logType: string; costMinor: string | null; notes: string | null; engineHoursAt: string | null; performedOn: string | null }
export function asMaintenance(rows: ReadonlyArray<Record<string, unknown>>): MaintenanceEntry[] {
  return rows.filter((r) => typeof r.id === 'string').map((r) => ({
    id: String(r.id), logType: String(r.logType ?? ''), costMinor: isMinorString(r.costMinor) ? (r.costMinor as string) : null,
    notes: typeof r.notes === 'string' && r.notes.length > 0 ? r.notes : null,
    engineHoursAt: typeof r.engineHoursAt === 'string' && /^\d{1,9}(\.\d)?$/.test(r.engineHoursAt) ? r.engineHoursAt : null,
    performedOn: dayText(r.performedOn),
  }));
}

/** An instant the server sent, as its own date and minute, labelled UTC (string placement, no clock arithmetic — the OPS-3b `atText`). */
export function atText(iso: unknown): string | null {
  const m = typeof iso === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso) : null;
  return m && typeof iso === 'string' && /Z$|\+00:00$/.test(iso) ? `${m[1]} ${m[2]} UTC` : null;
}
