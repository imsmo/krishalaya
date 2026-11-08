// apps/web-ops/src/features/ops2/intake.ts · PC-56 OPS-2a · W370 / W371 / W374 (+ the booking drill-in) — the INTAKE helpers. No money math (E3):
// nothing here adds, counts, multiplies or totals anything; a quantity is the server's string, printed with its unit; no depositor is read (Q9-A).
//
// `readDashboard` is the ONE read of W370, written against an injected client (the page passes `opsClient().warehousing` and `.catalogue`) so the
// render test can prove the `box` (survey E1, mutant 8): it reads the warehouses the signed-in person OPERATES (`warehouses({ box: 'mine' })` — the
// API's `tenant_id = caller's AND operator_user_id = caller`), then EACH ONE's bookings with `box: 'warehouse'` and its `warehouseId`. Without the
// `box`, the API answers its default `depositor` — the caller's OWN deposits — which is what the old `/warehouse` page showed (survey F-9, C-3).
// A booking's commodity is its product's own name from the existing product read (`GET /v1/products/:id`), never its id; a product that cannot be
// read prints "not available".
import type { Page, StorageBooking, Warehouse } from '@krishalaya/sdk-js';
import { BOOKING_STATUSES, isBookingStatus } from '../warehouse/manage';

export const DASHBOARD_PAGE = '/warehouse/dashboard';
export const WEIGHBRIDGE_PAGE = '/warehouse/weighbridge';
export const STACKING_PAGE = '/warehouse/stacking';
export const REGISTRY_PAGE = '/warehouse/enwr/registry';

/** `/warehouse` answers a REAL 307 to the dashboard (the `*_REDIRECTS` precedent; next.config.js mirrors this, pinned equal by ops2a-pages). */
export const OPS2A_REDIRECTS: readonly { source: string; destination: string }[] = Object.freeze([{ source: '/warehouse', destination: DASHBOARD_PAGE }]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** The one input on W370: a GET status select. Anything not a booking status is dropped. */
export function parseStatus(raw: string | string[] | undefined): string | undefined { const v = first(raw); return isBookingStatus(v) ? v : undefined; }
/** One warehouse's next page travels as its id (a UUID, else dropped) and the server's opaque cursor. */
export function parseWarehouse(raw: string | string[] | undefined): string | undefined { const v = first(raw); return v && UUID.test(v) ? v.toLowerCase() : undefined; }
export function parseCursor(raw: string | string[] | undefined): string | undefined { const v = first(raw); return v && /^[A-Za-z0-9+/=_-]{1,200}$/.test(v) ? v : undefined; }
export function dashboardHref(q: { status?: string; warehouse?: string; cursor?: string } = {}): string {
  const p = new URLSearchParams();
  if (q.status) p.set('status', q.status);
  if (q.warehouse) p.set('warehouse', q.warehouse);
  if (q.cursor) p.set('cursor', q.cursor);
  const s = p.toString();
  return s ? `${DASHBOARD_PAGE}?${s}` : DASHBOARD_PAGE;
}
export const BOOKINGS_PER_WAREHOUSE = 25;

export interface DashboardRow { id: string; status: string; quantity: string; unitCode: string; commodity: string | null; storedAt: string | null; createdAt: string | null }
export interface DashboardGroup { warehouse: { id: string; name: string; wdraRegNo: string | null }; rows: DashboardRow[]; nextCursor: string | null }
export type DashboardState = 'ok' | 'none' | 'off' | 'forbidden' | 'error';
export interface DashboardRead { state: DashboardState; groups: DashboardGroup[] }
export interface DashboardIo {
  warehouses(p: { box: 'mine'; limit: number }): Promise<Page<Warehouse>>;
  bookings(p: { box: 'warehouse'; warehouseId: string; status?: string; cursor?: string; limit: number }): Promise<Page<StorageBooking>>;
  product(id: string): Promise<{ defaultName: string }>;
}
const statusOf = (e: unknown): number | null => (e && typeof e === 'object' && typeof (e as { status?: unknown }).status === 'number' ? (e as { status: number }).status : null);
/** A quantity is printed only as the three-place decimal string the server prints; a unit only as a plain unit code. */
export function isQuantityString(v: unknown): v is string { return typeof v === 'string' && /^\d{1,12}\.\d{3}$/.test(v); }
export function isUnitCode(v: unknown): v is string { return typeof v === 'string' && /^[a-z_]{1,30}$/.test(v); }

export async function readDashboard(io: DashboardIo, q: { status?: string; warehouse?: string; cursor?: string }): Promise<DashboardRead> {
  let mine: Warehouse[];
  try { mine = (await io.warehouses({ box: 'mine', limit: 100 })).items; }
  catch (e) { const s = statusOf(e); return { state: s === 404 ? 'off' : s === 403 ? 'forbidden' : 'error', groups: [] }; }
  const shown = q.warehouse ? mine.filter((w) => w.id === q.warehouse) : mine;
  if (shown.length === 0) return { state: 'none', groups: [] };
  const groups: DashboardGroup[] = [];
  const names = new Map<string, Promise<string | null>>();
  const nameOf = (id: string) => { if (!names.has(id)) names.set(id, io.product(id).then((p) => (typeof p?.defaultName === 'string' && p.defaultName ? p.defaultName : null)).catch(() => null)); return names.get(id)!; };
  try {
    for (const w of shown) {
      const page = await io.bookings({ box: 'warehouse', warehouseId: w.id, status: q.status, cursor: q.warehouse ? q.cursor : undefined, limit: BOOKINGS_PER_WAREHOUSE });
      const rows: DashboardRow[] = [];
      for (const b of page.items) rows.push({ id: b.id, status: b.status, quantity: b.quantity, unitCode: b.unitCode, commodity: await nameOf(b.productId), storedAt: b.storedAt ?? null, createdAt: b.createdAt ?? null });
      groups.push({ warehouse: { id: w.id, name: w.defaultName, wdraRegNo: w.wdraRegNo ?? null }, rows, nextCursor: page.nextCursor });
    }
  } catch (e) { const s = statusOf(e); return { state: s === 404 ? 'off' : s === 403 ? 'forbidden' : 'error', groups: [] }; }
  return { state: 'ok', groups };
}

/** The drill-in's acts are offered only to the warehouse's NAMED operator (the 2b `box: 'mine'` approach): the server refuses everyone else by name. */
export function isOperatorOf(warehouseId: string | null | undefined, mine: readonly { id: string }[]): boolean { return !!warehouseId && mine.some((w) => w.id === warehouseId); }
/** The drill-in's failure reasons — the SERVER's, by status / code. */
export const BOOKING_ERRORS = ['action', 'illegal', 'reason', 'notOperator'] as const;
export function bookingError(status: number | null, code: string | null | undefined): (typeof BOOKING_ERRORS)[number] {
  if (code === 'BOOKING_CANCEL_REASON_REQUIRED') return 'reason';
  if (status === 403) return 'notOperator';
  if (status === 409) return 'illegal';
  return 'action';
}
export { BOOKING_STATUSES };
