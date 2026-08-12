// modules/ai-governance/domain/appeal-submit.ts · the farmer's side of W097 (PC-56 ADMIN-SWEEP-b1). Pure — no I/O.
//
// EVERY REMOVAL NOTICE SINCE 0112 HAS PROMISED THIS ("You can appeal this decision", appeal path '/help/appeal'),
// AND UNTIL THIS WAVE NO CODE COULD KEEP THE PROMISE: `appeals` (0067) had no submit path anywhere, so the platform's
// own overturn rate was computed over a table nothing could fill. The rules here are deliberately few — an appeal is
// a RIGHT, exercised by any authenticated user about a decision that hit THEM (the moderation-reports precedent:
// filing needs authentication and ownership, not a grant). What is strict is WHAT may be appealed and by WHOM.
import { DomainError } from '../../../shared/errors/app-error';

/** W097: "SLA 48h" — the clock starts when the farmer asks, not when a reviewer picks it up. */
export const APPEAL_SLA_HOURS = 48;

/** The three moderation outcomes the canon files appeals against; 0132's `chk_appeals_subject_action` is the
 *  database copy of this list, and the admin realm's overturn contract dispatches on it. */
export const APPEALABLE_ACTIONS = ['listing_removed', 'review_hidden', 'account_restricted'] as const;
export type AppealableAction = (typeof APPEALABLE_ACTIONS)[number];

export const ACTION_SUBJECT_KIND: Readonly<Record<AppealableAction, 'listing' | 'review' | 'account'>> = Object.freeze({
  listing_removed: 'listing',
  review_hidden: 'review',
  account_restricted: 'account',
});

export class InvalidAppealError extends DomainError {
  constructor(message: string) { super('APPEAL_INVALID', message, 422); }
}
export class AppealNotYoursError extends DomainError {
  /** 404, not 403 — the same enumeration defence reviews use: "you may not appeal this" confirms it exists. */
  constructor() { super('APPEAL_SUBJECT_NOT_FOUND', 'No such subject of yours to appeal.', 404); }
}

export function assertAppealableAction(action: unknown): AppealableAction {
  if (typeof action !== 'string' || !(APPEALABLE_ACTIONS as readonly string[]).includes(action)) {
    throw new InvalidAppealError(`subjectAction must be one of ${APPEALABLE_ACTIONS.join(', ')}`);
  }
  return action as AppealableAction;
}

/** `subject_ref` as the admin realm parses it: `<kind>:<uuid>`. Built server-side from the validated pieces —
 *  never accepted preassembled from the client, so the ref and the action cannot disagree (the admin overturn
 *  REFUSES on disagreement, and a refusal we can make impossible here should never reach a reviewer there). */
export function buildSubjectRef(action: AppealableAction, subjectId: string): string {
  return `${ACTION_SUBJECT_KIND[action]}:${subjectId}`;
}

/** For account_restricted the subject IS the caller; a uuid is required for the other two. */
export function subjectIdFor(action: AppealableAction, dtoSubjectId: string | undefined, callerUserId: string): string {
  if (action === 'account_restricted') return callerUserId;
  if (!dtoSubjectId) throw new InvalidAppealError(`${action} appeals must name the ${ACTION_SUBJECT_KIND[action]} being appealed`);
  return dtoSubjectId;
}
