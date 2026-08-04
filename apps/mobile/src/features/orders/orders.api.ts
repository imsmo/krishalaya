// apps/mobile/src/features/orders/orders.api.ts · data layer for the farmer orders + delivery vertical (P-07).
// Keeps screens thin (guide §3). Reads serve through the SWR cache (usable offline) and degrade-never-die (empty/
// null on hard failure). Money is bigint-minor strings (Law 2). Mutations are LIFECYCLE TRANSITIONS, not blind
// writes: they are NOT offline-queued — a transition (confirm/deliver/complete) needs the server's live state to
// be legal, and blind replay of a stale transition is wrong; so they run online, idempotent (Law 3 key), and the
// caller surfaces the precise server outcome (409 = already moved, 403 = not allowed). PoD captures the buyer OTP
// + an uploaded photo and delivers the shipment server-side.
import type { OrderListItem, OrderDetail, OrderRole, Shipment, OrderTracking, OrderBuyerSummary } from '@krishalaya/sdk-js';
import { apiClient } from '../../core/api/client';
import { cache } from '../../core/offline/sqlite.db';
import { currentScope } from '../../core/offline/scope';
import { POLICY } from '../../core/offline/cache-policies';
import { newId } from '../../core/util/ids';

export interface OrdersPage { items: OrderListItem[]; nextCursor: string | null }

const DAY_MS = 24 * 60 * 60 * 1000;

/** Today's tenant-wide order summary for the owner's Today's Orders worklist (screen 547, DEV-45). Reuses the
 * ALREADY-BUILT + already-integrated `tenancy.analytics` read-model over a real start-of-day window (same
 * computation `(owner)/home.tsx` already makes for its "Today's GMV" KPI — not a new endpoint, just a thin,
 * purpose-named wrapper). `orders` = tenant-wide count for the window (moderator-scoped server-side); `gmvMinor`
 * is bigint-minor (Law 2). Degrades to null on failure (screen shows retry).
 * §13 (NOT faked): there is no tenant-wide PER-ORDER read-model yet — `GET orders` (`OrderTimelineReadModel`) is
 * hardcoded to the CALLING user's own buyer/seller identity only (confirmed by reading
 * `apps/api/src/modules/orders/repositories/order.repository.ts`'s `listFor` + the controller), unlike
 * `GET orders/stats`'s moderator-aware path. So this function returns AGGREGATE counts only — the screen does not
 * (and cannot honestly) render individual order rows/farmer names/accept-pack-ready actions from this call; see
 * the screen's own header comment + `dev45_report.md` for the residual. */
export interface TodayOrderSummary { orders: number; gmvMinor: string; currencyCode: string; disputesOpen: number; refundedOrders: number }
export async function todayTenantOrderSummary(): Promise<TodayOrderSummary | null> {
  try {
    const now = Date.now();
    const from = new Date(now - (now % DAY_MS)).toISOString(); // start of the current UTC day — same calc as home.tsx
    const to = new Date(now).toISOString();
    const an = await apiClient().tenancy.analytics({ from, to });
    return { orders: an.orders, gmvMinor: an.gmvMinor, currencyCode: an.currencyCode, disputesOpen: an.disputesOpen, refundedOrders: an.refundedOrders };
  } catch { return null; }
}

/** Orders as buyer or seller (optionally status-filtered). Read-through SWR cache; degrades to an empty page. */
export async function listOrders(params: { role: OrderRole; status?: string; cursor?: string; limit?: number }): Promise<OrdersPage> {
  try {
    const { value } = await cache.read<OrdersPage>({
      scope: currentScope(), ns: 'orders.list', parts: [params.role, params.status ?? 'all', params.cursor ?? 'first', params.limit ?? 20], policy: POLICY.shortList,
      fetcher: () => apiClient().orders.list(params),
    });
    return value;
  } catch { return { items: [], nextCursor: null }; }
}

/** One order's full detail (items + money breakdown). Degrades to null → the screen shows a retry. */
export async function getOrder(id: string): Promise<OrderDetail | null> {
  try { return await apiClient().orders.get(id); } catch { return null; }
}

/** Buyer trust summary for the seller's accept/reject decision (screen 57): the buyer's order counts in this
 * tenant + verified business type. Seller-only server-side; degrades to null so the screen shows §13 "—". */
export async function orderBuyerSummary(id: string): Promise<OrderBuyerSummary | null> {
  try { return await apiClient().orders.buyerSummary(id); } catch { return null; }
}

// --- lifecycle transitions (online, idempotent; throw so the screen can show the precise outcome) ---
export function confirmOrder(id: string): Promise<{ ok: boolean }> { return apiClient().orders.confirm(id, newId()); }
export function packOrder(id: string): Promise<{ ok: boolean }> { return apiClient().orders.markPacked(id, newId()); }
export function readyOrder(id: string): Promise<{ ok: boolean }> { return apiClient().orders.markReady(id, newId()); }
export function markOrderDelivered(id: string): Promise<{ ok: boolean }> { return apiClient().orders.markDelivered(id, newId()); }
export function completeOrder(id: string): Promise<{ ok: boolean }> { return apiClient().orders.complete(id, newId()); }
export function cancelOrder(id: string, reasonId?: string): Promise<{ ok: boolean }> { return apiClient().orders.cancel(id, newId(), reasonId); }
/** Report a problem with an order → opens a dispute case server-side (free-text note). */
export function reportOrder(id: string, note: string): Promise<{ ok: boolean }> { return apiClient().orders.dispute(id, note, newId()); }

// --- shipment / proof-of-delivery ---
/** The shipment for an order (the caller's assigned one). null when none / not visible to this user. */
export async function getOrderShipment(orderId: string): Promise<Shipment | null> {
  try { const page = await apiClient().shipments.list({ box: 'mine', orderId, limit: 1 }); return page.items[0] ?? null; }
  catch { return null; }
}
/** Record proof-of-delivery: buyer OTP (+ optional uploaded photo mediaId) → deliver the shipment. Idempotent. */
export function recordPod(shipmentId: string, otp: string, podMediaId?: string): Promise<Shipment> {
  return apiClient().shipments.deliver(shipmentId, { otp: otp.trim(), podMediaId }, newId());
}

/** The order-TRACKING feed (buyer/seller, party-scoped): stamped order-status transitions + the shipment's
 * status/location timeline (real per-step timestamps; lat/lng when a rider posted a ping). Read-through SWR
 * cache so the last-known timeline shows offline; degrades to null on a hard failure (the screen falls back to
 * the order+shipment-derived timeline). No ETA is returned — the screen shows ETA as unknown, never fabricated. */
export async function getOrderTracking(orderId: string): Promise<OrderTracking | null> {
  try {
    const { value } = await cache.read<OrderTracking>({
      scope: currentScope(), ns: 'orders.tracking', parts: [orderId], policy: POLICY.shortList,
      fetcher: () => apiClient().orders.tracking(orderId),
    });
    return value ?? null;
  } catch { return null; }
}
