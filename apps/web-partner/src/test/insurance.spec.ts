// apps/web-partner/src/test/insurance.spec.ts · unit tests for the pure insurer-console helpers.
import {
  CLAIM_STATUSES, isClaimStatus, claimStatusKey, claimStatusTone, isClaimTerminal,
  canRequestDocuments, canScheduleSurvey, canRecordSurvey, canDecideAfterSurvey, canRejectEarly, canSettle, canClose,
  POLICY_STATUSES, isPolicyStatus, policyStatusKey, policyStatusTone, isOnCover,
  InsuranceInputError, buildDecide, buildScheduleSurvey, buildRecordSurvey,
  buildClaimListQuery, claimsHref, buildPolicyListQuery, policiesHref,
  canVerifyVetCert, buildVerifyVetCert,
} from '../features/insurance/insurance';

describe('claim state', () => {
  it('mirrors the API statuses + key/tone/terminal', () => {
    expect(CLAIM_STATUSES).toEqual([
      'intimated', 'docs_pending', 'survey_scheduled', 'surveyed',
      'approved', 'partially_approved', 'rejected', 'paid', 'closed',
    ]);
    expect(isClaimStatus('surveyed')).toBe(true);
    expect(isClaimStatus('nope')).toBe(false);
    expect(claimStatusKey('paid')).toBe('claim.st.paid');
    expect(claimStatusKey('nope')).toBe('claim.st.unknown');
    expect(claimStatusTone('paid')).toBe('ok');
    expect(claimStatusTone('rejected')).toBe('danger');
    expect(claimStatusTone('intimated')).toBe('warn');
    expect(isClaimTerminal('closed')).toBe(true);
    expect(isClaimTerminal('paid')).toBe(false);
  });
});

describe('insurer action gates (mirror InsuranceClaim entity transitions exactly)', () => {
  it('requestDocuments only from intimated', () => {
    expect(canRequestDocuments('intimated')).toBe(true);
    expect(canRequestDocuments('docs_pending')).toBe(false);
    expect(canRequestDocuments('surveyed')).toBe(false);
  });
  it('scheduleSurvey from intimated, docs_pending, survey_scheduled (reassign), surveyed (manual re-schedule)', () => {
    expect(canScheduleSurvey('intimated')).toBe(true);
    expect(canScheduleSurvey('docs_pending')).toBe(true);
    expect(canScheduleSurvey('survey_scheduled')).toBe(true);
    expect(canScheduleSurvey('surveyed')).toBe(true);
    expect(canScheduleSurvey('approved')).toBe(false);
    expect(canScheduleSurvey('closed')).toBe(false);
  });
  it('recordSurvey only from survey_scheduled', () => {
    expect(canRecordSurvey('survey_scheduled')).toBe(true);
    expect(canRecordSurvey('surveyed')).toBe(false);
    expect(canRecordSurvey('intimated')).toBe(false);
  });
  it('decide (approved/partially_approved) only after survey; early-reject from intimated/docs_pending', () => {
    expect(canDecideAfterSurvey('surveyed')).toBe(true);
    expect(canDecideAfterSurvey('intimated')).toBe(false);
    expect(canRejectEarly('intimated')).toBe(true);
    expect(canRejectEarly('docs_pending')).toBe(true);
    expect(canRejectEarly('surveyed')).toBe(false); // surveyed's reject is via canDecideAfterSurvey, not early
  });
  it('settle only once approved/partially_approved; close only from rejected/paid', () => {
    expect(canSettle('approved')).toBe(true);
    expect(canSettle('partially_approved')).toBe(true);
    expect(canSettle('surveyed')).toBe(false);
    expect(canClose('rejected')).toBe(true);
    expect(canClose('paid')).toBe(true);
    expect(canClose('approved')).toBe(false);
  });
});

describe('policy state (read-only console side)', () => {
  it('mirrors the API statuses + key/tone/on-cover', () => {
    expect(POLICY_STATUSES).toEqual(['proposed', 'active', 'lapsed', 'cancelled', 'expired', 'claimed']);
    expect(isPolicyStatus('active')).toBe(true);
    expect(isPolicyStatus('nope')).toBe(false);
    expect(policyStatusKey('active')).toBe('policy.st.active');
    expect(policyStatusKey('nope')).toBe('policy.st.unknown');
    expect(policyStatusTone('active')).toBe('ok');
    expect(policyStatusTone('lapsed')).toBe('danger');
    expect(isOnCover('active')).toBe(true);
    expect(isOnCover('proposed')).toBe(false);
  });
});

describe('money (bigint, float-free) + input builders', () => {
  it('buildDecide: rejected carries no amount', () => {
    expect(buildDecide('rejected', undefined, undefined)).toEqual({ decision: 'rejected' });
    expect(buildDecide('rejected', undefined, 'fraud suspected')).toEqual({ decision: 'rejected', note: 'fraud suspected' });
  });
  it('buildDecide: approved/partially_approved requires positive rupees -> paise via BigInt', () => {
    expect(buildDecide('approved', '5000', undefined)).toEqual({ decision: 'approved', approvedMinor: '500000' });
    expect(buildDecide('partially_approved', '1', 'partial')).toEqual({ decision: 'partially_approved', approvedMinor: '100', note: 'partial' });
  });
  it('buildDecide: bad decision / bad amount / too-long note throw InsuranceInputError with the right field key', () => {
    expect(() => buildDecide('nope', '100', undefined)).toThrow(InsuranceInputError);
    expect(() => buildDecide('approved', '', undefined)).toThrow(InsuranceInputError);
    expect(() => buildDecide('approved', 'abc', undefined)).toThrow(InsuranceInputError);
    expect(() => buildDecide('rejected', undefined, 'x'.repeat(2001))).toThrow(InsuranceInputError);
    try { buildDecide('approved', '', undefined); } catch (e) { expect((e as InsuranceInputError).fieldKey).toBe('badAmount'); }
  });
  it('buildScheduleSurvey: requires a valid UUID', () => {
    expect(buildScheduleSurvey('11111111-2222-3333-4444-555555555555')).toEqual({ surveyorUserId: '11111111-2222-3333-4444-555555555555' });
    expect(() => buildScheduleSurvey('not-a-uuid')).toThrow(InsuranceInputError);
    expect(() => buildScheduleSurvey('')).toThrow(InsuranceInputError);
  });
  it('buildRecordSurvey: damagePercent 0-100, optional notes', () => {
    expect(buildRecordSurvey('45', undefined)).toEqual({ damagePercent: 45 });
    expect(buildRecordSurvey('12.5', 'visible crop loss')).toEqual({ damagePercent: 12.5, notes: 'visible crop loss' });
    expect(() => buildRecordSurvey('101', undefined)).toThrow(InsuranceInputError);
    expect(() => buildRecordSurvey('-1', undefined)).toThrow(InsuranceInputError);
    expect(() => buildRecordSurvey('abc', undefined)).toThrow(InsuranceInputError);
    expect(() => buildRecordSurvey('50', 'x'.repeat(2001))).toThrow(InsuranceInputError);
  });
});

describe('list queries + hrefs', () => {
  it('buildClaimListQuery: status validated, blank cursor omitted, limit fixed at 50', () => {
    expect(buildClaimListQuery({})).toEqual({ status: undefined, policyId: undefined, cursor: undefined, limit: 50 });
    expect(buildClaimListQuery({ status: 'surveyed', cursor: 'c1' })).toEqual({ status: 'surveyed', policyId: undefined, cursor: 'c1', limit: 50 });
    expect(buildClaimListQuery({ status: 'nope' })).toEqual({ status: undefined, policyId: undefined, cursor: undefined, limit: 50 });
  });
  it('buildClaimListQuery: policyId only kept when it is a well-formed UUID', () => {
    expect(buildClaimListQuery({ policyId: '11111111-2222-3333-4444-555555555555' })).toEqual({
      status: undefined, policyId: '11111111-2222-3333-4444-555555555555', cursor: undefined, limit: 50,
    });
    expect(buildClaimListQuery({ policyId: 'not-a-uuid' }).policyId).toBeUndefined();
  });
  it('claimsHref preserves status + cursor + policyId', () => {
    expect(claimsHref()).toBe('/insurance-claims');
    expect(claimsHref('surveyed')).toBe('/insurance-claims?status=surveyed');
    expect(claimsHref('paid', 'cur2')).toBe('/insurance-claims?status=paid&cursor=cur2');
    expect(claimsHref(undefined, undefined, 'pol-1')).toBe('/insurance-claims?policyId=pol-1');
  });
  it('buildPolicyListQuery + policiesHref mirror the claim ones', () => {
    expect(buildPolicyListQuery({ status: 'active' })).toEqual({ status: 'active', cursor: undefined, limit: 50 });
    expect(policiesHref('lapsed')).toBe('/insurance-policies?status=lapsed');
  });
});

describe('PC-2A vet-cert verification', () => {
  it('gate mirrors live pre-decision statuses', () => {
    // PC-55 B7: this block used require() to dodge the union type. Typed properly now — `as const` keeps the
    // literals in the ClaimStatus union, which is what the helper actually accepts.
    for (const st of ['intimated', 'docs_pending', 'survey_scheduled', 'surveyed'] as const) expect(canVerifyVetCert(st)).toBe(true);
    for (const st of ['approved', 'paid', 'rejected', 'closed'] as const) expect(canVerifyVetCert(st)).toBe(false);
  });
  it('certRef 1-120 chars, trimmed; empty/oversize throws', () => {
    expect(buildVerifyVetCert(' VET-2026-0042 ')).toEqual({ certRef: 'VET-2026-0042' });
    expect(() => buildVerifyVetCert('   ')).toThrow();
    expect(() => buildVerifyVetCert('x'.repeat(121))).toThrow();
  });
});

