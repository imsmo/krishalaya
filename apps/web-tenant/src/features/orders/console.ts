// apps/web-tenant/src/features/orders/console.ts · W133's working views + W134's money truth (PC-56 TENANT-3a).
// Pure: no React, no I/O, no SDK runtime — every rule here is unit- and mutation-tested.

export const ORDER_VIEW_TABS = ['all', 'needs_action', 'in_progress', 'completed', 'disputed', 'cancelled_refunded'] as const;
export type OrderViewTab = (typeof ORDER_VIEW_TABS)[number];

export function isOrderViewTab(v: string | undefined): v is OrderViewTab {
  return v !== undefined && (ORDER_VIEW_TABS as readonly string[]).includes(v);
}

/** A tab link NEVER carries the cursor — a keyset cursor is a position in ONE ordered set (the 1b lesson, held
 *  for the third module). */
export function viewHref(tab: OrderViewTab): string {
  return tab === 'all' ? '/orders' : `/orders?view=${tab}`;
}

/** The acceptance clock W133 prints as "expires 17:41". Returns null when the order is not waiting on one —
 *  a countdown on an order nobody has to accept is a deadline invented for decoration. */
export type AcceptanceClock = { kind: 'live'; minutesLeft: number } | { kind: 'expired' } | null;

export function acceptanceClock(status: string, acceptanceDeadline: string | null, now: Date): AcceptanceClock {
  if (status !== 'payment_pending' && status !== 'created') return null;
  if (!acceptanceDeadline) return null;
  const ms = new Date(acceptanceDeadline).getTime() - now.getTime();
  return ms <= 0 ? { kind: 'expired' } : { kind: 'live', minutesLeft: Math.floor(ms / 60_000) };
}

/** Status tone. `disputed` and `payment_pending` are the two an operator must act on; nothing celebrates. */
export function orderStatusClass(status: string): string {
  return status === 'disputed' ? 'kv-badge kv-badge--frozen' : 'kv-badge';
}

/** W134's money box: which i18n key explains a line's BASIS. The mapping is exhaustive over the three bases, so a
 *  new basis cannot reach the screen without its explanation. */
export function basisKey(basis: string): 'chargedAtOrder' | 'settlementTime' | 'notApplicable' {
  if (basis === 'charged_at_order') return 'chargedAtOrder';
  if (basis === 'settlement_time') return 'settlementTime';
  return 'notApplicable';
}

/** Should this money line be shown at all? A settlement-time line that is ZERO on the order row carries no
 *  information for the reader — but it is NOT hidden silently: the box prints one sentence saying settlement-time
 *  figures live on the settlement statement, so an absent row is explained rather than merely missing. */
export function showMoneyLine(l: { minor: string; basis: string }): boolean {
  return l.basis === 'charged_at_order' || BigInt(l.minor) !== 0n;
}

/** The snapshot verdict, as the three honest sentences it can be. `placed_before_snapshot` is the one that matters:
 *  the order was priced with rules nobody recorded, and no amount of reading can recover them. */
export function snapshotKey(s: { present: boolean; reason: string }): 'recorded' | 'beforeSnapshot' | 'noCharges' {
  if (s.present) return 'recorded';
  return s.reason === 'no_charges_applied' ? 'noCharges' : 'beforeSnapshot';
}
