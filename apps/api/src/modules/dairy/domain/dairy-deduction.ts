// modules/dairy/domain/dairy-deduction.ts · PC-56 TENANT-6c-4 · what a deduction IS, and when it needs asking.
//
// W169: *"Deductions this cycle ₹1,84,300 — feed credit + loan EMI + insurance — each line itemised"* and
// *"Deductions above 25% of gross need the member's fresh consent, not just standing instructions."*
//
// The VOCABULARY lives in `lookup_values` under type `milk_deduction` (0160 + db/seeds/core/0005) — this file holds
// only the two things that are logic rather than data: which destinations this module knows how to move money to, and
// the consent threshold arithmetic.

/**
 * The destinations a deduction line can be posted to, as named by `lookup_values.meta.destination`.
 *
 * This is a CLOSED set in code on purpose, while the vocabulary itself is open in the database. A new deduction TYPE
 * is a seed row; a new DESTINATION is a mechanism that moves money and needs a wave. `'none'` is a real, seeded value
 * — `insurance` and `share` both carry it today, each with its `unsupported_reason` in the same row — and it is what
 * makes the refusal an operator reads come from the data rather than from a string in a service.
 */
export const DEDUCTION_DESTINATIONS = ['member_credit', 'loan', 'none'] as const;
export type DeductionDestination = (typeof DEDUCTION_DESTINATIONS)[number];

export function isKnownDestination(v: string): v is DeductionDestination {
  return (DEDUCTION_DESTINATIONS as readonly string[]).includes(v);
}

/** One row of the `milk_deduction` vocabulary, as this module needs it. */
export interface DeductionType {
  id: string;
  code: string;
  name: string;
  destination: DeductionDestination;
  /** Present exactly when `destination === 'none'` — the sentence 0160 seeded, shown to whoever is refused. */
  unsupportedReason: string | null;
  /** What `source_id` must point at (`dairy_member_credit`, `loan`). Null for unsupported types. */
  sourceType: string | null;
}

/**
 * DOES THIS BILL NEED THE MEMBER'S FRESH CONSENT?
 *
 * Integer arithmetic only: `deductions * 100 > gross * pct`. Comparing `deductions / gross` against `0.25` would put
 * a float on the path that decides whether a family is asked before a fifth of their fortnight is withheld, and Law 2
 * is not only about the ledger.
 *
 * STRICTLY ABOVE, matching the canon's word: *"Deductions ABOVE 25% of gross"*. A bill deducting exactly a quarter is
 * at the line, not over it. That one comparison is the difference between asking 40 members and asking 41, so it is
 * written once, here, and tested at the boundary.
 */
export function deductionConsentRequired(grossMinor: bigint, deductionsMinor: bigint, thresholdPct: number): boolean {
  if (deductionsMinor <= 0n) return false;
  if (grossMinor <= 0n) return true;   // withholding anything from a bill worth nothing is always a conversation
  return deductionsMinor * 100n > grossMinor * BigInt(thresholdPct);
}

/**
 * Is a recorded consent still FRESH for this bill?
 *
 * The canon's own contrast is *"fresh consent, NOT JUST STANDING INSTRUCTIONS"*, so freshness cannot be a flag on the
 * membership or a date range — it is agreement to THESE figures. TENANT-6c-2 made a bill voidable, rebuildable and
 * re-previewable, so a member can genuinely be shown 3 different sets of numbers for one fortnight; a consent to the
 * first of them is not consent to the third.
 */
export function consentMatchesBill(
  consent: { grossMinor: bigint; deductionsMinor: bigint; granted: boolean } | null,
  bill: { grossMinor: bigint; deductionsMinor: bigint },
): boolean {
  if (!consent || !consent.granted) return false;
  return consent.grossMinor === bill.grossMinor && consent.deductionsMinor === bill.deductionsMinor;
}
