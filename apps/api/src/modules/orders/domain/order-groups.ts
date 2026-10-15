// modules/orders/domain/order-groups.ts · PC-56 STORE-3a · B1 (founder D4, survey B8 / E1) — THE BUYER'S ORDER TABS, FROM ONE MAPPING. PURE.
//
// W288 shows a buyer five tabs over the 15-state machine: All · Active · Needs attention · Completed · Cancelled. The buyer list took one exact
// `status` and the counts existed for STAFF only (`console/views`, a different mapping — the seller's working views). This is the BUYER's
// mapping, exhaustive over `ORDER_STATUSES` (a status added to the machine without a decision here fails to compile — `assertNever` — and the
// unit spec walks the list: every status in exactly one group):
//   attention  = what only the BUYER can move (founder D4, 2026-10-15): awaiting their payment (`payment_pending`) and delivered, awaiting
//                their confirmation (`delivered`). (The review-invite bucket joins in STORE-5.)
//   completed  = `completed`
//   cancelled  = `cancelled` + `refunded` (the order is over and the money went back)
//   active     = every other status in flight (the other ten — including `disputed`, `partially_refunded`, `partially_fulfilled`)
//   all        = no filter
import { ORDER_STATUSES, OrderStatus } from './order.state';

export const ORDER_GROUPS = ['all', 'active', 'attention', 'completed', 'cancelled'] as const;
export type OrderGroup = (typeof ORDER_GROUPS)[number];
/** The four groups a status can belong to (`all` is every status). */
export type OrderStatusGroup = Exclude<OrderGroup, 'all'>;

/** Bounded counts (Law 11 — never an unbounded COUNT over a buyer's history): above this the tab says "99+"-style `capped`. */
export const ORDER_GROUP_COUNT_CAP = 100;

export function orderGroupOf(status: OrderStatus): OrderStatusGroup {
  switch (status) {
    case 'payment_pending':
    case 'delivered':
      return 'attention';
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'refunded':
      return 'cancelled';
    case 'created': case 'confirmed': case 'packed': case 'ready': case 'picked_up': case 'in_transit': case 'out_for_delivery':
    case 'disputed': case 'partially_refunded': case 'partially_fulfilled':
      return 'active';
    default:
      return assertNever(status);
  }
}

function assertNever(s: never): never { throw new Error(`orderGroupOf: unmapped order status ${String(s)}`); }

/** The statuses a group filters on; `all` → null (no filter). Ordered as the machine lists them. */
export function statusesOf(group: OrderGroup): OrderStatus[] | null {
  if (group === 'all') return null;
  return ORDER_STATUSES.filter((s) => orderGroupOf(s) === group);
}

export function isOrderGroup(v: unknown): v is OrderGroup {
  return typeof v === 'string' && (ORDER_GROUPS as readonly string[]).includes(v);
}
