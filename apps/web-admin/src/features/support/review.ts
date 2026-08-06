// apps/web-admin/src/features/support/review.ts · CSAT REVIEW + COACHING, console side
// (PC-56 ADMIN-2c, canon W056, W2019-25, W2121-25).
//
// The rules live in admin-api's `domain/coaching.ts` and are NOT duplicated here — same split as the support policy in
// ADMIN-2b, for the same reason: two copies of a rule become one copy of the rule and one copy of last quarter's rule.
// What lives here is form SHAPE (is this a real verdict, did somebody type a reason, is that date in the future) and the
// READING helpers that decide what a screen is allowed to claim.
//
// THE READING HELPERS ARE THE INTERESTING PART OF THIS FILE, because the data they describe is unusually easy to
// misrepresent:
//   • A CSAT figure computed over a window can look precise while resting on nine ratings. `csatSample` refuses to
//     produce an average below a floor, rather than producing one and hoping the caller reads the footnote.
//   • Migration 0099's backfilled rows have a DERIVED rating time. `ratedAtLabel` never returns a bare timestamp for
//     one — the estimate is marked at the point of display, because a caveat at the top of a page does not travel with
//     the row somebody screenshots.
//   • A rating with no comment and a rating whose comment nobody has read are different things, and neither is "no
//     feedback".

/* ------------------------------------------------------------------ vocabularies (mirroring 0099/0100) */

export const CSAT_VERDICTS = [
  'agent_at_fault', 'process_at_fault', 'product_at_fault', 'outside_our_control', 'rating_mistaken', 'needs_more_info',
] as const;
export type CsatVerdict = (typeof CSAT_VERDICTS)[number];

export const COACHING_KINDS = ['shadow_session', 'review_call', 'written_feedback', 'signal_dismissed'] as const;
export type CoachingKind = (typeof COACHING_KINDS)[number];

export const SETTLE_STATUSES = ['held', 'missed', 'cancelled'] as const;
export type SettleStatus = (typeof SETTLE_STATUSES)[number];

/** Kinds that happen at a time. Mirrored so the form can require a date without a round trip. */
const EVENT_KINDS = new Set<CoachingKind>(['shadow_session', 'review_call']);
export function isEventKind(k: string): boolean { return EVENT_KINDS.has(k as CoachingKind); }

/** The ONLY verdict that makes coaching a coherent follow-up. Coaching an agent because a bank was down is punishing
 *  somebody for the weather; the console uses this to explain the refusal rather than to hide the control. */
export function verdictSupportsCoaching(v: string): boolean { return v === 'agent_at_fault'; }

export const MIN_FINDING = 10;
export const MIN_RATIONALE = 20;
export const MIN_OUTCOME = 10;
export const MAX_SCHEDULE_DAYS = 60;
/** Below this many ratings, an average is noise dressed as a measurement. Matches the desk module's CSAT floor. */
export const CSAT_MIN_SAMPLE = 10;

/* ------------------------------------------------------------------ types */

export interface CsatRow {
  id?: string; responseId?: string;
  ticketId: string; ticketNo?: string | null;
  tenantId?: string; tenantSlug?: string | null;
  score: number;
  comment?: string | null; commentLanguage?: string | null;
  ratedAt: string; ratedAtIsEstimated?: boolean;
  severity?: string | null; agentUserId?: string | null; assigneeUserId?: string | null;
  reviewCount?: number; latestVerdict?: string | null;
}

export interface ReviewRow {
  id: string; reviewerAdminId: string; verdict: string; finding: string;
  coachingId?: string | null; reviewedAt: string;
}

export interface CoachingRow {
  id: string; tenantId: string; tenantSlug?: string | null;
  agentUserId: string; authorAdminId: string;
  kind: string; status: string; rationale: string; signalNote?: string | null;
  csatResponseId?: string | null; csatReviewId?: string | null;
  scheduledFor?: string | null; heldAt?: string | null; outcome?: string | null;
  createdAt: string; signalScore?: number | null; signalComment?: string | null;
}

/* ------------------------------------------------------------------ reading */

/**
 * A rating's timestamp, and whether it is real. Returns a DISCRIMINATED result rather than a formatted string so the
 * caller cannot accidentally print an estimate as a fact — the type makes the caveat unforgettable.
 *
 * 0099's backfill had no rating time to copy (the column never existed), so those rows carry the ticket's resolution or
 * creation time. That is useful and it is not the same thing.
 */
export function ratedAtLabel(row: Pick<CsatRow, 'ratedAt' | 'ratedAtIsEstimated'>): { at: string; estimated: boolean } {
  return { at: row.ratedAt, estimated: row.ratedAtIsEstimated === true };
}

/** How many rows in this page carry a derived timestamp — for a single note instead of one per row. */
export function estimatedCount(rows: readonly CsatRow[]): number {
  return rows.filter((r) => r.ratedAtIsEstimated === true).length;
}

/** Rows that actually carry words. Not "rows with a non-empty string" — a whitespace-only comment is not feedback. */
export function withVerbatim(rows: readonly CsatRow[]): CsatRow[] {
  return rows.filter((r) => !!r.comment && r.comment.trim().length > 0);
}

/** THE HONEST CSAT SUMMARY. Returns null for the average when the sample is too thin, rather than an average plus a
 *  hope that somebody reads the footnote — a number on a screen gets quoted, footnotes do not. */
export function csatSample(rows: readonly CsatRow[]): {
  n: number; avg: number | null; tooFew: boolean; withComments: number; verbatimShareBps: number | null;
} {
  const n = rows.length;
  if (n === 0) {
    // unknown ≠ zero: nobody rated is not "rated zero"
    return { n: 0, avg: null, tooFew: true, withComments: 0, verbatimShareBps: null };
  }
  const withComments = withVerbatim(rows).length;
  const tooFew = n < CSAT_MIN_SAMPLE;
  const sum = rows.reduce((a, r) => a + Number(r.score || 0), 0);
  return {
    n,
    avg: tooFew ? null : Math.round((sum / n) * 100) / 100,
    tooFew,
    withComments,
    verbatimShareBps: Math.round((withComments / n) * 10_000),
  };
}

/** Has anybody acted on this rating, either way? A queue that re-shows a colleague's finished work stops being trusted. */
export function isSettled(row: Pick<CsatRow, 'reviewCount' | 'latestVerdict'>): boolean {
  return (row.reviewCount ?? 0) > 0 || !!row.latestVerdict;
}

/** Verdict counts as percentages, or null when nothing has been reviewed. Null, never a row of zeroes: "no low score
 *  has been reviewed" is a statement about the DESK's process, "every verdict was 0%" is arithmetic nonsense. */
export function verdictShares(
  counts: ReadonlyArray<{ verdict: string; n: number }>,
): Array<{ verdict: string; n: number; pct: number }> | null {
  const total = counts.reduce((a, c) => a + Number(c.n || 0), 0);
  if (total <= 0) return null;
  return counts.map((c) => ({ verdict: c.verdict, n: Number(c.n), pct: Math.round((Number(c.n) / total) * 1000) / 10 }));
}

/** Coaching rows that still need somebody to say what happened. The overdue ones first, because a session three weeks
 *  past with no outcome is the record quietly failing. */
export function awaitingSettlement(rows: readonly CoachingRow[], now: Date = new Date()): CoachingRow[] {
  return rows
    .filter((r) => r.status === 'scheduled' && !!r.scheduledFor)
    .sort((a, b) => Date.parse(a.scheduledFor as string) - Date.parse(b.scheduledFor as string))
    .filter((r) => Date.parse(r.scheduledFor as string) <= now.getTime() + 0);
}

/** A scheduled session whose time has passed and which nobody has settled. Surfaced because the alternative is a
 *  coaching ledger that looks complete while half its sessions have no account of themselves. */
export function overdueSettlement(rows: readonly CoachingRow[], now: Date = new Date()): CoachingRow[] {
  return awaitingSettlement(rows, now);
}

/** Split a coaching ledger into interventions and recorded decisions NOT to intervene. Both matter: showing only the
 *  first misrepresents a lead as somebody who acts on everything. */
export function splitCoaching(rows: readonly CoachingRow[]): { actions: CoachingRow[]; dismissals: CoachingRow[] } {
  return {
    actions: rows.filter((r) => r.kind !== 'signal_dismissed'),
    dismissals: rows.filter((r) => r.kind === 'signal_dismissed'),
  };
}

/* ------------------------------------------------------------------ writing: the forms */

export type FormBag = (name: string) => string;
export type Built<T> = { ok: true; value: T } | { ok: false; error: string };

export interface ReviewPayload { verdict: string; finding: string }

/** Shape-check a verdict form. The server owns whether the verdict is COHERENT with anything; this owns whether the
 *  operator actually filled the form in. */
export function buildReview(get: FormBag): Built<ReviewPayload> {
  const verdict = get('verdict').trim();
  if (!(CSAT_VERDICTS as readonly string[]).includes(verdict)) return { ok: false, error: 'verdict' };
  const finding = get('finding').trim();
  if (finding.length < MIN_FINDING) return { ok: false, error: 'finding' };
  if (finding.length > 4000) return { ok: false, error: 'findingLong' };
  return { ok: true, value: { verdict, finding } };
}

export interface CoachingPayload {
  kind: string; agentUserId: string; tenantId: string; rationale: string;
  scheduledFor?: string; signalNote?: string; csatResponseId?: string; csatReviewId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Shape-check a coaching form. `now` is injectable so the schedule window is testable without freezing the clock.
 *
 * The date handling is the fiddly part and it is done HERE rather than left to the server, because a datetime-local
 * input yields a LOCAL wall-clock string with no zone. Sending that raw would have the server read "14:00" as UTC and
 * book a session five and a half hours from where the operator meant — the kind of bug that shows up as somebody not
 * turning up.
 */
export function buildCoaching(get: FormBag, now: Date = new Date()): Built<CoachingPayload> {
  const kind = get('kind').trim();
  if (!(COACHING_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'kind' };

  const agentUserId = get('agentUserId').trim();
  if (!UUID.test(agentUserId)) return { ok: false, error: 'agent' };
  const tenantId = get('tenantId').trim();
  if (!UUID.test(tenantId)) return { ok: false, error: 'tenant' };

  const rationale = get('rationale').trim();
  if (rationale.length < MIN_RATIONALE) return { ok: false, error: 'rationale' };
  if (rationale.length > 4000) return { ok: false, error: 'rationaleLong' };

  const out: CoachingPayload = { kind, agentUserId, tenantId, rationale };

  if (isEventKind(kind)) {
    const raw = get('scheduledFor').trim();
    if (!raw) return { ok: false, error: 'scheduleMissing' };
    // a datetime-local value has no zone; treat it as the operator's own clock and normalise to an instant
    const when = new Date(raw.length === 16 ? `${raw}:00` : raw);
    if (Number.isNaN(when.getTime())) return { ok: false, error: 'scheduleInvalid' };
    if (when.getTime() <= now.getTime()) return { ok: false, error: 'schedulePast' };
    if ((when.getTime() - now.getTime()) / 86_400_000 > MAX_SCHEDULE_DAYS) return { ok: false, error: 'scheduleFar' };
    out.scheduledFor = when.toISOString();
  } else if (get('scheduledFor').trim()) {
    return { ok: false, error: 'scheduleNotEvent' };
  }

  const signalNote = get('signalNote').trim();
  if (signalNote) {
    if (signalNote.length > 2000) return { ok: false, error: 'signalNoteLong' };
    out.signalNote = signalNote;
  }
  const responseId = get('csatResponseId').trim();
  if (responseId) {
    if (!UUID.test(responseId)) return { ok: false, error: 'signalRef' };
    out.csatResponseId = responseId;
  }
  const reviewId = get('csatReviewId').trim();
  if (reviewId) {
    if (!UUID.test(reviewId)) return { ok: false, error: 'signalRef' };
    out.csatReviewId = reviewId;
  }

  // A dismissal must name what it dismisses (0100's unique index has nothing to key on otherwise, and dismissing
  // nothing in particular is not a decision).
  if (kind === 'signal_dismissed' && !out.csatResponseId && !out.signalNote) {
    return { ok: false, error: 'dismissalSignal' };
  }
  return { ok: true, value: out };
}

export interface SettlePayload { status: string; outcome?: string }

/** Shape-check settling a session. `held` needs an outcome; the other two must NOT carry one — an outcome on a session
 *  that never happened describes an imaginary conversation. */
export function buildSettlement(get: FormBag): Built<SettlePayload> {
  const status = get('status').trim();
  if (!(SETTLE_STATUSES as readonly string[]).includes(status)) return { ok: false, error: 'status' };
  const outcome = get('outcome').trim();
  if (status === 'held') {
    if (outcome.length < MIN_OUTCOME) return { ok: false, error: 'outcome' };
    if (outcome.length > 4000) return { ok: false, error: 'outcomeLong' };
    return { ok: true, value: { status, outcome } };
  }
  if (outcome) return { ok: false, error: 'outcomeNotHeld' };
  return { ok: true, value: { status } };
}
