// apps/admin-api/src/modules/appeals/domain/appeal-subjects.ts · the overturn contract (PC-56 ADMIN-SWEEP-b1).
//
// W097, verbatim: "An overturned action: restores the subject (listing/review/access), reverses the risk_event
// (score heals), notifies the appellant with an apology in their language, and feeds the original decision into
// reviewer coaching (W055 pattern) — errors are learning, not blame."
//
// FOUR WRITES, ONE TRANSACTION, AND EVERY OUTCOME NAMED. Half this contract is worse than none of it: an overturn
// that republishes a listing but leaves the −40 risk event standing leaves a farmer flagged for something the
// platform just admitted it got wrong. So the service performs all four inside one tx, and each effect reports what
// actually happened — including the honest negatives ('subject_gone', 'no_risk_event') — into the audit row and the
// response, because "restored" and "there was nothing left to restore" must never print the same.
//
// PROVIDER HONESTY, effect by effect (the survey's question: is there something real behind each write?):
//   1. restore  — REAL for all three subjects: listings un-archive (the exact inverse of applyRemoval, 0112),
//                 reviews move hidden→published (the state machine in apps/api review.state.ts allows it), access
//                 heals by recomputing the score once the reversal lands (risk_scores UPDATE, same write ADMIN-5d's
//                 band change uses).
//   (see EFFECT NOTES below for 2–4)
export const SUBJECT_KINDS = ['listing', 'review', 'account'] as const;
export type SubjectKind = (typeof SUBJECT_KINDS)[number];

/** subject_action (0132's CHECK) → the kind of thing to restore. */
export const ACTION_SUBJECT: Readonly<Record<string, SubjectKind>> = Object.freeze({
  listing_removed: 'listing',
  review_hidden: 'review',
  account_restricted: 'account',
});

/** `subject_ref` is `<kind>:<uuid>` (0067's example: 'listing:LST-…' — the code half is display; the writers use
 *  uuids). Refuses rather than guesses: an unparseable ref would otherwise "restore" nothing and report success. */
export function parseSubjectRef(ref: string, subjectAction: string): { kind: SubjectKind; id: string } | null {
  const i = ref.indexOf(':');
  if (i <= 0) return null;
  const kind = ref.slice(0, i) as SubjectKind;
  const id = ref.slice(i + 1);
  if (!SUBJECT_KINDS.includes(kind) || id.length === 0) return null;
  // the ref and the action must AGREE — 'listing:x' on an account_restricted appeal is a filing error the submit
  // path prevents, and this refusal is what keeps the overturn from restoring the wrong object if it recurs.
  if (ACTION_SUBJECT[subjectAction] !== kind) return null;
  return { kind, id };
}

/* ------------------------------------------------------------------ the four effects */

export const OVERTURN_EFFECTS = ['restore_subject', 'reverse_risk_event', 'notify_appellant', 'coach_reviewer'] as const;
export type OverturnEffect = (typeof OVERTURN_EFFECTS)[number];

/** What each effect REPORTS. 'done' claims nothing beyond what the tx wrote; every negative is a state the queue
 *  can genuinely be in, with its own sentence in the console. */
export type EffectOutcome =
  | { effect: OverturnEffect; state: 'done'; detail?: string }
  | { effect: OverturnEffect; state: 'nothing_to_do'; detail: string }      // e.g. no risk event was ever scored
  | { effect: OverturnEffect; state: 'subject_gone'; detail: string };      // the thing to restore no longer exists

/** EFFECT NOTES — the honesty half of the contract, in one place:
 *   2. reverse_risk_event — REAL. risk_events is append-only (partitioned, 0003), so the reversal is a compensating
 *      event of opposite weight, and the score HEALS IN THE SAME TRANSACTION: the service recomputes this user's
 *      180-day sum and rewrites risk_scores immediately rather than leaving the farmer flagged until the nightly
 *      recompute job happens to run. The formula (base 70 + weighted sum, clamped, banded) is duplicated from
 *      RISK_SCORE_SOURCE below — the ADMIN-6 "third copy" hazard — so both ends are pinned by tests to the written
 *      constants. Holds and hides score nothing (0112's closing note), so 'nothing_to_do' is the COMMON honest
 *      outcome for reviews, not a failure.
 *   3. notify_appellant — REAL RAIL, HONEST STATUS. The tx queues a moderation_action_notice (0132 gave notices an
 *      appeal origin) in the appellant's own language read from their profile; the apps/api executor settles it
 *      through the notification spine. The console therefore says "queued" until the executor says delivered —
 *      never "sent" at commit time. In-app only: no SMS/voice provider exists anywhere on this platform (the
 *      ADMIN-2b finding), and this screen does not pretend otherwise.
 *   4. coach_reviewer — REAL, BUILT THIS WAVE. moderation_review_lessons (0132): one row per overturned appeal
 *      naming whose call was reversed and the decider's reasoning. W055's `support_coaching_records` cannot carry it
 *      (its agent FK points at tenant users; 0110 dropped exactly that FK from appeals because platform operators
 *      are not users). A lessons register is the feed; scheduling the coaching session stays a human act.
 */
export function overturnPlan(subjectAction: string): OverturnEffect[] {
  // All four, always, in this order — the plan is constant by design. What varies per subject is each effect's
  // OUTCOME, not whether it is attempted; a plan that skipped effects per kind would be the half-contract again.
  void subjectAction;
  return [...OVERTURN_EFFECTS];
}

/* ------------------------------------------------------------------ score healing (effect 2's arithmetic) */

/** The one writer of this formula is apps/api's recompute; this is the second, and it must not drift. */
export const RISK_SCORE_SOURCE = 'apps/api/src/modules/identity/domain/risk-score.entity.ts + jobs/risk-score-recompute.job.ts' as const;
export const RISK_SCORE_BASE = 70;
export const RISK_WINDOW_DAYS = 180;

export function healedScore(weightedTotal: number): number {
  return Math.max(0, Math.min(100, Math.round(RISK_SCORE_BASE + weightedTotal)));
}

/** Verbatim thresholds from RISK_SCORE_SOURCE's bandFor(). */
export function healedBand(score: number): 'trusted' | 'standard' | 'caution' | 'restricted' | 'blocked' {
  if (score >= 80) return 'trusted';
  if (score >= 60) return 'standard';
  if (score >= 40) return 'caution';
  if (score >= 20) return 'restricted';
  return 'blocked';
}

/** The compensating event's code — greppable back to the appeal from the risk file forever. */
export const REVERSAL_EVENT_CODE = 'appeal_overturned' as const;

/* ------------------------------------------------------------------ who the lesson is about */

export type ReviewerSource = 'human' | 'system';

/** The canon's queue shows "system + Ravi T." — a decision with no accountable human routes its lesson to the RULE
 *  that made it (0132's chk_mrl_reviewer_shape holds the pairing). */
export function reviewerSourceOf(originalReviewerId: string | null): ReviewerSource {
  return originalReviewerId ? 'human' : 'system';
}

export interface OverturnPlan { effects: OverturnEffect[] }
