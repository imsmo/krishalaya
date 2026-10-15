// modules/orders/domain/order-clocks.ts · PC-56 HOTFIX-5 · B1 / B2 (founder D2) — WHEN THE TWO ORDER CLOCKS MAY ACT. PURE.
//
// One rule per clock, used by BOTH the claim (the SQL filter, so a tick never even locks a row it must not touch) and the act (re-checked
// on the row under its lock, so a row claimed by two ticks — or changed between claim and act — is acted on once or not at all).
//
// THE SELLER-CONFIRM TIMEOUT (24 h, `orders.acceptance_deadline`): a `created` (pay-on-delivery, awaiting the seller) or `payment_pending`
// (awaiting the buyer's online payment) order past its deadline is cancelled by the system. EXCEPT `source = 'auction'` (founder D2,
// survey F-2): an auction order is placed with the same 24 h deadline, but its balance window is 48 h (`auctions/domain/lot.ts`
// BALANCE_DUE_MS) and the founder ruled that an unpaid winner FORFEITS the deposit — `AuctionDefaultJob` owns that order's end. A 24 h
// system cancel would have RETURNED the deposit (a system cancel is not a walk-away) a day before the forfeit rule could apply.
// Chosen over aligning the deadline to `balance_due_at`: the exclusion changes no stored row and no other reader of the deadline.
//
// THE QUALITY-WINDOW AUTO-COMPLETE (24 h for every category — a per-category setting is owed, F-22): a `delivered` order past
// `quality_window_ends` with no dispute (a disputed order is `disputed`, not `delivered`) completes as the system, and that completion
// settles escrow through the SAME `orders.order_completed` → payments `OrderSettlementService.settle` path a buyer's or a moderator's
// completion takes (`settle:<orderId>`, one key, one path).
import { OrderStatus } from './order.state';

export const SELLER_CONFIRM_TIMEOUT_STATUSES: readonly OrderStatus[] = Object.freeze(['created', 'payment_pending'] as OrderStatus[]);
/** Order sources the 24 h timeout never touches (founder D2). */
export const SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES: readonly string[] = Object.freeze(['auction']);
export const SELLER_CONFIRM_TIMEOUT_REASON = 'seller_confirm_timeout';

export const QUALITY_WINDOW_STATUSES: readonly OrderStatus[] = Object.freeze(['delivered'] as OrderStatus[]);
/**
 * FAIL CLOSED ON MONEY THAT WAS NEVER THERE (found proving D2 — HOTFIX-5 report §6 / §7 Q1). The settlement a completion triggers
 * (`OrderSettlementService.settle`) posts `escrow −total → seller Main +goods` whether or not the order's money ever reached escrow, and a
 * platform account may go negative: completing a PAY-ON-DELIVERY order (placed `created` — the seeded regime, `online_payments` OFF) credits
 * the seller's wallet from nothing (live probe: escrow 0 → −252,000, seller Main +252,000). A buyer's or a moderator's completion has always
 * done that; the clock would have made it automatic for every such order 24 h after delivery. So the clock completes ONLY an order whose
 * buyer paid online INTO escrow — placed `payment_pending` and since confirmed by the capture (HOTFIX-4's `paid`). A pay-on-delivery order
 * keeps the manual completion (unchanged) until the founder rules on its settlement. One switch, named, so the ruling is a one-line change.
 */
export const QUALITY_WINDOW_REQUIRES_ONLINE_PAYMENT = true;
export const QUALITY_WINDOW_REASON = 'quality_window_closed';

const at = (d: Date | string | null | undefined): number | null => (d == null ? null : new Date(d).getTime());

/** May the seller-confirm timeout cancel this order NOW? */
export function sellerConfirmTimeoutDue(o: { status: OrderStatus; source: string; acceptanceDeadline: Date | string | null }, now: Date): boolean {
  if (!SELLER_CONFIRM_TIMEOUT_STATUSES.includes(o.status)) return false;
  if (SELLER_CONFIRM_TIMEOUT_EXCLUDED_SOURCES.includes(o.source)) return false;
  const deadline = at(o.acceptanceDeadline);
  return deadline !== null && deadline < now.getTime();
}

/** May the quality-window clock complete this order NOW? */
export function qualityWindowDue(o: { status: OrderStatus; qualityWindowEnds: Date | string | null }, now: Date): boolean {
  if (!QUALITY_WINDOW_STATUSES.includes(o.status)) return false;
  const ends = at(o.qualityWindowEnds);
  return ends !== null && ends < now.getTime();
}
