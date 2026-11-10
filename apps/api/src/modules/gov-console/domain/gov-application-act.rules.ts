// modules/gov-console/domain/gov-application-act.rules.ts · PC-56 GOV-2a · THE AUTHORITY DECIDES (GOV-2 Q2-A, Q1-A; lead-applied 2026-11-10 —
// the founder may reopen). PURE: the act machine and its refusals, read BEFORE any idempotency key is reserved or any write is opened. 0240's
// `gov_application_act` DEFINER says every one of these again in the database, and four CHECKs on `scheme_applications` hold the second
// person for every caller.
//
//   verify   submitted | appealed → under_verification (the actor becomes the checker); under_verification with no checker → stays
//            (the actor becomes the checker — "complete checking")                                  authority.applications.verify
//   clarify  under_verification → clarification_needed, with a note of 10–500 characters            authority.applications.verify
//   approve  under_verification → approved — NO AMOUNT (Q1-A)                                        authority.applications.decide
//   reject   under_verification → rejected — a listed reason code AND a sentence of 10–500 characters authority.applications.decide
//
// A decision follows a check BY ANOTHER PERSON: never the checker, never the applicant, never the assister. So a lone head can decide only
// applications an officer checked (GOV-0 founder Q1 stays open — reported, not worked around).
import { canTransition, ApplicationStatus } from '../../schemes/domain/scheme-application.state';
import { isRejectionCode } from '../../schemes/domain/rejection-codes';

export const GOV_ACTS = ['verify', 'clarify', 'approve', 'reject'] as const;
export type GovAct = (typeof GOV_ACTS)[number];
export const GOV_VERIFY_PERMISSION = 'authority.applications.verify';
export const GOV_DECIDE_PERMISSION = 'authority.applications.decide';

export function isGovAct(v: unknown): v is GovAct { return typeof v === 'string' && (GOV_ACTS as readonly string[]).includes(v); }
export function permissionFor(act: GovAct): string { return act === 'approve' || act === 'reject' ? GOV_DECIDE_PERMISSION : GOV_VERIFY_PERMISSION; }

const sentence = (v: string | undefined | null) => { const t = (v ?? '').trim(); return t.length >= 10 && t.length <= 500; };

/** The input, before anything is read: a refusal code or null. */
export function actInputRefusal(act: GovAct, reasonCode: string | undefined | null, note: string | undefined | null): string | null {
  const n = (note ?? '').trim();
  if (act === 'reject') {
    if (!reasonCode || !isRejectionCode(reasonCode)) return 'GOV_REASON_CODE_REQUIRED';
    if (!sentence(note)) return 'GOV_REASON_REQUIRED';
    return null;
  }
  if (reasonCode !== undefined && reasonCode !== null) return 'GOV_REASON_CODE_ONLY_ON_REJECT';
  if (act === 'clarify' && !sentence(note)) return 'GOV_NOTE_REQUIRED';
  if (n.length > 500) return 'GOV_NOTE_REQUIRED';
  return null;
}

/** The session's permission for this act (the guard admitted `verify`; a decision needs `decide` — held by the head only). */
export function actPermissionRefusal(act: GovAct, permissions: ReadonlySet<string>): string | null {
  return permissions.has(permissionFor(act)) ? null : 'GOV_PERMISSION_MISSING';
}

export interface ActFacts { status: string; verified: boolean; actorIsVerifier: boolean; actorIsApplicant: boolean; actorIsAssister: boolean }

/** The status this act moves the application to, or null when the act is not legal from here. Uses the ONE state machine (Law 5). */
export function nextStatus(act: GovAct, facts: Pick<ActFacts, 'status' | 'verified'>): ApplicationStatus | null {
  const from = facts.status as ApplicationStatus;
  if (act === 'verify') {
    if ((from === 'submitted' || from === 'appealed') && canTransition(from, 'under_verification')) return 'under_verification';
    if (from === 'under_verification' && !facts.verified) return 'under_verification';
    return null;
  }
  if (from !== 'under_verification') return null;
  const to: ApplicationStatus = act === 'clarify' ? 'clarification_needed' : act === 'approve' ? 'approved' : 'rejected';
  return canTransition(from, to) ? to : null;
}

/** The facts, read before any key is reserved: not found → 404; an illegal step; a decision without a check; the second person. */
export function actFactsRefusal(act: GovAct, facts: ActFacts | null): string | null {
  if (!facts) return 'GOV_APPLICATION_NOT_FOUND';
  if (nextStatus(act, facts) === null) return 'GOV_ACT_NOT_NOW';
  if (act === 'approve' || act === 'reject') {
    if (!facts.verified) return 'GOV_NOT_VERIFIED';
    if (facts.actorIsVerifier) return 'GOV_DECIDER_IS_VERIFIER';
    if (facts.actorIsApplicant) return 'GOV_DECIDER_IS_APPLICANT';
    if (facts.actorIsAssister) return 'GOV_DECIDER_IS_ASSISTER';
  }
  return null;
}
