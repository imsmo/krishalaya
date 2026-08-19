// modules/dairy/domain/milk-quality.state.ts · STATE MACHINES for a flagged pour (Law 5) — PC-56 TENANT-6b-1.
//
// TWO machines, deliberately separate, because they answer to different people:
//
//   • the POUR's hold state decides whether a bill may include it (money);
//   • the REVIEW's status records what humans did about it (accountability).
//
// They are kept in step by one function — `holdFor(reviewStatus)` — rather than by two sets of transitions that could
// drift, because the drift would look like this: a review marked `rejected` beside a pour still `held`, or worse, a
// review `cleared` beside a pour never released, which is a farmer's money sitting in a state nobody is looking at.
import { DomainError } from '../../../shared/errors/app-error';

/* --------------------------------------------------------------------------------------------------------- */
/* THE POUR                                                                                                  */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W168: *"Rate card holds this pour's payment only; the member's other pours pay normally."*
 *
 * `none` is not a synonym for "clean and paid" — it means the pour was never flagged. A pour recorded BEFORE this wave
 * with a water flag on it is also `none`, because 0156 deliberately did not back-fill: those pours were already paid,
 * and withholding money months later for a sample nobody kept would be a worse wrong than the one being fixed.
 */
export const HOLD_STATES = ['none', 'held', 'released', 'rejected'] as const;
export type HoldState = (typeof HOLD_STATES)[number];

/** The only states a bill may include. Everything else is a pour whose money is not the cooperative's to move yet. */
export const BILLABLE_HOLD_STATES: readonly HoldState[] = ['none', 'released'];
export function isBillable(h: HoldState): boolean { return BILLABLE_HOLD_STATES.includes(h); }

const HOLD_TRANSITIONS: Readonly<Record<HoldState, readonly HoldState[]>> = Object.freeze({
  none:     ['held'],                 // a flag can be raised on a pour that was recorded clean
  held:     ['released', 'rejected'],
  released: [],                       // terminal: the money has been let go, and re-holding it is a new dispute
  rejected: [],                       // terminal: the pour was not milk the cooperative bought
});

export class IllegalHoldTransitionError extends DomainError {
  constructor(from: string, to: string) { super('HOLD_ILLEGAL_TRANSITION', `Cannot move a pour's hold ${from}→${to}`, 409, { from, to }); }
}
export function canHoldTransition(from: HoldState, to: HoldState): boolean { return HOLD_TRANSITIONS[from]?.includes(to) ?? false; }
export function assertHoldTransition(from: HoldState, to: HoldState): void {
  if (!canHoldTransition(from, to)) throw new IllegalHoldTransitionError(from, to);
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE REVIEW                                                                                                */
/* --------------------------------------------------------------------------------------------------------- */

/**
 * W168's own three steps:
 *   1. *"Operator re-tests sealed sample with member present (today evening shift)"*  → `open` → `retested`
 *   2. *"Confirmed dilution → pour rejected, gentle first-time conversation"*         → `retested` → `rejected`
 *   3. *"Repeat pattern (3+ in 90d) → dairy committee review"*                        → a FLAG on the review, not a state
 *
 * `open → cleared` and `open → rejected` are legal without a re-test, because an operator who flagged the wrong pour
 * must be able to say so, and a member who admits the dilution at the counter should not be made to wait for a
 * ceremony. What the record insists on is that the SKIPPED step is visible: a decision with no `retest_at` is a
 * decision taken without re-testing the sealed sample, and the desk shows it as exactly that.
 */
export const REVIEW_STATUSES = ['open', 'retested', 'cleared', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

const REVIEW_TRANSITIONS: Readonly<Record<ReviewStatus, readonly ReviewStatus[]>> = Object.freeze({
  open:     ['retested', 'cleared', 'rejected'],
  retested: ['cleared', 'rejected'],
  cleared:  [],
  rejected: [],
});

export class IllegalReviewTransitionError extends DomainError {
  constructor(from: string, to: string) { super('QUALITY_REVIEW_ILLEGAL_TRANSITION', `Cannot move a quality review ${from}→${to}`, 409, { from, to }); }
}
export function canReviewTransition(from: ReviewStatus, to: ReviewStatus): boolean { return REVIEW_TRANSITIONS[from]?.includes(to) ?? false; }
export function assertReviewTransition(from: ReviewStatus, to: ReviewStatus): void {
  if (!canReviewTransition(from, to)) throw new IllegalReviewTransitionError(from, to);
}
export function isReviewDecided(s: ReviewStatus): boolean { return s === 'cleared' || s === 'rejected'; }

/**
 * THE ONE PLACE the two machines meet: what a review's status means for the pour's money.
 *
 * `open` and `retested` both hold — a sample under test is not a sample cleared, and the gap between "we tested it"
 * and "we decided" is exactly where money must not move.
 */
export function holdFor(status: ReviewStatus): HoldState {
  switch (status) {
    case 'cleared':  return 'released';
    case 'rejected': return 'rejected';
    default:         return 'held';
  }
}

/* --------------------------------------------------------------------------------------------------------- */
/* THE REPEAT PATTERN                                                                                        */
/* --------------------------------------------------------------------------------------------------------- */

/** W168: *"Repeat pattern (3+ in 90d) → dairy committee review"*. The threshold and the window are the canon's. */
export const COMMITTEE_REVIEW_THRESHOLD = 3;
export const COMMITTEE_REVIEW_WINDOW_DAYS = 90;

/**
 * Whether this flag makes a pattern. `priorReviews90d` counts the member's EARLIER reviews inside the window, so the
 * review being opened is the (n+1)th — "3+ in 90d" is met when there are at least two priors.
 *
 * Counted from reviews OPENED, not from reviews rejected: three flags in three weeks is a pattern worth a
 * conversation even if two were cleared, and a committee that only ever sees confirmed cases cannot notice a centre
 * whose analyzer is drifting. The desk shows the outcomes beside the count so the committee is not misled by it.
 */
export function needsCommitteeReview(priorReviews90d: number): boolean {
  return priorReviews90d + 1 >= COMMITTEE_REVIEW_THRESHOLD;
}
