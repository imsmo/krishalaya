// core/money/rounding.ts · DEV-26, Q15 RATIFIED ROUNDING MODE (Design_Program/12_G0-2_DECISION_REGISTER.md line 44,
// ENGINEERING-ROUTED — "rounding mode" was named but never centrally decided; this file is the decision + the one
// canonical implementation, per this batch's own brief: "Money paths are Law 2 territory... rounding happens in
// minor units, never float math... one canonical implementation, consumed everywhere — no per-app copies.")
//
// GROUNDING (grep-verified this batch, before writing a line): every money-split computation already in the repo
// — `payments/domain/commission-rule.entity.ts` (`applyBps`, commission/GST/TDS splits),
// `ambassadors/domain/commission-plan.entity.ts` (referral commission), `education/domain/course.entity.ts`
// (instructor royalty), `auctions/read-models/my-bids.read-model.ts` (EMD-from-bid-percentage),
// `insurance/domain/premium-calc.ts` (govt PMFBY subsidy split) — independently arrived at the IDENTICAL bigint
// expression `(amountMinor * BigInt(bps)) / 10000n`, i.e. FLOOR (truncate-toward-zero; every value here is
// non-negative so floor = truncation). This was never written down as a ratified rule; it was arrived at
// independently five times, which is itself the Golden-Law-4 "no per-app copies" problem Q15 names.
//
// RATIFIED RULE (Q15, this batch): floor(amountMinor * bps / 10000), bigint-exact, no float at any step. The
// remainder that floor division "loses" is NEVER independently re-rounded on the other side of a split — the
// commission-rule.entity.ts header already states the correct invariant-preserving pattern precisely:
// "the seller's net is the RESIDUAL (gross − commission − gst − tds) so rounding can never break the zero-sum
// invariant — the split always sums back to the gross." Every caller of this helper MUST follow the same
// discipline: compute every deducted/derived share via `applyBpsFloor`, then derive the LAST remaining share as
// a subtraction residual, never as its own independently-floored bps calculation — otherwise the parts would not
// sum to the whole by up to (n-1) minor units per split, a real zero-sum violation Law 2 forbids.
const BPS_DENOMINATOR = 10000n;

/**
 * floor(amountMinor * bps / 10000) in bigint — the ONE canonical bps-of-a-minor-unit-amount calculation for the
 * whole platform (Q15). `bps` is basis points (1 bps = 0.01%); a negative or fractional `bps` is coerced via
 * `BigInt(Math.trunc(bps))` so a caller can never pass a non-integer bps and get silently-wrong bigint coercion
 * (BigInt() throws on a non-integer number — Math.trunc prevents that throw from ever being a caller's problem).
 */
export function applyBpsFloor(amountMinor: bigint, bps: number): bigint {
  return (amountMinor * BigInt(Math.trunc(bps))) / BPS_DENOMINATOR;
}
