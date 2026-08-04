// apps/mobile/src/features/orders/order-status.ts · PURE order/shipment status logic for the orders+delivery
// vertical (P-07). No React/native imports (ui type is `import type` → erased), so it's unit-tested under ts-jest.
// It mirrors the SERVER state machine (orders.domain/order.state + logistics shipment.state) for NAVIGATION ONLY:
// which actions a screen may OFFER for a given (status, role). The server re-validates every transition and
// ownership — the client never grants itself a transition; an illegal tap is rejected server-side (Law: untrusted
// client). `nextActions` is what drives the detail screen's action bar.
import type { PillTone } from '@krishalaya/ui-native';

export type OrderRole = 'buyer' | 'seller';
export type OrderAction = 'confirm' | 'packed' | 'ready' | 'recordDelivery' | 'complete' | 'cancel' | 'review' | 'report' | 'track';

/** Status → chip tone. Unknown/intermediate statuses fall back to neutral (degrade-never-die). */
export function orderStatusTone(status: string): PillTone {
  switch (status) {
    case 'completed': case 'delivered': return 'success';
    case 'confirmed': case 'packed': case 'ready': return 'info';
    case 'picked_up': case 'in_transit': case 'out_for_delivery': return 'accent';
    case 'cancelled': case 'refunded': case 'partially_refunded': return 'danger';
    case 'disputed': return 'warning';
    default: return 'neutral'; // created / payment_pending / partially_fulfilled / unknown
  }
}

const IN_TRANSIT = new Set(['picked_up', 'in_transit', 'out_for_delivery']);

/** Which actions a screen may OFFER for (status, role). Order matters → drives button order. The SERVER is the
 * authority: it rejects any transition that isn't legal for this caller/state, so this is purely about UX. */
export function nextActions(status: string, role: OrderRole): OrderAction[] {
  if (role === 'seller') {
    switch (status) {
      case 'created': case 'payment_pending': return ['confirm', 'cancel', 'report'];
      case 'confirmed': return ['packed', 'cancel', 'report'];
      case 'packed': return ['ready', 'report'];
      case 'ready': return ['recordDelivery', 'report'];
      case 'delivered': return ['complete', 'track', 'report'];
      case 'completed': return ['review'];
      default: return IN_TRANSIT.has(status) ? ['track', 'report'] : [];
    }
  }
  // buyer
  switch (status) {
    case 'created': case 'payment_pending': case 'confirmed': return ['cancel', 'report'];
    case 'packed': case 'ready': return ['report'];
    case 'delivered': return ['complete', 'track', 'report'];
    case 'completed': return ['review'];
    default: return IN_TRANSIT.has(status) ? ['track', 'report'] : [];
  }
}

/** Proof-of-delivery OTP: exactly the server's contract (4–8 digits). Validated client-side for UX; the server
 * re-validates and is the authority on correctness (it hashes + compares). */
export function isValidPodOtp(otp: string): boolean {
  return /^\d{4,8}$/.test((otp ?? '').trim());
}

// --- my-orders list (screen 22): pure filter / progress / row-CTA derivation (no fabricated data) ---
export type OrderFilter = 'all' | 'in_transit' | 'delivered' | 'completed' | 'cancelled';

const FILTER_SETS: Record<Exclude<OrderFilter, 'all'>, ReadonlySet<string>> = {
  in_transit: new Set(['confirmed', 'packed', 'ready', 'picked_up', 'in_transit', 'out_for_delivery']),
  delivered: new Set(['delivered']),
  completed: new Set(['completed']),
  cancelled: new Set(['cancelled', 'refunded', 'partially_refunded']),
};

/** Does an order status belong to the chip filter? 'all' always matches; unknown filters never match. Pure. */
export function matchesOrderFilter(status: string, filter: OrderFilter): boolean {
  return filter === 'all' ? true : (FILTER_SETS[filter]?.has(status) ?? false);
}

const PROGRESS: Record<string, number> = {
  created: 10, payment_pending: 10, confirmed: 30, packed: 50, ready: 60,
  picked_up: 70, in_transit: 80, out_for_delivery: 90, delivered: 95, completed: 100,
};
/** A 0–100 fulfilment progress derived DETERMINISTICALLY from the real status (not a fabricated metric) — drives
 * the card's mini progress bar. Terminal-negative states collapse to 0. */
export function orderProgress(status: string): number {
  if (status === 'cancelled' || status === 'refunded' || status === 'partially_refunded') return 0;
  return PROGRESS[status] ?? 0;
}

export type OrderListCta = 'pay' | 'track' | 'rate' | null;
/** The single primary action a list card offers for (status, role) — mirrors the design's Pay Now / Track / Rate.
 * Pay is buyer-only on an unpaid order; the server re-validates every action (the client never grants it). */
export function orderListCta(status: string, role: OrderRole): OrderListCta {
  if ((status === 'payment_pending' || status === 'created') && role === 'buyer') return 'pay';
  if (IN_TRANSIT.has(status) || status === 'delivered') return 'track';
  if (status === 'completed') return 'rate';
  return null;
}

// --- seller "Orders Received" (screen 56) ---
export type SellerTab = 'new' | 'active' | 'completed';
/** Which seller-tab a status belongs to. NEW = awaiting the seller's accept/reject; ACTIVE = anything in
 * fulfilment; COMPLETED = terminal (done/cancelled/refunded). Pure; unknown → 'active' (safe middle). */
export function sellerOrderTab(status: string): SellerTab {
  if (status === 'created' || status === 'payment_pending') return 'new';
  if (status === 'completed' || status === 'cancelled' || status === 'refunded' || status === 'partially_refunded') return 'completed';
  return 'active';
}
/** Tab membership test for the seller orders list. Pure. */
export function matchesSellerTab(status: string, tab: SellerTab): boolean {
  return sellerOrderTab(status) === tab;
}

// --- buyer "My Orders" (screen 69): Active / Delivered / Returns tabs ---
export type BuyerTab = 'active' | 'delivered' | 'returns';
const RETURNS = new Set(['refunded', 'partially_refunded', 'returned', 'disputed', 'cancelled']);
/** Which buyer-tab a status belongs to. DELIVERED = delivered/completed (fulfilled); RETURNS = refund/return/
 * dispute/cancel (money-back path); everything else in-flight = ACTIVE. Pure; unknown → 'active'. */
export function buyerOrderTab(status: string): BuyerTab {
  if (status === 'delivered' || status === 'completed') return 'delivered';
  if (RETURNS.has(status)) return 'returns';
  return 'active';
}
export function matchesBuyerTab(status: string, tab: BuyerTab): boolean { return buyerOrderTab(status) === tab; }
export interface BuyerTabCounts { active: number; delivered: number; returns: number }
/** Counts per tab from the REAL loaded orders (honest loaded-count — the list read-model has no grand total, so
 * this reflects what's fetched, never a fabricated figure §13). Pure. */
export function buyerOrderCounts(orders: readonly { status: string }[]): BuyerTabCounts {
  const c: BuyerTabCounts = { active: 0, delivered: 0, returns: 0 };
  for (const o of orders) c[buyerOrderTab(o.status)]++;
  return c;
}

/** Minimal shape the seller-stats reducer needs (a subset of OrderListItem). */
export interface SellerStatsOrder { status: string; totalMinor: string; createdAt?: string }
export interface SellerOrderStats { newCount: number; activeCount: number; monthMinor: string }
/** Derive the header KPIs (New count, In-Progress count, This-Month gross) from the REAL loaded seller orders.
 * Money is summed as BigInt minor units (Law 2). NOTE: this aggregates the orders currently loaded — a dedicated
 * seller order-stats endpoint is the production path for exact lifetime/period totals (§13); it never fabricates.
 * Pure. `nowMs` defaults to Date.now() so tests can pin the month. */
export function sellerOrderStats(orders: readonly SellerStatsOrder[], nowMs: number = Date.now()): SellerOrderStats {
  const now = new Date(nowMs);
  const y = now.getUTCFullYear(); const m = now.getUTCMonth();
  let newCount = 0; let activeCount = 0; let month = 0n;
  for (const o of orders) {
    const tab = sellerOrderTab(o.status);
    if (tab === 'new') newCount++;
    else if (tab === 'active') activeCount++;
    if (o.createdAt) {
      const d = new Date(o.createdAt);
      if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() === y && d.getUTCMonth() === m) {
        try { month += BigInt(o.totalMinor); } catch { /* skip a malformed amount, never crash */ }
      }
    }
  }
  return { newCount, activeCount, monthMinor: month.toString() };
}

/** The order-list read-model returns `counterparty` as the other party's raw userId (a UUID), not a display name —
 * so the card must NOT print a UUID as if it were a title. Returns the counterparty ONLY when it looks like a human
 * name; a UUID (or empty) → null so the screen falls back to a neutral label (§13 — never show a raw id as data).
 * Pure. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function counterpartyLabel(counterparty: string | null | undefined): string | null {
  const s = (counterparty ?? '').trim();
  if (!s || UUID_RE.test(s)) return null;
  return s;
}

// --- seller order-decision (screen 57) ---
/** What the seller nets on an order = subtotal − platform commission, as BigInt minor units (Law 2). Both inputs
 * are real OrderDetail fields; the result floors at 0 (never negative). The authoritative payout is computed
 * server-side at settlement — this mirrors the design's two-line breakdown for the accept decision. Pure. */
export function sellerNetMinor(subtotalMinor: string, commissionMinor: string): string {
  try {
    const net = BigInt(subtotalMinor) - BigInt(commissionMinor);
    return net > 0n ? net.toString() : '0';
  } catch { return '0'; }
}

/** Minutes left to decide on an order, from the real acceptanceDeadline. null when there's no deadline / it's
 * unparseable (the screen then hides the countdown rather than inventing one). <=0 ⇒ expired. Pure. */
export function decisionMinutesLeft(deadlineIso: string | null | undefined, nowMs: number = Date.now()): number | null {
  if (!deadlineIso) return null;
  const t = new Date(deadlineIso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((t - nowMs) / 60000);
}

// --- shipment tracking (logistics) ---
/** The happy-path delivery sequence shown as a progress timeline. Terminal-negative states (failed/returned/
 * cancelled) are handled separately by the screen. */
export const TRACKING_SEQUENCE = ['pending', 'assigned', 'pickup_scheduled', 'picked_up', 'in_transit', 'at_hub', 'out_for_delivery', 'delivered'] as const;
export type TrackingStep = { key: string; reached: boolean; current: boolean };

/** Map a shipment status to ordered steps with reached/current flags (pure, for the tracking timeline). An
 * unknown/negative status yields all-unreached so the UI degrades to "not started" rather than crashing. */
export function trackingSteps(shipmentStatus: string): TrackingStep[] {
  const idx = (TRACKING_SEQUENCE as readonly string[]).indexOf(shipmentStatus);
  return TRACKING_SEQUENCE.map((key, i) => ({ key, reached: idx >= 0 && i <= idx, current: i === idx }));
}

// --- order lifecycle timeline (the detail screen's vertical stepper) ---
/** The buyer-facing order journey shown on the detail screen. Distinct from TRACKING_SEQUENCE (logistics): this
 * is the order's own lifecycle the design renders as 7 vertical steps. */
export const ORDER_TIMELINE_STEPS = ['placed', 'payment', 'seller', 'ready', 'out_for_delivery', 'delivered', 'completed'] as const;
export type OrderStepKey = (typeof ORDER_TIMELINE_STEPS)[number];
export type OrderStepState = 'done' | 'active' | 'pending';
export interface OrderTimelineStep { key: OrderStepKey; state: OrderStepState; atIso: string | null }

/** How far along the 7-step journey a real order status has reached (index into ORDER_TIMELINE_STEPS). 'created'/
 * 'payment_pending' have only placed the order; 'confirmed'/'packed' imply payment + seller acceptance; etc.
 * Terminal-negative states reach only step 0 (the banner conveys cancellation separately). Pure. */
function reachedStepIndex(status: string): number {
  switch (status) {
    case 'created': case 'payment_pending': return 0;          // placed only
    case 'confirmed': case 'packed': return 2;                 // payment + seller confirmed
    case 'ready': return 3;
    case 'picked_up': case 'in_transit': case 'out_for_delivery': return 4;
    case 'delivered': return 5;
    case 'completed': return 6;
    default: return 0;                                         // cancelled/refunded/unknown → degrade to placed
  }
}

/** Per-step real timestamps. With the tracking feed (GET orders/:id/tracking) every order-status transition is
 * stamped, so payment/seller/out-for-delivery times are now REAL when present; anything the feed doesn't carry
 * stays null (§13 — the UI shows the step without a fabricated time). */
export interface OrderTimelineTimestamps {
  placed?: string | null;
  payment?: string | null;
  seller?: string | null;
  ready?: string | null;
  out_for_delivery?: string | null;
  delivered?: string | null;
  completed?: string | null;
}

/** Build the detail-screen timeline from the REAL order status + whatever timestamps the contract provides.
 * State: steps before the frontier are done, the frontier is active (unless it's the terminal step → done),
 * the rest pending. No times are invented — atIso is null where no contract field exists. Pure. */
export function orderTimeline(status: string, ts: OrderTimelineTimestamps = {}): OrderTimelineStep[] {
  const cancelled = status === 'cancelled' || status === 'refunded' || status === 'partially_refunded';
  const reached = reachedStepIndex(status);
  const last = ORDER_TIMELINE_STEPS.length - 1;
  const atFor: Record<OrderStepKey, string | null> = {
    placed: ts.placed ?? null, payment: ts.payment ?? null, seller: ts.seller ?? null, ready: ts.ready ?? null,
    out_for_delivery: ts.out_for_delivery ?? null, delivered: ts.delivered ?? null, completed: ts.completed ?? null,
  };
  return ORDER_TIMELINE_STEPS.map((key, i) => {
    // A cancelled/refunded order genuinely placed step 0 (done) then stopped — no active frontier; rest pending.
    const state: OrderStepState = cancelled
      ? (i === 0 ? 'done' : 'pending')
      : i < reached ? 'done' : i === reached ? (reached === last ? 'done' : 'active') : 'pending';
    return { key, state, atIso: atFor[key] };
  });
}

/** Map the REAL order + shipment fields to the timeline's timestamp slots (screen 131 tracking). Only the four
 * times the contracts actually carry are populated — order.createdAt (placed), shipment.pickedUpAt (ready/handover),
 * shipment.deliveredAt (delivered), order.completedAt (completed). Everything else stays null (no invented times,
 * §13). Pure. */
export function trackTimestamps(
  order: { createdAt?: string | null; completedAt?: string | null } | null,
  shipment: { pickedUpAt?: string | null; deliveredAt?: string | null } | null,
): OrderTimelineTimestamps {
  return {
    placed: order?.createdAt ?? null,
    ready: shipment?.pickedUpAt ?? null,
    delivered: shipment?.deliveredAt ?? null,
    completed: order?.completedAt ?? null,
  };
}

// --- seller decision + received-list context (P1-2) ---
/** How many ADDITIONAL line items beyond the primary one (drives a "+N more" hint on the received card). Pure. */
export function moreItemsCount(itemCount: number | null | undefined): number {
  return itemCount && itemCount > 1 ? itemCount - 1 : 0;
}
/** The known business-KYC types (mirrors the server CHECK). Anything else → no honest label (§13). */
const BUSINESS_TYPES = new Set(['proprietorship', 'partnership', 'pvt_ltd', 'llp', 'fpo', 'cooperative', 'trader', 'huf', 'other']);
/** i18n key for a buyer's verified business type, or null when absent/unknown (screen shows nothing, never faked). Pure. */
export function businessTypeKey(businessType: string | null | undefined): string | null {
  return businessType && BUSINESS_TYPES.has(businessType) ? `orderDecision.bizType.${businessType}` : null;
}

// --- tracking feed → timeline (P1-1: real per-step timestamps from the stamped order_events log) ---
/** Minimal shapes from the SDK OrderTracking feed (kept local so this stays pure/`import type`-free). */
export interface OrderEventLike { toStatus: string; at: string }
export interface ShipmentEventLike { status: string; at: string; lat: number | null; lng: number | null }
export interface TrackingLike {
  createdAt?: string | null; completedAt?: string | null;
  orderEvents?: readonly OrderEventLike[];
  shipment?: { pickedUpAt?: string | null; deliveredAt?: string | null } | null;
  shipmentEvents?: readonly ShipmentEventLike[];
}

/** First (earliest) timestamp at which the order reached a given status, from the stamped transition log. */
function firstAtForStatus(events: readonly OrderEventLike[] | undefined, status: string): string | null {
  if (!events) return null;
  for (const e of events) if (e.toStatus === status) return e.at; // events arrive oldest-first
  return null;
}

/** Build the 7-step timeline timestamps from the REAL tracking feed. Order-status transitions supply
 * payment/seller (both at 'confirmed' in this order model), ready, out-for-delivery, delivered and completed;
 * the shipment's pickedUpAt/deliveredAt are honest fallbacks. Nothing is invented — a step with no matching
 * stamped event stays null (§13). Pure. */
export function trackTimestampsFromEvents(t: TrackingLike): OrderTimelineTimestamps {
  const oe = t.orderEvents;
  const confirmedAt = firstAtForStatus(oe, 'confirmed');
  return {
    placed: firstAtForStatus(oe, 'created') ?? t.createdAt ?? null,
    payment: confirmedAt,                                           // order confirms only once paid
    seller: confirmedAt,                                            // seller acceptance == 'confirmed'
    ready: firstAtForStatus(oe, 'ready') ?? t.shipment?.pickedUpAt ?? null,
    out_for_delivery: firstAtForStatus(oe, 'out_for_delivery') ?? null,
    delivered: firstAtForStatus(oe, 'delivered') ?? t.shipment?.deliveredAt ?? null,
    completed: firstAtForStatus(oe, 'completed') ?? t.completedAt ?? null,
  };
}

/** The most recent shipment location ping (a rider GPS point), or null when none has been posted. Used to show
 * an honest "last updated <time>" on the tracking map — never a fabricated ETA or checkpoint name (§13). Pure. */
export function lastKnownLocation(events: readonly ShipmentEventLike[] | undefined): { lat: number; lng: number; at: string } | null {
  if (!events || events.length === 0) return null;
  let best: { lat: number; lng: number; at: string } | null = null;
  for (const e of events) {
    if (e.lat == null || e.lng == null) continue;
    if (!best || e.at > best.at) best = { lat: e.lat, lng: e.lng, at: e.at };
  }
  return best;
}

export type OrderBannerKey = 'placed' | 'preparing' | 'on_the_way' | 'delivered' | 'completed' | 'cancelled';
/** The headline group the status banner shows — maps the real status to one of the design's banner messages.
 * Pure; unknown → 'placed' (safe default). */
export function orderBannerKey(status: string): OrderBannerKey {
  if (status === 'cancelled' || status === 'refunded' || status === 'partially_refunded') return 'cancelled';
  if (status === 'completed') return 'completed';
  if (status === 'delivered') return 'delivered';
  if (IN_TRANSIT.has(status)) return 'on_the_way';
  if (status === 'confirmed' || status === 'packed' || status === 'ready') return 'preparing';
  return 'placed';
}
