// modules/orders/domain/order-money.ts · W134's money box, told truthfully (PC-56 TENANT-3a). Pure, no I/O.
//
// **THE FINDING THIS FILE ANSWERS: `commission_rule_snapshot` HAS BEEN A DEAD COLUMN SINCE 0005.** W133's own
// subtitle is "Money states (commission, TDS, fees) are snapshotted at order time, never recalculated" and W134
// prints "(2.0%, snapshot)" beside the fee — while the column that would hold that snapshot was never written by
// any code and never read by any code. An immutability promise over an empty column is the ADMIN-6 shape: the
// comment was the feature. TENANT-3a writes it at the one place the rule is actually resolved (checkout), so the
// promise becomes true going forward — and this module makes the read say WHICH orders can honestly answer.
//
// **AND THE SECOND HALF IS A LEGAL-TEXT CORRECTION, NOT A ROUNDING DETAIL.** W134's row reads "TDS 194Q (buyer
// deducts)". Section 194Q is the BUYER's deduction on purchases above ₹50L; what this platform actually computes
// is **194-O** — the marketplace OPERATOR's 1% deduction on the seller's gross — and it computes it at
// SETTLEMENT, into settlement_lines.tds_minor, never onto orders.tds_minor (which is a hardcoded 0 at placement).
// So the order row's TDS is 0 because no TDS applies AT ORDER TIME, not because it was waived; printing "₹0" with
// no basis would let an FPO's accountant conclude their buyers deducted nothing when the deduction happens later,
// under a different section, against the seller. The basis travels with the figure.

/** What an order row can honestly say about each money line. */
export type MoneyBasis = 'charged_at_order' | 'settlement_time' | 'not_applicable_at_order';

export interface MoneyLine {
  key: 'subtotal' | 'delivery' | 'discount' | 'platformFee' | 'tax' | 'commission' | 'tds' | 'total';
  minor: string;
  basis: MoneyBasis;
}

export interface SnapshotState {
  /** true = this order carries the resolved charge rules it was priced with (0139 onward). */
  present: boolean;
  /** Orders placed before the snapshot started being written can never be re-derived — said, not guessed. */
  reason: 'recorded' | 'placed_before_snapshot' | 'no_charges_applied';
}

export interface OrderMoneyView {
  lines: MoneyLine[];
  snapshot: SnapshotState;
  /** The buyer's single number, and the seller's — the two figures every party checks. */
  buyerPaidMinor: string;
  sellerGrossMinor: string;
}

const LINE_BASIS: Record<MoneyLine['key'], MoneyBasis> = {
  subtotal: 'charged_at_order',
  delivery: 'charged_at_order',
  discount: 'charged_at_order',
  platformFee: 'charged_at_order',       // buyer-side, charged NOW (checkout resolves it)
  total: 'charged_at_order',
  tax: 'settlement_time',                // GST on fees is invoiced/settled, not held on the order row
  commission: 'settlement_time',         // seller-side commission is a settlement line, never an order line
  tds: 'settlement_time',                // 194-O at settlement — see the header
};

export interface OrderMoneyRow {
  subtotalMinor: string; deliveryFeeMinor: string; discountMinor: string; taxMinor: string;
  commissionMinor: string; platformFeeMinor: string; tdsMinor: string; totalMinor: string;
  commissionRuleSnapshot: unknown | null;
}

/** Build W134's money box. Every line carries WHERE its number comes from, so a zero is never mistaken for a
 *  waiver and a settlement-time figure is never mistaken for something the buyer already paid. */
export function orderMoneyView(r: OrderMoneyRow): OrderMoneyView {
  const lines: MoneyLine[] = ([
    ['subtotal', r.subtotalMinor], ['delivery', r.deliveryFeeMinor], ['discount', r.discountMinor],
    ['platformFee', r.platformFeeMinor], ['tax', r.taxMinor], ['commission', r.commissionMinor],
    ['tds', r.tdsMinor], ['total', r.totalMinor],
  ] as [MoneyLine['key'], string][]).map(([key, minor]) => ({ key, minor, basis: LINE_BASIS[key] }));

  const charged = BigInt(r.platformFeeMinor) > 0n || BigInt(r.deliveryFeeMinor) > 0n;
  const snapshot: SnapshotState = r.commissionRuleSnapshot
    ? { present: true, reason: 'recorded' }
    : { present: false, reason: charged ? 'placed_before_snapshot' : 'no_charges_applied' };

  return {
    lines,
    snapshot,
    // The buyer paid the total. The seller's gross is the subtotal: buyer-side fees never come out of it — the
    // canon's "farmers receive the full subtotal" is true on THIS tenant because the fee is buyer-side, and this
    // is the arithmetic that says so rather than a sentence claiming it.
    buyerPaidMinor: r.totalMinor,
    sellerGrossMinor: r.subtotalMinor,
  };
}

/** W133's five working views over the 15-state machine (its own tabs). ONE mapping, in one place, exhaustive —
 *  a status that fell through would silently vanish from every tab, which is how an order goes missing. */
export const ORDER_VIEWS = ['needs_action', 'in_progress', 'completed', 'disputed', 'cancelled_refunded'] as const;
export type OrderView = (typeof ORDER_VIEWS)[number];

const VIEW_OF: Record<string, OrderView> = {
  created: 'needs_action', payment_pending: 'needs_action', confirmed: 'needs_action',
  packed: 'in_progress', ready: 'in_progress', picked_up: 'in_progress',
  in_transit: 'in_progress', out_for_delivery: 'in_progress', delivered: 'in_progress',
  completed: 'completed',
  disputed: 'disputed',
  cancelled: 'cancelled_refunded', refunded: 'cancelled_refunded',
  partially_refunded: 'cancelled_refunded', partially_fulfilled: 'in_progress',
};

/** `delivered` sits in IN PROGRESS on purpose: the goods arrived but the money has not closed (escrow releases on
 *  completion, and the dispute window is still open) — calling it "completed" would tell an FPO their money is
 *  settled while it is still held. */
export function viewOfStatus(status: string): OrderView | null {
  return VIEW_OF[status] ?? null;
}

export function statusesInView(view: OrderView): string[] {
  return Object.keys(VIEW_OF).filter((s) => VIEW_OF[s] === view).sort();
}
