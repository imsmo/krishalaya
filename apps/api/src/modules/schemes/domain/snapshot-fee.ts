// modules/schemes/domain/snapshot-fee.ts · which fee a farmer actually owes when they submit. Pure, no I/O.
//
// THE BUG THIS CLOSES. `submit` used to re-read the LIVE `schemes` row and charge `schemes.processing_fee_minor`. A
// farmer who opened a draft when SMAM's processing fee was ₹0 and submitted a week later — after a platform operator
// raised it to ₹50 — was charged ₹50, on an application whose own `scheme_version` said it was filed under the older
// rules. The paperwork and the money disagreed, and the paperwork is what a grievance officer reads.
//
// The wallet leg is idempotency-keyed on the APPLICATION (`schemefee:<id>`), so this is not a double-charge bug — it
// is a wrong-amount bug, which is quieter and harder to notice: nobody sees an error, the fee is simply not the one
// the farmer agreed to.
//
// Migration 0105 made the fix possible by giving the application a real pointer to the rule set it was filed under.
// Where that pointer resolves, the snapshot decides the fee. Where it does not — applications drafted before 0105,
// whose version's rules were overwritten in place and are gone — the live fee is used AND SAID OUT LOUD, because the
// alternative (refusing to let those farmers submit) punishes them for a schema defect that was never theirs.
import { InvalidApplicationError } from './schemes.errors';

export type FeeDecision =
  /** The fee the applicant was shown, taken from the version they filed under. The normal case from 0105 onward. */
  | { source: 'snapshot'; versionId: string; version: number; feeMinor: bigint }
  /** No resolvable snapshot: the application predates 0105. The live fee is charged and the response says so. */
  | { source: 'live_fallback'; reason: 'pre_0105_application_has_no_resolvable_version'; feeMinor: bigint };

export interface VersionFee { id: string; version: number; processingFeeMinor: bigint }

/** Decide the fee, and return WHERE IT CAME FROM rather than just a number.
 *
 *  Returning a bare bigint would have made the fallback invisible — the one thing about this decision that a caller,
 *  a support agent and an auditor all need to be able to see. `source` travels into the submit response and into the
 *  audit trail for exactly that reason.
 */
export function feeForSubmission(snapshot: VersionFee | null, liveFeeMinor: bigint): FeeDecision {
  if (snapshot) {
    if (snapshot.processingFeeMinor < 0n) throw new InvalidApplicationError('a scheme version cannot carry a negative processing fee');
    return { source: 'snapshot', versionId: snapshot.id, version: snapshot.version, feeMinor: snapshot.processingFeeMinor };
  }
  if (liveFeeMinor < 0n) throw new InvalidApplicationError('a scheme cannot carry a negative processing fee');
  return { source: 'live_fallback', reason: 'pre_0105_application_has_no_resolvable_version', feeMinor: liveFeeMinor };
}

/** True when the fee moved between what the applicant was shown and what the live row now says.
 *
 *  Not used to CHANGE the charge — the snapshot always wins. It is surfaced so a support agent looking at a
 *  ₹0 charge against a scheme that now costs ₹50 can see that this is correct and why, instead of filing it as a
 *  billing bug. A silent correctness is the kind people "fix".
 */
export function feeDivergedFromLive(decision: FeeDecision, liveFeeMinor: bigint): boolean {
  return decision.source === 'snapshot' && decision.feeMinor !== liveFeeMinor;
}
