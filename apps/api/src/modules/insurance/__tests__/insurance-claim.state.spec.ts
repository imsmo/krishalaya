// modules/insurance/__tests__/insurance-claim.state.spec.ts · the claims state machine is
// correctness-critical (Law 5). Statuses byte-match the DDL's claim_status enum verbatim.
import { canTransition, assertTransition, allowedNext, isTerminal, isApprovedKind, IllegalClaimTransitionError, CLAIM_STATUSES } from '../domain/insurance-claim.state';

describe('insurance-claim state machine', () => {
  it('every status is a member of the DDL enum verbatim (claim_status, 0011_fintech_schemes.sql)', () => {
    expect(CLAIM_STATUSES).toEqual(['intimated', 'docs_pending', 'survey_scheduled', 'surveyed', 'approved', 'partially_approved', 'rejected', 'paid', 'closed']);
  });
  it('intimated can move to docs_pending, straight to survey_scheduled, or be rejected early', () => {
    expect(canTransition('intimated', 'docs_pending')).toBe(true);
    expect(canTransition('intimated', 'survey_scheduled')).toBe(true);
    expect(canTransition('intimated', 'rejected')).toBe(true);
    expect(canTransition('intimated', 'surveyed')).toBe(false); // cannot skip the survey step
  });
  it('docs_pending moves to survey_scheduled or rejected', () => {
    expect(canTransition('docs_pending', 'survey_scheduled')).toBe(true);
    expect(canTransition('docs_pending', 'rejected')).toBe(true);
    expect(canTransition('docs_pending', 'approved')).toBe(false); // must go through survey first
  });
  it('survey_scheduled moves forward to surveyed, OR self-loops to reassign a surveyor (re-schedule before any survey has happened)', () => {
    expect(canTransition('survey_scheduled', 'surveyed')).toBe(true);
    expect(canTransition('survey_scheduled', 'survey_scheduled')).toBe(true); // reassignment, no DDL status for "awaiting re-assignment"
    expect(canTransition('survey_scheduled', 'approved')).toBe(false);
  });
  it('surveyed can be decided (approved/partially_approved/rejected) OR re-surveyed (farmer disagreement, screen 292)', () => {
    expect(canTransition('surveyed', 'approved')).toBe(true);
    expect(canTransition('surveyed', 'partially_approved')).toBe(true);
    expect(canTransition('surveyed', 'rejected')).toBe(true);
    expect(canTransition('surveyed', 'survey_scheduled')).toBe(true); // the ONE claimant-triggered loop
    expect(canTransition('surveyed', 'paid')).toBe(false); // must be decided first
  });
  it('approved/partially_approved can only move to paid (settlement)', () => {
    expect(canTransition('approved', 'paid')).toBe(true);
    expect(canTransition('partially_approved', 'paid')).toBe(true);
    expect(canTransition('approved', 'closed')).toBe(false); // must be paid first
  });
  it('rejected and paid both close out administratively', () => {
    expect(canTransition('rejected', 'closed')).toBe(true);
    expect(canTransition('paid', 'closed')).toBe(true);
  });
  it('closed is terminal', () => {
    expect(allowedNext('closed')).toHaveLength(0);
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('intimated')).toBe(false);
  });
  it('assertTransition throws a typed, coded error on an illegal move', () => {
    expect(() => assertTransition('intimated', 'paid')).toThrow(IllegalClaimTransitionError);
    try { assertTransition('closed', 'paid'); fail('should have thrown'); }
    catch (e: any) { expect(e.code).toBe('INSURANCE_CLAIM_ILLEGAL_TRANSITION'); expect(e.httpStatus).toBe(409); }
  });
  it('only approved/partially_approved are the "approvedMinor-bearing" kinds', () => {
    expect(isApprovedKind('approved')).toBe(true);
    expect(isApprovedKind('partially_approved')).toBe(true);
    expect(isApprovedKind('rejected')).toBe(false);
    expect(isApprovedKind('paid')).toBe(false);
  });
});
