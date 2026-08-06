// apps/admin-api/src/modules/support-oversight/domain/coaching.ts · CSAT REVIEW + COACHING rules
// (PC-56 ADMIN-2c, closes ADMIN-2-Q1's review half and ADMIN-2-Q6).
//
// THIS FILE GOVERNS THE MOST SENSITIVE RECORDS IN THE SUPPORT PLANE. A coaching record is a written statement by the
// platform about a named person's performance at their job, held in a system that person's employer can be shown. That
// framing decides every rule below, and the rules are here — in one readable file — rather than spread across a service,
// because somebody will one day need to check what this system does and does not permit.
//
// FOUR RULES THAT ARE NOT NEGOTIABLE, EACH WITH ITS REASON:
//   1. NO RECORD WITHOUT A NAMED AUTHOR AND A REASON. Both are structurally required. An anonymous or unexplained note
//      about somebody's work is not a record, it is a rumour with a timestamp.
//   2. A DISMISSAL IS A DECISION AND IS RECORDED AS ONE. The canon's "dismiss a signal" button could have been a
//      delete. It is not: dismissing is a judgement, it needs a reason, and it is kept — otherwise the ledger shows
//      every intervention and none of the deliberate non-interventions, which misrepresents the lead.
//   3. A SESSION CANNOT BE MARKED HELD WITHOUT AN OUTCOME. Otherwise 'held' becomes a tick clicked on the way past, and
//      the record says a conversation happened that nobody can describe.
//   4. THE SIGNAL MUST BE REAL OR ABSENT, NEVER FABRICATED. A coaching record may cite a rating, a review, or a
//      free-text observation — but the code never invents a signal to satisfy a form. A lead who coaches for a reason no
//      metric produced must be able to say so plainly.
import { InvalidCoachingError } from './support-oversight.errors';

/* ------------------------------------------------------------------ verdicts */

/** What a reviewer may CONCLUDE about a low rating. Named verdicts rather than free text alone, so "how many low scores
 *  were actually the desk's fault?" is answerable without reading four hundred paragraphs. Mirrors 0099's CHECK. */
export const CSAT_VERDICTS = [
  'agent_at_fault',
  'process_at_fault',
  'product_at_fault',
  'outside_our_control',
  'rating_mistaken',
  'needs_more_info',
] as const;
export type CsatVerdict = (typeof CSAT_VERDICTS)[number];
export function isCsatVerdict(v: string): v is CsatVerdict {
  return (CSAT_VERDICTS as readonly string[]).includes(v);
}

/** Verdicts that point at a PERSON rather than at a system. Only these make coaching a coherent follow-up — coaching an
 *  agent because a payment provider was down is punishing somebody for the weather. The service uses this to refuse the
 *  combination rather than to hide the option, because the refusal is the thing worth saying. */
const BLAMES_THE_AGENT = new Set<CsatVerdict>(['agent_at_fault']);
export function verdictSupportsCoaching(v: CsatVerdict): boolean { return BLAMES_THE_AGENT.has(v); }

/** A verdict that says the desk did nothing wrong. Kept separate from `verdictSupportsCoaching` because the two are not
 *  complements: `needs_more_info` neither exonerates nor blames, and treating it as either would be a fabrication. */
const EXONERATES = new Set<CsatVerdict>(['process_at_fault', 'product_at_fault', 'outside_our_control', 'rating_mistaken']);
export function verdictExoneratesAgent(v: CsatVerdict): boolean { return EXONERATES.has(v); }

export const MIN_FINDING = 10;

export interface ReviewInput { responseId: string; verdict: string; finding: string }
export interface Review { responseId: string; verdict: CsatVerdict; finding: string }

/** Validate a verdict. A finding is MANDATORY (rule 1): a verdict with no reasoning is an opinion nobody can check. */
export function assertReview(input: ReviewInput): Review {
  if (!isCsatVerdict(input.verdict)) {
    throw new InvalidCoachingError(`verdict must be one of ${CSAT_VERDICTS.join('|')}`);
  }
  const finding = String(input.finding ?? '').trim();
  if (finding.length < MIN_FINDING) {
    throw new InvalidCoachingError(`finding must be at least ${MIN_FINDING} characters — a verdict with no reasoning is an opinion nobody can check`);
  }
  if (finding.length > 4000) throw new InvalidCoachingError('finding is too long');
  return { responseId: input.responseId, verdict: input.verdict, finding };
}

/* ------------------------------------------------------------------ coaching */

export const COACHING_KINDS = ['shadow_session', 'review_call', 'written_feedback', 'signal_dismissed'] as const;
export type CoachingKind = (typeof COACHING_KINDS)[number];
export function isCoachingKind(v: string): v is CoachingKind {
  return (COACHING_KINDS as readonly string[]).includes(v);
}

export const COACHING_STATUSES = ['scheduled', 'held', 'missed', 'cancelled', 'closed'] as const;
export type CoachingStatus = (typeof COACHING_STATUSES)[number];

/** Kinds that are EVENTS — they happen at a time, somebody attends, and there is something to report afterwards. */
const IS_EVENT = new Set<CoachingKind>(['shadow_session', 'review_call']);
export function isEventKind(k: CoachingKind): boolean { return IS_EVENT.has(k); }

/** The status a NEW record of each kind starts in. Not a caller's choice: a session begins scheduled, a note and a
 *  dismissal have nothing to attend and are closed on arrival (0100 CHECKs both). */
export function initialStatus(kind: CoachingKind): CoachingStatus {
  return isEventKind(kind) ? 'scheduled' : 'closed';
}

/** How a scheduled session may END. `held` needs an outcome (rule 3); the other two are facts about the desk that are
 *  recorded rather than deleted — a session nobody attended is worth knowing about. */
export const SETTLE_STATUSES = ['held', 'missed', 'cancelled'] as const;
export type SettleStatus = (typeof SETTLE_STATUSES)[number];
export function isSettleStatus(v: string): v is SettleStatus {
  return (SETTLE_STATUSES as readonly string[]).includes(v);
}

export const MIN_RATIONALE = 20;
export const MIN_OUTCOME = 10;
/** How far ahead a session may be booked. Not a technical limit — a "shadow session" eight months out is a way of
 *  closing a signal without acting on it, and the record should not help anybody do that quietly. */
export const MAX_SCHEDULE_DAYS = 60;

export interface CoachingInput {
  kind: string;
  agentUserId: string;
  tenantId: string;
  rationale: string;
  scheduledFor?: string | null;
  signalNote?: string | null;
  csatResponseId?: string | null;
  csatReviewId?: string | null;
}
export interface Coaching {
  kind: CoachingKind; status: CoachingStatus;
  agentUserId: string; tenantId: string; rationale: string;
  scheduledFor: string | null; signalNote: string | null;
  csatResponseId: string | null; csatReviewId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validate a coaching record. `now` is injectable so the schedule window is testable without freezing the clock.
 *
 * The checks are ordered so the most important refusal comes first: a record with no reason is rejected before anything
 * about dates, because that is the rule protecting the person the record is about.
 */
export function assertCoaching(input: CoachingInput, now: Date = new Date()): Coaching {
  if (!isCoachingKind(input.kind)) {
    throw new InvalidCoachingError(`kind must be one of ${COACHING_KINDS.join('|')}`);
  }
  const kind = input.kind;

  // RULE 1 — no record without a reason, and long enough to be a reason.
  const rationale = String(input.rationale ?? '').trim();
  if (rationale.length < MIN_RATIONALE) {
    throw new InvalidCoachingError(
      `rationale must be at least ${MIN_RATIONALE} characters — this record is a written statement about a named person's work`);
  }
  if (rationale.length > 4000) throw new InvalidCoachingError('rationale is too long');

  if (!UUID.test(String(input.agentUserId ?? ''))) throw new InvalidCoachingError('agentUserId must be a uuid');
  if (!UUID.test(String(input.tenantId ?? ''))) throw new InvalidCoachingError('tenantId must be a uuid');

  const status = initialStatus(kind);

  // A SESSION NEEDS A TIME; A NOTE MUST NOT CARRY ONE. Mirrors 0100's ck_coaching_kind_shape, refused here so the
  // operator gets a sentence instead of a constraint name.
  let scheduledFor: string | null = null;
  if (isEventKind(kind)) {
    const raw = String(input.scheduledFor ?? '').trim();
    if (!raw) throw new InvalidCoachingError(`a ${kind} needs a date and time`);
    const when = new Date(raw);
    if (Number.isNaN(when.getTime())) throw new InvalidCoachingError('scheduledFor must be a valid date and time');
    // A session in the past cannot be attended. Recording one retrospectively is a different act — settling it — and
    // conflating the two would let somebody log sessions that never happened.
    if (when.getTime() <= now.getTime()) {
      throw new InvalidCoachingError('scheduledFor must be in the future — to record a session that already happened, schedule it and then settle it');
    }
    const days = (when.getTime() - now.getTime()) / 86_400_000;
    if (days > MAX_SCHEDULE_DAYS) {
      throw new InvalidCoachingError(`scheduledFor must be within ${MAX_SCHEDULE_DAYS} days — a session further out than that closes a signal without acting on it`);
    }
    scheduledFor = when.toISOString();
  } else if (input.scheduledFor) {
    throw new InvalidCoachingError(`a ${kind} is not an event and cannot be scheduled`);
  }

  // RULE 4 — the signal is real or absent. An id that is not an id is dropped rather than stored as garbage that a
  // later join will silently fail to resolve.
  const csatResponseId = UUID.test(String(input.csatResponseId ?? '')) ? String(input.csatResponseId) : null;
  const csatReviewId = UUID.test(String(input.csatReviewId ?? '')) ? String(input.csatReviewId) : null;
  const signalNote = String(input.signalNote ?? '').trim() || null;
  if (signalNote && signalNote.length > 2000) throw new InvalidCoachingError('signalNote is too long');

  // A DISMISSAL MUST SAY WHAT IT IS DISMISSING (rule 2). Dismissing nothing in particular is not a decision, and the
  // 0100 unique index that stops two leads dismissing the same rating has nothing to key on without this.
  if (kind === 'signal_dismissed' && !csatResponseId && !signalNote) {
    throw new InvalidCoachingError('a dismissal must name the signal it dismisses — a rating, or a note describing it');
  }

  return { kind, status, agentUserId: input.agentUserId, tenantId: input.tenantId, rationale, scheduledFor, signalNote, csatResponseId, csatReviewId };
}

export interface SettleInput { status: string; outcome?: string | null }
export interface Settlement { status: SettleStatus; outcome: string | null; heldAt: string | null }

/** Close out a scheduled session. RULE 3 lives here: `held` requires an outcome, and the other two must NOT carry one —
 *  an "outcome" on a session that never happened is a description of an imaginary conversation. */
export function assertSettlement(input: SettleInput, now: Date = new Date()): Settlement {
  if (!isSettleStatus(input.status)) {
    throw new InvalidCoachingError(`status must be one of ${SETTLE_STATUSES.join('|')}`);
  }
  const status = input.status;
  const outcome = String(input.outcome ?? '').trim();
  if (status === 'held') {
    if (outcome.length < MIN_OUTCOME) {
      throw new InvalidCoachingError(`a held session needs an outcome of at least ${MIN_OUTCOME} characters — otherwise the record says a conversation happened that nobody can describe`);
    }
    if (outcome.length > 4000) throw new InvalidCoachingError('outcome is too long');
    return { status, outcome, heldAt: now.toISOString() };
  }
  if (outcome) {
    throw new InvalidCoachingError(`a ${status} session has no outcome — it did not happen`);
  }
  return { status, outcome: null, heldAt: null };
}

/* ------------------------------------------------------------------ reading helpers */

/** Ratings grouped by whether anybody has judged them. Used to show the review BACKLOG rather than the raw count of low
 *  scores, which conflates "bad week" with "nobody looked". */
export function splitByReviewed<T extends { reviewCount: number }>(rows: readonly T[]): { reviewed: T[]; awaiting: T[] } {
  return {
    reviewed: rows.filter((r) => r.reviewCount > 0),
    awaiting: rows.filter((r) => r.reviewCount === 0),
  };
}

/** Verdict counts as SHARES, in basis points, or null when nothing has been reviewed. Null rather than a row of zeroes:
 *  "no low score has been reviewed" and "every review concluded 0%" are different statements about the desk. */
export function verdictShares(
  counts: ReadonlyArray<{ verdict: string; n: number }>,
): Array<{ verdict: string; n: number; shareBps: number }> | null {
  const total = counts.reduce((a, c) => a + Number(c.n || 0), 0);
  if (total <= 0) return null;
  return counts.map((c) => ({ verdict: c.verdict, n: Number(c.n), shareBps: Math.round((Number(c.n) / total) * 10_000) }));
}

/** Has a signal already been acted on, either way? A lead must not be shown a rating as "needs review" when a colleague
 *  reviewed it or deliberately dismissed it ten minutes ago. */
export function signalIsSettled(row: { reviewCount: number; latestVerdict?: string | null }): boolean {
  return row.reviewCount > 0 || !!row.latestVerdict;
}
