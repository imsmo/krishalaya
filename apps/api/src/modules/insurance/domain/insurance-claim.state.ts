// modules/insurance/domain/insurance-claim.state.ts · THE state machine for insurance_claims.status
// (Law 5 -- the ONLY place transitions are defined). Statuses copied VERBATIM from the DDL's
// `claim_status` enum (db/migrations/0011_fintech_schemes.sql) -- never invented:
//   CREATE TYPE claim_status AS ENUM ('intimated','docs_pending','survey_scheduled','surveyed','approved',
//     'partially_approved','rejected','paid','closed');
//
// Transition rules derived from canon screens 289-293 (read in full, DEV-23 grounding), kept deliberately
// conservative, same discipline as insurance-policy.state.ts:
//   - 289 (claim intimation): filing a claim always starts 'intimated'.
//   - 291 (status tracker): "claim received -> documents check -> survey scheduled -> assessment ->
//     decision -> payout" -> intimated->docs_pending (insurer needs more documents) OR
//     intimated->survey_scheduled directly (evidence already sufficient, docs_pending is skippable, not
//     mandatory); docs_pending->survey_scheduled once documents clear.
//   - Early rejection (fraud / policy not on cover / duplicate) is legitimate from either pre-survey state:
//     intimated->rejected, docs_pending->rejected.
//   - 292 (assessment visit): survey_scheduled->surveyed once the surveyor records a report. Farmer
//     DISAGREEMENT ("opens a review with a second surveyor -- it never cancels your claim") is the ONE
//     claimant-triggered transition this wave: surveyed->survey_scheduled (re-survey loop).
//   - 293 (settlement detail): surveyed->approved | partially_approved | rejected (the insurer's decision);
//     approved/partially_approved->paid (settlement, money-out); paid->closed (administrative close-out).
//     rejected->closed (housekeeping close after the claimant has been notified). A 30-day appeal window is
//     DISCLOSED on 293 but is NOT a distinct claim_status value in the DDL (unlike application_status, which
//     does carry 'appealed') -- appeal/reopen handling is a documented, un-invented gap (see spec_dev23.md),
//     not a status this machine fabricates.
import { DomainError } from '../../../shared/errors/app-error';

export const CLAIM_STATUSES = [
  'intimated', 'docs_pending', 'survey_scheduled', 'surveyed',
  'approved', 'partially_approved', 'rejected', 'paid', 'closed',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = Object.freeze({
  intimated:          ['docs_pending', 'survey_scheduled', 'rejected'],
  docs_pending:       ['survey_scheduled', 'rejected'],
  // The self-loop is deliberate: after a farmer-disagreement re-survey request (surveyed->survey_scheduled,
  // below), the insurer must be able to (re)assign a SECOND surveyor while status stays 'survey_scheduled' --
  // there is no distinct DDL status for "awaiting re-assignment", so re-scheduling is modelled as a no-op
  // status transition that only changes surveyor_user_id (see InsuranceClaim.scheduleSurvey).
  survey_scheduled:   ['survey_scheduled', 'surveyed'],
  surveyed:           ['approved', 'partially_approved', 'rejected', 'survey_scheduled'],
  approved:           ['paid'],
  partially_approved: ['paid'],
  rejected:           ['closed'],
  paid:               ['closed'],
  closed:             [],
});

export class IllegalClaimTransitionError extends DomainError {
  constructor(from: string, to: string) { super('INSURANCE_CLAIM_ILLEGAL_TRANSITION', `Cannot move insurance claim ${from}->${to}`, 409, { from, to }); }
}
export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean { return TRANSITIONS[from]?.includes(to) ?? false; }
export function assertTransition(from: ClaimStatus, to: ClaimStatus): void { if (!canTransition(from, to)) throw new IllegalClaimTransitionError(from, to); }
export function allowedNext(from: ClaimStatus): readonly ClaimStatus[] { return TRANSITIONS[from] ?? []; }
export function isTerminal(s: ClaimStatus): boolean { return TRANSITIONS[s]?.length === 0; }
/** Decision states that legitimately carry a positive approvedMinor (screen 293's settlement math). */
export function isApprovedKind(s: ClaimStatus): boolean { return s === 'approved' || s === 'partially_approved'; }
