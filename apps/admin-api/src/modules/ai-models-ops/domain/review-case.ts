// apps/admin-api/src/modules/ai-models-ops/domain/review-case.ts · W082 + W083, PURE (PC-56 ADMIN-7).
//
// ---------------------------------------------------------------------------
// A PLATFORM AI OPS OFFICER COULD NOT BE RECORDED AS HAVING REVIEWED A CASE
// ---------------------------------------------------------------------------
// `ai_review_queue.reviewer_user_id` is `uuid REFERENCES users(id)` — the farmer table — and admin-api authenticates from
// a self-contained JWT with no database identity. W082's restricted state names `ai.review` for the "AI Ops Officer", and
// `platform_ai_ops` is an OWNER-realm role, so the person the screen is written for is precisely the person the column
// cannot hold. **SIXTH occurrence of this finding** (ADMIN-2d's support reply, the ticket ATTACH, 0067's checker columns,
// 0112's `handled_by_admin_id`, 0114's approval columns, now this), and ADMIN-2d's three wrong fixes are still wrong:
// invent a platform account inside every tenant's user table, record the tenant's own reviewer instead, or drop the FK.
// 0115 adds a second column and `ck_ai_review_one_reviewer` — a resolved case names EXACTLY ONE, because both kinds of
// reviewer are real and recording either as the other is a forgery.
//
// ---------------------------------------------------------------------------
// AND THE QUEUE IS CROSS-TENANT FOR THIS READER, WHICH IS A DIFFERENT QUERY
// ---------------------------------------------------------------------------
// `ai_review_queue` is tenant-scoped with RLS, and `idx_ai_queue_claim` (0029) leads with `tenant_id` — correct for a
// tenant's own reviewer and useless for a platform officer draining one priority order across 1,284 tenants. 0115 adds
// the index that serves the god-mode read (Law 11).
import { AiGovernanceRefusedError } from './ai-models.errors';

export const CASE_STATUSES = ['pending', 'in_review', 'accepted', 'rejected'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** `drift` is in the vocabulary because `drift-watch.job.ts` inserts it — even though that job is dead code
 *  (ADMIN-7-Q2). A CHECK or a union that omitted it would break the job the day somebody wires it, which is the more
 *  likely order of events. */
export const CASE_KINDS = ['fraud_flag', 'low_confidence_grade', 'price_anomaly', 'dispute_triage', 'drift'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export interface CaseRow {
  id: string;
  tenantId: string | null;
  inferenceId: string | null;
  queueKind: string;
  priority: number;
  status: string;
  reviewerUserId: string | null;
  reviewerAdminId: string | null;
  claimedAt: string | null;
  decisionNote: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------------------------------------ */
/* TRIAGE ORDER                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** W082's list is "Priority ▴" then age. Lower priority number = more urgent, matching `payouts.priority` and the
 *  drift watcher's `20`.
 *
 *  OLDEST-FIRST WITHIN A PRIORITY BAND, which is the opposite of nearly every other list in this console and the same
 *  choice ADMIN-5f made on moderation reports. Here age is harm: a `fraud_flag` case holds a farmer's listing OFF the
 *  market while it waits, so the case that has waited longest is the farmer losing the most selling time. Newest-first
 *  would quietly starve exactly the cases that have already cost somebody a day.
 */
export function triageOrder(cases: readonly CaseRow[]): CaseRow[] {
  return [...cases].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const at = Date.parse(a.createdAt);
    const bt = Date.parse(b.createdAt);
    // An unparseable date sorts LAST rather than first. Sorting it first would put a corrupt row at the top of the queue
    // every time it is read, and the desk would work around the screen instead of the row being noticed.
    if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
    if (Number.isNaN(at)) return 1;
    if (Number.isNaN(bt)) return -1;
    return at - bt;
  });
}

/** How long a claimed case may sit before the claim is treated as abandoned.
 *
 *  W083: "Another reviewer holds this case (in_review) — cases are single-owner to avoid conflicting decisions." That is
 *  right and it needs an escape, or a reviewer who claims a fraud case and then closes their laptop holds a farmer's
 *  listing off the market indefinitely. Two hours: long enough that nobody loses work to a lunch break, short enough
 *  that a forgotten case is workable the same day.
 */
export const CLAIM_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export type ClaimState =
  | { kind: 'claimable' }
  /** Held by somebody else, recently. The control is NOT drawn. */
  | { kind: 'held_by_other'; who: string | null; since: string | null }
  /** Held by this viewer — they may proceed to decide. */
  | { kind: 'held_by_you' }
  /** Held, but the claim is stale, so it may be taken over. Recorded as its own state rather than folded into
   *  `claimable`, because taking a case off a colleague should be a visible act with its own wording. */
  | { kind: 'stale_claim'; who: string | null; since: string | null }
  | { kind: 'already_decided'; status: CaseStatus };

export function claimState(c: CaseRow, viewerAdminId: string | null, nowMs: number): ClaimState {
  if (c.status === 'accepted' || c.status === 'rejected') {
    return { kind: 'already_decided', status: c.status };
  }
  if (c.status === 'pending') return { kind: 'claimable' };

  // in_review
  const holder = c.reviewerAdminId ?? c.reviewerUserId ?? null;
  if (c.reviewerAdminId && viewerAdminId && c.reviewerAdminId === viewerAdminId) return { kind: 'held_by_you' };

  const claimedMs = c.claimedAt ? Date.parse(c.claimedAt) : NaN;
  // A missing or unreadable claim time is treated as STALE rather than as a fresh hold. Every case that reached
  // `in_review` before 0115 has no `claimed_at` at all, and reading those as permanently held would make the whole
  // pre-existing in_review backlog untouchable for ever.
  if (Number.isNaN(claimedMs) || nowMs - claimedMs > CLAIM_STALE_AFTER_MS) {
    return { kind: 'stale_claim', who: holder, since: c.claimedAt };
  }
  return { kind: 'held_by_other', who: holder, since: c.claimedAt };
}

export function assertClaimable(c: CaseRow, viewerAdminId: string, nowMs: number): void {
  const s = claimState(c, viewerAdminId, nowMs);
  switch (s.kind) {
    case 'claimable':
    case 'held_by_you':
    case 'stale_claim':
      return;
    case 'already_decided':
      throw new AiGovernanceRefusedError(
        `this case was already ${s.status}. Decisions are not re-opened — a case that needs revisiting is re-raised, so `
        + 'the original decision and its note stay on the record as the training signal they are.');
    default:
      throw new AiGovernanceRefusedError(
        'another reviewer holds this case. Cases are single-owner so two people cannot reach conflicting decisions on '
        + 'the same farmer\'s listing; if they have stepped away, the claim can be taken over after two hours.');
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DECISION                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** W083: the note "teaches the model", and W085's entire override analysis is built out of these notes ("commodity price
 *  spikes read as manipulation"). So the floor is not politeness — a resolved case with an empty note is a training
 *  signal thrown away, and this is the same 20 characters 0112 set on a moderation reason and 0114 on a batch return. */
export const DECISION_NOTE_MIN = 20;

export type Decision = 'accept' | 'reject';

export function assertDecidable(i: { status: string; note: string; decision: Decision }): void {
  if (i.status === 'accepted' || i.status === 'rejected') {
    throw new AiGovernanceRefusedError(`this case was already ${i.status}`);
  }
  // A DECISION MAY ONLY BE MADE FROM A CLAIM. `pending` → `accepted` in one step would mean nobody was ever recorded as
  // holding the case, which is the single-owner rule defeated by skipping a step rather than by breaking one.
  if (i.status !== 'in_review') {
    throw new AiGovernanceRefusedError(
      'take the case first. A decision is recorded against the reviewer who held it, and a case decided without ever '
      + 'being claimed has no owner on the record.');
  }
  if (i.note.trim().length < DECISION_NOTE_MIN) {
    throw new AiGovernanceRefusedError(
      `a decision needs at least ${DECISION_NOTE_MIN} characters of reasoning. This note is what the model learns from `
      + 'and what the override analysis is built out of — an empty one throws the signal away.');
  }
}

/** What a decision does to the inference behind it.
 *
 *  **REJECT MEANS THE HUMAN DISAGREED WITH THE MODEL, so the inference is marked `was_overridden`.** ACCEPT means the
 *  human agreed, and marks nothing — which is the asymmetry that makes the override rate meaningful. Getting this
 *  backwards would invert every figure on W085's board and make a well-behaved model look like a failing one, so it is
 *  stated as data rather than left to a conditional in a service.
 */
export const OVERRIDES_INFERENCE: Readonly<Record<Decision, boolean>> = Object.freeze({
  accept: false,
  reject: true,
});

export interface DecisionOutcome {
  status: Extract<CaseStatus, 'accepted' | 'rejected'>;
  marksOverridden: boolean;
  note: string;
}

export function buildDecision(decision: Decision, note: string): DecisionOutcome {
  return {
    status: decision === 'accept' ? 'accepted' : 'rejected',
    marksOverridden: OVERRIDES_INFERENCE[decision],
    note: note.trim(),
  };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE QUEUE'S OWN HEALTH — W079's tiles                                                             */
/* ------------------------------------------------------------------------------------------------ */

export interface QueueCensus {
  pending: number;
  inReview: number;
  /** The oldest pending case's age in minutes — W082's "oldest 22 min". */
  oldestPendingMinutes: number | null;
  byKind: Record<string, number>;
}

/** W079 prints "Review queue now 148 · oldest 22 min".
 *
 *  `oldestPendingMinutes` is NULL for an empty queue rather than 0. Zero would read as "a case arrived this second",
 *  which is the opposite of "there is nothing waiting" — and on a screen whose job is to say whether humans are keeping
 *  up, those two must not render alike.
 */
export function census(cases: readonly CaseRow[], nowMs: number): QueueCensus {
  let pending = 0; let inReview = 0;
  let oldestMs: number | null = null;
  const byKind: Record<string, number> = {};

  for (const c of cases) {
    if (c.status === 'pending') {
      pending += 1;
      const t = Date.parse(c.createdAt);
      if (!Number.isNaN(t) && (oldestMs === null || t < oldestMs)) oldestMs = t;
    } else if (c.status === 'in_review') inReview += 1;
    if (c.status === 'pending' || c.status === 'in_review') {
      byKind[c.queueKind] = (byKind[c.queueKind] ?? 0) + 1;
    }
  }

  return {
    pending,
    inReview,
    oldestPendingMinutes: oldestMs === null ? null : Math.max(0, Math.floor((nowMs - oldestMs) / 60_000)),
    byKind,
  };
}

/** Is a fraud case waiting? Read across the WHOLE open queue and not the current page, for the reason ADMIN-5f
 *  established with its safety count: a desk told only about what happens to be on screen misses things when the list is
 *  long, and a `fraud_flag` case holds a farmer's listing off the market while it waits. */
export function holdsListings(byKind: Readonly<Record<string, number>>): number {
  return (byKind.fraud_flag ?? 0) + (byKind.low_confidence_grade ?? 0);
}
