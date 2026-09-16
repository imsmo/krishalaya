// modules/education/domain/course-acts.ts · PC-56 TENANT-7a · the six acts on a course record, as verdicts — the
// mutate chain's confirm step (W2550) reviews *"the object and reason"*, and the reasons an act would be refused are
// computed HERE, by the same function the act itself consults, in the order a person would want to hear them:
// permission → ownership → stage → gate → maker-checker. So no button on W179/W416 ever 403s: a button is offered when
// the verdict is `allowed`, and when it is not the screen prints why.
//
// THE SIX ACTS and the canon sentence each answers to:
//   submit   draft → review        W416 *"Submit for review — enables once all checks pass"* (the GATE)
//   publish  review → published    W416 *"publish is the desk's act, not yours (maker-checker)"*
//   return   review → draft        W416 *"Returned with notes … Fix and resubmit"* (the NOTE is the reason)
//   pause    published → paused    W178's `published` chip hosts the mutate chain
//   resume   paused → published    the same chip, the other way
//   archive  any → archived        W179 *"Archive course — Reason *"*
//
// THE REASON IS MANDATORY ON EVERY ACT (6d-5's rule): the confirm screen promises an audit entry *"with actor, time
// and reason"*, and a blank reason makes that a lie. It is never pre-filled.
import { CourseStatus } from './education.events';
import { canTransition } from './course.state';

export const COURSE_ACTS = ['submit', 'publish', 'return', 'pause', 'resume', 'archive'] as const;
export type CourseAct = (typeof COURSE_ACTS)[number];

export const ACT_TARGET: Readonly<Record<CourseAct, CourseStatus>> = Object.freeze({
  submit: 'review', publish: 'published', return: 'draft', pause: 'paused', resume: 'published', archive: 'archived',
});

/** Which key an act needs. `archive` is the author's (it is their course) — but the desk may archive too. */
export const DESK_ACTS: ReadonlySet<CourseAct> = new Set<CourseAct>(['publish', 'return', 'pause', 'resume']);

export const ACT_REFUSALS = [
  'NO_PERMISSION', 'NOT_OWNER', 'ILLEGAL_FROM_STATUS', 'GATE_NOT_PASSED', 'MAKER_IS_CHECKER', 'REASON_REQUIRED',
] as const;
export type ActRefusal = (typeof ACT_REFUSALS)[number];

export const MIN_ACT_REASON = 3;
export const MAX_ACT_REASON = 300;

export interface ActVerdictInput {
  act: CourseAct;
  status: CourseStatus;
  canAuthor: boolean;
  canPublish: boolean;
  /** The caller is the user behind the course's instructor row. */
  isOwner: boolean;
  /** The caller is recorded as the maker (`submitted_by`) of the submission under review. */
  isSubmitter: boolean;
  /** The publish gate's verdict, when the act is `submit`; null when not computed. */
  gateReady: boolean | null;
  reason: string | null | undefined;
}

export interface ActVerdict { act: CourseAct; allowed: boolean; refusals: ActRefusal[]; to: CourseStatus }

export function isCourseAct(s: string): s is CourseAct { return (COURSE_ACTS as readonly string[]).includes(s); }

export function reasonUsable(reason: string | null | undefined): boolean {
  const s = (reason ?? '').trim();
  return s.length >= MIN_ACT_REASON && s.length <= MAX_ACT_REASON;
}

export function actVerdict(i: ActVerdictInput): ActVerdict {
  const refusals: ActRefusal[] = [];
  const desk = DESK_ACTS.has(i.act);
  // PERMISSION. A desk act needs the desk's key; submit and archive need the author's key — or the desk's, because the
  // desk may retire a course whose instructor has left the cooperative.
  if (desk ? !i.canPublish : !(i.canAuthor || i.canPublish)) refusals.push('NO_PERMISSION');
  // OWNERSHIP. An author acts on their own course; the desk on any of the tenant's.
  if (!i.isOwner && !i.canPublish) refusals.push('NOT_OWNER');
  // STAGE. The state machine is the one place transitions live (Law 5); this only asks it.
  if (!canTransition(i.status, ACT_TARGET[i.act])) refusals.push('ILLEGAL_FROM_STATUS');
  // THE GATE. W416: submission is blocked until every measurable check passes — the two lessons named, not an average.
  if (i.act === 'submit' && i.gateReady !== true) refusals.push('GATE_NOT_PASSED');
  // MAKER ≠ CHECKER. The instructor never publishes their own course; neither does whoever pressed submit.
  if (i.act === 'publish' && (i.isOwner || i.isSubmitter)) refusals.push('MAKER_IS_CHECKER');
  if (!reasonUsable(i.reason)) refusals.push('REASON_REQUIRED');
  return { act: i.act, allowed: refusals.length === 0, refusals, to: ACT_TARGET[i.act] };
}

/**
 * Every act's verdict at once, for the screen that offers buttons. The reason is not known yet on a screen, so it is
 * judged as usable here — `REASON_REQUIRED` is the confirm step's refusal, not the button's.
 */
export function allVerdicts(base: Omit<ActVerdictInput, 'act' | 'reason'>): ActVerdict[] {
  return COURSE_ACTS.map((act) => actVerdict({ ...base, act, reason: 'placeholder' }));
}
