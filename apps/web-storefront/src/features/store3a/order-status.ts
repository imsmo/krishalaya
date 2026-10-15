// apps/web-storefront/src/features/store3a/order-status.ts · PC-56 STORE-3a · C1 / E9 (survey F-12) — EVERY ORDER STATUS HAS A LABEL, IN EVERY
// LANGUAGE. PURE.
//
// The order list labelled 8 of the API's 15 statuses (`order.status.*`); `created`, `payment_pending`, `picked_up`, `in_transit`,
// `out_for_delivery`, `refunded`, `partially_refunded` and `partially_fulfilled` printed the raw English enum in Hindi and Gujarati too. This is
// the API's list (apps/api orders/domain/order.state.ts ORDER_STATUSES — W288's footnote names exactly these 15), and the parity spec
// (test/store3a-orders.spec.ts) fails if any of them lacks `order.status.<status>` in en, hi or gu. An unknown status is never guessed: the
// chip says "status unknown" (`order.status.unknown`), not the raw string.
export const ORDER_STATUS_LIST = [
  'created', 'payment_pending', 'confirmed', 'packed', 'ready', 'picked_up', 'in_transit',
  'out_for_delivery', 'delivered', 'completed', 'cancelled', 'disputed', 'refunded',
  'partially_refunded', 'partially_fulfilled',
] as const;
export type StoreOrderStatus = (typeof ORDER_STATUS_LIST)[number];

export function isOrderStatus(v: unknown): v is StoreOrderStatus {
  return typeof v === 'string' && (ORDER_STATUS_LIST as readonly string[]).includes(v);
}
/** The catalogue key of a status chip (every one in en / hi / gu); an unknown status → the "unknown" key. */
export function orderStatusKey(status: unknown): string {
  return isOrderStatus(status) ? `order.status.${status}` : 'order.status.unknown';
}
/** The chip's tone: good news, waiting on someone, closed. A closed vocabulary for the class name — never the raw status. */
export function orderStatusTone(status: unknown): 'done' | 'waiting' | 'closed' | 'trouble' {
  if (status === 'completed' || status === 'delivered') return 'done';
  if (status === 'cancelled' || status === 'refunded' || status === 'partially_refunded') return 'closed';
  if (status === 'disputed' || status === 'partially_fulfilled') return 'trouble';
  return 'waiting';
}
