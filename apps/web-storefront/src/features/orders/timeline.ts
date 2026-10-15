// apps/web-storefront/src/features/orders/timeline.ts · PURE mapping of a server order status to a progress
// timeline the UI can render. The authoritative status string comes from the API; this only decides how far along
// the happy-path the order is, and flags the terminal off-path states (cancelled / disputed). No I/O, no i18n (the
// component maps stepKeys → localized labels), no money → trivially unit-tested. Tolerant: an unrecognised status
// leaves currentIndex at -1 and the component still shows the raw/known status verbatim, never inventing progress.

/** The happy-path lifecycle, in order (mirrors the orders resource's transitions). */
export const ORDER_STEPS = ['placed', 'confirmed', 'packed', 'ready', 'delivered', 'completed'] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];

// Map the various server status spellings onto a canonical step (best-effort; the raw status is still shown).
const ALIAS: Record<string, OrderStep> = {
  placed: 'placed', created: 'placed', pending: 'placed', pending_payment: 'placed', awaiting_payment: 'placed', paid: 'confirmed',
  confirmed: 'confirmed', accepted: 'confirmed',
  packed: 'packed', packing: 'packed',
  ready: 'ready', ready_for_pickup: 'ready', shipped: 'ready', dispatched: 'ready', in_transit: 'ready',
  // PC-56 STORE-3a · C2 (survey F-12): the API's own statuses on the way — mapped, never left off the bar (picked up and on the road are past
  // `ready`, not yet `delivered`); a partially fulfilled order WAS delivered (its gap is not refunded — refused by name, founder D2)
  payment_pending: 'placed', picked_up: 'ready', out_for_delivery: 'ready', partially_fulfilled: 'delivered',
  delivered: 'delivered',
  completed: 'completed', complete: 'completed', closed: 'completed',
};

// PC-56 STORE-3a · C2 (survey F-12, mutation candidate 9): `refunded` and `partially_refunded` are their OWN terminal states — a refunded order
// (a dispute's refund) is not "cancelled", and the buyer must be told the money came back, not that the order was called off.
export type OrderTerminal = 'cancelled' | 'disputed' | 'refunded' | 'partially_refunded';
const TERMINAL: Record<string, OrderTerminal> = {
  cancelled: 'cancelled', canceled: 'cancelled', refunded: 'refunded', partially_refunded: 'partially_refunded',
  disputed: 'disputed', dispute: 'disputed', in_dispute: 'disputed',
};

export interface OrderTimelineModel {
  stepKeys: readonly OrderStep[];
  /** Index into stepKeys of the furthest-reached step, or -1 if the status doesn't map onto the happy path. */
  currentIndex: number;
  /** Set when the order is off the happy path; the timeline should show this instead of progressing. */
  terminal: OrderTerminal | null;
}

export function orderTimeline(status: string | null | undefined): OrderTimelineModel {
  const s = (status ?? '').trim().toLowerCase();
  const terminal = TERMINAL[s] ?? null;
  const step = ALIAS[s];
  const currentIndex = step ? ORDER_STEPS.indexOf(step) : -1;
  return { stepKeys: ORDER_STEPS, currentIndex, terminal };
}
