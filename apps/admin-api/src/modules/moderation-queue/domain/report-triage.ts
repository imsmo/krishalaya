// apps/admin-api/src/modules/moderation-queue/domain/report-triage.ts · W092, PURE (PC-56 ADMIN-5f).
//
// The cross-tenant report queue. Two things here are not obvious and both are the point of the screen:
//
// 1. **A PLATFORM OPERATOR COULD NOT BE RECORDED AS HANDLING A REPORT.** `moderation_reports.handled_by` is an FK to
//    `users` — the farmer/tenant-user table — and admin-api has no database identity. 0112 adds
//    `handled_by_admin_id` alongside it, and a decided report now names EXACTLY ONE of the two. Both kinds of handler
//    are real: the tenant's own desk handles reports through apps/api under `content.moderate`, and the platform
//    handles them cross-tenant from here. Recording either as the other would be a forgery (ADMIN-2d enumerated the
//    three wrong fixes and they are the same three).
//
// 2. **HARASSMENT JUMPS THE QUEUE.** W092: "Harassment reports jump the queue and route to the safety desk when
//    vulnerable-reporter signals are present … or the message thread shows escalation." Implemented as an ordering
//    rule rather than a separate queue, because a second queue is a second thing to remember to look at.
import { InvalidReportDecisionError } from './moderation-queue.errors';

export const REPORT_STATUSES = ['open', 'actioned', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** The four the column comment names. NOT enforced by a CHECK, and 0112 records why: the app's own DTO already
 *  accepts seven, so a constraint written from the comment would reject rows the platform currently produces. This
 *  list is what the CONSOLE offers to filter by, which is a narrower claim than what may exist. */
export const SUBJECT_TYPES = ['listing', 'review', 'message', 'user'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/** W092's SLA. Same four hours as the listing hold, and for a related reason: a report about harassment left for a
 *  day is a person left unprotected for a day. */
export const REPORT_SLA_HOURS = 4;

/** Reasons that route to the safety desk. Seeded in `report_reason` (0005 seeds) — matched by CODE rather than by
 *  keyword, because a keyword match on a translated label stops working in the second language. */
export const SAFETY_DESK_REASONS = Object.freeze(['harassment', 'inappropriate'] as const);

export const OUTCOME_MIN = 20;

export interface ReportRow {
  id: string;
  tenantId: string;
  subjectType: string;
  subjectId: string;
  reasonCode: string | null;
  status: ReportStatus;
  actionTaken: string | null;
  handledBy: string | null;
  handledByAdminId: string | null;
  handledAt: string | null;
  createdAt: string;
  reportsOnSubject: number | null;
}

/* ------------------------------------------------------------------------------------------------ */
/* TRIAGE                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

export function isSafetyDeskReason(code: string | null | undefined): boolean {
  return typeof code === 'string' && (SAFETY_DESK_REASONS as readonly string[]).includes(code);
}

export type Priority = 'safety_desk' | 'sla_breached' | 'normal';

/** W092's ordering. Safety-desk reports first regardless of age, then anything past its SLA, then oldest-first.
 *
 *  SAFETY BEFORE SLA, and that ordering is a judgement worth stating: a breached SLA on a fake-review report is a
 *  process failure, and a fresh harassment report is a person being harassed right now. Putting the breach first
 *  would optimise the metric the desk is measured on at the expense of the thing the desk exists for.
 */
export function priorityOf(r: Pick<ReportRow, 'reasonCode' | 'createdAt'>, now: Date): Priority {
  if (isSafetyDeskReason(r.reasonCode)) return 'safety_desk';
  const t = Date.parse(r.createdAt);
  // `Number.isFinite(t)` is REDUNDANT and a mutation test proved it: any comparison against NaN is false, so an
  // unparseable date already falls through to 'normal' without the guard. Kept, and the redundancy noted rather than
  // tidied — without it the correct behaviour holds only by accident of IEEE-754 semantics, and the next reader
  // deciding whether an unparseable date is a breach would have to know that to be sure. (This is the second
  // equivalent mutant this method has surfaced in two waves, both the same kind: a defensive check that duplicates a
  // language-level behaviour. Worth keeping both times, for the same reason.)
  if (Number.isFinite(t) && (now.getTime() - t) / 3_600_000 > REPORT_SLA_HOURS) return 'sla_breached';
  return 'normal';
}

/** Order a page for the console. Stable within a priority so the list does not shuffle while somebody reads it. */
export function triageOrder(rows: readonly ReportRow[], now: Date): ReportRow[] {
  const rank: Record<Priority, number> = { safety_desk: 0, sla_breached: 1, normal: 2 };
  return [...rows].sort((a, b) => {
    const d = rank[priorityOf(a, now)] - rank[priorityOf(b, now)];
    if (d !== 0) return d;
    // Oldest first inside a band — the opposite of every other list in this console, because here age is harm.
    const ta = Date.parse(a.createdAt); const tb = Date.parse(b.createdAt);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

/** The age of a report against its SLA. `unmeasured` is a warning, never a pass. */
export type ReportSla = { kind: 'unmeasured' } | { kind: 'ok'; ageHours: number } | { kind: 'breached'; overHours: number };

export function reportSla(createdAt: string | null | undefined, now: Date): ReportSla {
  if (!createdAt) return { kind: 'unmeasured' };
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return { kind: 'unmeasured' };
  const ageHours = (now.getTime() - t) / 3_600_000;
  // A report timestamped in the future is unmeasured rather than comfortably fresh, which is what taking it at face
  // value would report.
  if (ageHours < 0) return { kind: 'unmeasured' };
  if (ageHours > REPORT_SLA_HOURS) return { kind: 'breached', overHours: Math.round((ageHours - REPORT_SLA_HOURS) * 10) / 10 };
  return { kind: 'ok', ageHours: Math.round(ageHours * 10) / 10 };
}

/* ------------------------------------------------------------------------------------------------ */
/* THE DECISION                                                                                      */
/* ------------------------------------------------------------------------------------------------ */

/** The outcomes the platform may record. `suspended` is deliberately ABSENT from this list even though
 *  `moderation_reports.action_taken` documents it: suspending an account is a band change on the risk plane
 *  (ADMIN-5d), it has its own permission and its own second-person rule, and offering it here would be a second door
 *  into the same act with weaker controls. */
export const PLATFORM_OUTCOMES = ['hidden', 'removed', 'warned', 'none'] as const;
export type PlatformOutcome = (typeof PLATFORM_OUTCOMES)[number];

export type Decision =
  | { status: 'actioned'; outcome: Exclude<PlatformOutcome, 'none'>; outcomeNote: string }
  | { status: 'dismissed'; outcome: 'none'; outcomeNote: string };

/** Build and validate a platform decision on a report.
 *
 *  TWO REFUSALS THAT MATTER:
 *  • An `actioned` report must name a real action. `none` is what a DISMISSAL is, and letting `actioned` carry it
 *    would produce a report the queue calls handled with nothing recorded as having been done — the same defect this
 *    wave exists to fix, reintroduced one level up. (apps/api's entity already enforces this for the tenant path;
 *    the rule is restated here because this is a different caller, not because the other one is untrusted.)
 *  • A DISMISSAL needs its explanation too. W092: "Reporters hear back on every report — even dismissals get a
 *    respectful explanation." A dismissal with no words is the outcome most likely to be read as contempt.
 */
export function buildDecision(raw: { status?: unknown; outcome?: unknown; outcomeNote?: unknown }): Decision {
  const status = raw.status;
  if (status !== 'actioned' && status !== 'dismissed') {
    throw new InvalidReportDecisionError("a decision is either 'actioned' or 'dismissed'");
  }
  const note = typeof raw.outcomeNote === 'string' ? raw.outcomeNote.trim() : '';
  if (note.length < OUTCOME_MIN) {
    throw new InvalidReportDecisionError(
      `an outcome explanation of at least ${OUTCOME_MIN} characters is required — the reporter is told what happened, `
      + 'and a dismissal with no words is the outcome most likely to be read as contempt');
  }
  if (note.length > 2000) throw new InvalidReportDecisionError('an outcome explanation must be at most 2000 characters');

  if (status === 'dismissed') return { status: 'dismissed', outcome: 'none', outcomeNote: note };

  const outcome = raw.outcome;
  if (typeof outcome !== 'string' || !(PLATFORM_OUTCOMES as readonly string[]).includes(outcome) || outcome === 'none') {
    throw new InvalidReportDecisionError(
      `an actioned report must name what was done: ${PLATFORM_OUTCOMES.filter((o) => o !== 'none').join(', ')}. `
      + "Recording 'none' against an actioned report is what a dismissal is");
  }
  return { status: 'actioned', outcome: outcome as Exclude<PlatformOutcome, 'none'>, outcomeNote: note };
}

/** Whether this report can still be decided. Both `actioned` and `dismissed` are terminal (apps/api's state machine
 *  says so and the platform path must agree — two callers with different ideas of terminal would let a decided report
 *  be re-decided from one side only). */
export function assertDecidable(r: Pick<ReportRow, 'status' | 'handledBy' | 'handledByAdminId'>): void {
  if (r.status !== 'open') {
    const who = r.handledByAdminId ? 'a platform operator' : r.handledBy ? "the tenant's own desk" : 'somebody';
    throw new InvalidReportDecisionError(`this report was already ${r.status} by ${who}; both outcomes are terminal`);
  }
}

/** Which handler a decided report names. Exactly one, enforced by `ck_modreport_one_handler` (0112).
 *
 *  `neither` is reachable only on rows predating that constraint, and it is reported rather than guessed at: a
 *  decided report with no handler is a real gap in the record, and showing it as "handled by the platform" because
 *  this console happens to be the platform would be inventing the fact.
 */
export function handlerOf(r: Pick<ReportRow, 'status' | 'handledBy' | 'handledByAdminId'>): 'tenant' | 'platform' | 'neither' | 'open' {
  if (r.status === 'open') return 'open';
  if (r.handledByAdminId) return 'platform';
  if (r.handledBy) return 'tenant';
  return 'neither';
}

/** W092's "Reports on subject" column — how many other people flagged the same thing.
 *
 *  NULL is unknown, not one. The count comes from a separate aggregate read and a failed one must not render as "this
 *  is the only report", which is the reading that makes an operator dismiss something eighteen people flagged.
 */
export function reportsOnSubject(n: number | null | undefined): { known: boolean; count: number } {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? { known: true, count: n } : { known: false, count: 0 };
}
