// apps/admin-api/src/modules/appeals/domain/appeal.ts · W097 + W1953–W1955 (PC-56 ADMIN-SWEEP-b1).
//
// Pure rules for the appeals desk — no I/O. The transactions live in the services; what lives here is every sentence
// the desk can be refused with, because on this screen the refusals ARE the design: "a different reviewer than the
// original decides — always" (W097), and a decision without its reasoning is a decision the appellant cannot read.
//
// THE SEVENTEENTH MAKER-CHECKER SITE, and the odd one out: everywhere else the maker proposes and the checker
// approves the SAME act; here the "maker" is whoever made the ORIGINAL moderation call — possibly weeks ago,
// possibly a tenant moderator, possibly a rule — and the checker is whoever sits in judgement on it. The service
// enforces the split with the sentences below; 0067's `chk_appeals_reviewer_neq` stays as the backstop that catches
// a path the service missed, not as the enforcement an operator first meets.
export const APPEAL_STATUSES = ['pending', 'upheld', 'overturned'] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const APPEAL_OUTCOMES = ['upheld', 'overturned'] as const;
export type AppealOutcome = (typeof APPEAL_OUTCOMES)[number];

/** W097: "SLA 48h". The clock is set on SUBMIT by apps/api; this constant exists here so the queue's "SLA left"
 *  column and the overview's breach line (trust-overview.ts, same figure) cannot drift apart silently — the spec
 *  pins them equal. */
export const APPEAL_SLA_HOURS = 48;

/** Same floor the moderation prose bar uses everywhere since 0112 — and 0132's `chk_appeals_decided_shape` is the
 *  database's copy of this number. */
export const DECISION_REASON_MIN = 20;

export interface AppealRow {
  id: string;
  subjectRef: string;
  subjectAction: string;
  appellant: string;
  originalActionRef: string | null;
  originalReviewerId: string | null;
  assignedTo: string | null;
  status: string;
  slaDueAt: string;
  decisionReason: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ SLA */

export type AppealSla =
  | { kind: 'running'; hoursLeft: number }
  | { kind: 'breached'; overHours: number };

/** "SLA left ▴" — the queue's first column, worst first. Floored at whole hours the way the canon prints them
 *  ("28h", "41h"); a breached clock reports how far over, because "0h left" hides the difference between late and
 *  very late. */
export function appealSla(dueAt: string, now: Date): AppealSla {
  const ms = new Date(dueAt).getTime() - now.getTime();
  if (ms >= 0) return { kind: 'running', hoursLeft: Math.floor(ms / 3_600_000) };
  return { kind: 'breached', overHours: Math.ceil(-ms / 3_600_000) };
}

/* ------------------------------------------------------------------ the ≠-reviewer rule, as sentences */

export class AppealRuleError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/**
 * May THIS operator decide THIS appeal? Three refusals, each with the operator's next move in it:
 *  - not pending → nothing to decide;
 *  - not yours → take it first ("Take next" exists so assignment is explicit, recorded and skippable);
 *  - you made the original call → the whole point of the screen refuses you, by name.
 */
export function assertDecidable(a: AppealRow, actorId: string): void {
  if (a.status !== 'pending') {
    throw new AppealRuleError('APPEAL_ALREADY_DECIDED',
      `This appeal was already decided (${a.status}). A decided appeal is never reopened — a wrong decision gets a new appeal, not an edit.`);
  }
  if (a.originalReviewerId && a.originalReviewerId === actorId) {
    throw new AppealRuleError('APPEAL_OWN_DECISION',
      'The decision under appeal was yours, so this appeal cannot be yours to judge — a different reviewer than the original decides, always (W097). Use "Take next" to pick up an appeal that is not about your own call.');
  }
  if (!a.assignedTo) {
    throw new AppealRuleError('APPEAL_UNASSIGNED',
      'This appeal is not assigned to anyone yet. Claim it with "Take next" first — assignment is what records who is judging it.');
  }
  if (a.assignedTo !== actorId) {
    throw new AppealRuleError('APPEAL_NOT_YOURS',
      'This appeal is assigned to another reviewer. Deciding over their shoulder would leave two people half-owning one judgement; take the next unassigned appeal instead.');
  }
}

export function assertDecisionReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (r.length < DECISION_REASON_MIN) {
    throw new AppealRuleError('APPEAL_REASON_TOO_SHORT',
      `The decision reason is shown to the appellant — even when upheld (W097). Write at least ${DECISION_REASON_MIN} characters they can act on.`);
  }
  return r;
}

/** The claim query's WHERE, expressed as a predicate so the spec can drive it without a database: an appeal this
 *  operator may be handed by "Take next". */
export function claimableBy(a: Pick<AppealRow, 'status' | 'assignedTo' | 'originalReviewerId'>, actorId: string): boolean {
  return a.status === 'pending' && a.assignedTo === null
    && (a.originalReviewerId === null || a.originalReviewerId !== actorId);
}

/* ------------------------------------------------------------------ what an empty "Take next" means */

export type TakeNextEmpty =
  | { kind: 'queue_clear' }            // W097's empty state: "Queue clear — no appeals waiting"
  | { kind: 'only_your_own'; n: number }; // everything left is about YOUR original calls — honesty, not emptiness

/** Distinguishing these is the difference between "done for the day" and "find a colleague" — collapsing them would
 *  let a desk of one quietly starve the queue it is disqualified from. */
export function takeNextEmpty(unassignedPending: number, unassignedPendingNotOwn: number): TakeNextEmpty {
  const own = unassignedPending - unassignedPendingNotOwn;
  if (unassignedPending > 0 && unassignedPendingNotOwn === 0) return { kind: 'only_your_own', n: own };
  return { kind: 'queue_clear' };
}

/* ------------------------------------------------------------------ re-exported subject contract */
export { OVERTURN_EFFECTS, SUBJECT_KINDS, parseSubjectRef, overturnPlan, reviewerSourceOf } from './appeal-subjects';
export type { SubjectKind, OverturnPlan, EffectOutcome, ReviewerSource } from './appeal-subjects';
