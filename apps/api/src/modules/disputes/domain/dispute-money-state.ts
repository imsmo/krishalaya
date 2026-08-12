// modules/disputes/domain/dispute-money-state.ts · W141's "Money state" card, told truthfully (PC-56 TENANT-3b).
// Pure, no I/O.
//
// **THIS FILE EXISTS BECAUSE THE CANON'S MONEY CARD DESCRIBES A PLATFORM THAT DOES NOT EXIST YET.** W140's subtitle:
// "Money frozen for the disputed amount only — never the whole wallet." W141's card: "₹12,820 frozen in escrow
// (disputed 2 qtl only)" beside "₹51,280 for the delivered 8 qtl already paid out to Vithal Bhai P. on schedule — a
// dispute never starves a farmer of undisputed money."
//
// What actually happens: the buyer's payment enters platform escrow as ONE amount for the whole order; a dispute sets
// the order to 'disputed'; escrow keeps holding all of it until the dispute resolves. There is no per-line escrow and
// no early release. **So on this platform, today, a ₹12,820 dispute on a ₹64,100 order freezes ₹64,100.**
//
// The wrong fixes, all of which were available and all of which are worse:
//   • print the canon's two figures — a farmer reads that ₹51,280 reached them and it did not;
//   • print only the disputed figure as "frozen" — true of the number, false of the situation;
//   • add a `frozen_amount_minor` column and write the disputed amount into it — a stored figure the ledger
//     contradicts, which is the shape 0139's header refuses in writing.
// What this module does instead: reports what is ACTUALLY held, with the BASIS of that figure, and states separately
// that the undisputed remainder is held too. The gap is named on the screen (0139 DEFECT 2) rather than papered over,
// because an FPO planning cash flow needs the true number even when the true number is the disappointing one.
export const PARTIAL_FREEZE_BUILT = false;

/** Where the held figure comes from — every branch is a different sentence, and none of them is a guess. */
export type FrozenBasis =
  /** A successful payment exists and no settlement line does: escrow holds the order's gross. */
  | 'escrow_holds_order_gross'
  /** The order had already settled when the dispute arrived — the money is with the seller and a refund claws it
   *  back leg-for-leg. Nothing is "frozen"; that is a different and worse position for the buyer to be in. */
  | 'settled_to_seller_before_dispute'
  /** COD, or no captured payment: there is nothing in escrow to freeze. Not zero-with-a-basis — zero BECAUSE. */
  | 'no_escrowed_payment';

export type DisputedScope =
  | { kind: 'recorded'; amountMinor: bigint; quantity: string | null }
  /** 0139 never backfills the scope. A dispute raised earlier has none, and this says so rather than substituting
   *  the order total — which would be a claim against a seller that no buyer ever made. */
  | { kind: 'not_recorded' };

export interface MoneyStateInput {
  /** The captured payment's gross, or null when there is none (COD / never captured). */
  paymentGrossMinor: bigint | null;
  /** Has this order already been settled to the seller? (a settlement_line exists) */
  settled: boolean;
  disputedAmountMinor: bigint | null;
  disputedQuantity: string | null;
}

export interface MoneyStateView {
  scope: DisputedScope;
  basis: FrozenBasis;
  /** What is actually held by the platform right now. null when unknowable from the order alone. */
  heldMinor: bigint | null;
  /** gross − disputed, when both are known: the part of this order nobody is contesting. */
  undisputedMinor: bigint | null;
  /** TRUE when the undisputed remainder is being held as well — the sentence W141 does not have. */
  undisputedHeldToo: boolean;
  /** The most a refund on this dispute may be, and why. */
  maxRefundableMinor: bigint | null;
}

export function disputeMoneyState(i: MoneyStateInput): MoneyStateView {
  const scope: DisputedScope = i.disputedAmountMinor != null && i.disputedAmountMinor > 0n
    ? { kind: 'recorded', amountMinor: i.disputedAmountMinor, quantity: i.disputedQuantity }
    : { kind: 'not_recorded' };

  const basis: FrozenBasis = i.paymentGrossMinor == null
    ? 'no_escrowed_payment'
    : i.settled ? 'settled_to_seller_before_dispute' : 'escrow_holds_order_gross';

  const gross = i.paymentGrossMinor;
  const heldMinor = basis === 'escrow_holds_order_gross' ? gross : 0n;

  // The remainder is arithmetic, and it is only stated when BOTH inputs are real. A disputed amount larger than the
  // gross is not clamped silently to zero: it is refused as unknowable, because the two figures disagreeing means
  // one of them is wrong and picking a winner would hide that.
  const undisputedMinor = gross != null && scope.kind === 'recorded' && scope.amountMinor <= gross
    ? gross - scope.amountMinor
    : null;

  return {
    scope,
    basis,
    heldMinor,
    undisputedMinor,
    undisputedHeldToo: basis === 'escrow_holds_order_gross' && undisputedMinor != null && undisputedMinor > 0n,
    maxRefundableMinor: maxRefundable(gross, scope),
  };
}

/** A refund can never exceed the payment, and never exceed a RECORDED claim. With no recorded claim the ceiling is
 *  the payment — and the API then requires the resolver to type the figure, so that a full refund on an unscoped
 *  dispute is an act somebody performed rather than a default the system chose. */
export function maxRefundable(paymentGrossMinor: bigint | null, scope: DisputedScope): bigint | null {
  if (paymentGrossMinor == null) return null;
  if (scope.kind === 'not_recorded') return paymentGrossMinor;
  return scope.amountMinor < paymentGrossMinor ? scope.amountMinor : paymentGrossMinor;
}
