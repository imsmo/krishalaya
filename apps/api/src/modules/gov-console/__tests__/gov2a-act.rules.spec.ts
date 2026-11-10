// modules/gov-console/__tests__/gov2a-act.rules.spec.ts · PC-56 GOV-2a · THE ACT MACHINE (pure) — GOV-2 Q2-A / Q1-A, lead-applied 2026-11-10.
// Which act is legal from which status (the ONE state machine, Law 5), which permission each act needs (the head alone decides), the input
// rules (a rejection: a listed code AND a sentence; a clarification: a sentence; a code only on a rejection), and the second person: a
// decision needs a check, by someone who is not the decider, not the applicant, not the assister.
import {
  GOV_ACTS, actFactsRefusal, actInputRefusal, actPermissionRefusal, nextStatus, permissionFor,
} from '../domain/gov-application-act.rules';

const facts = (over: Partial<{ status: string; verified: boolean; actorIsVerifier: boolean; actorIsApplicant: boolean; actorIsAssister: boolean }> = {}) => ({
  status: 'under_verification', verified: true, actorIsVerifier: false, actorIsApplicant: false, actorIsAssister: false, ...over,
});
const SENTENCE = 'The land record does not match the name.';

describe('PC-56 GOV-2a · the act machine', () => {
  it('four acts; verify/clarify need authority.applications.verify, approve/reject need authority.applications.decide', () => {
    expect([...GOV_ACTS]).toEqual(['verify', 'clarify', 'approve', 'reject']);
    expect(GOV_ACTS.map(permissionFor)).toEqual(['authority.applications.verify', 'authority.applications.verify', 'authority.applications.decide', 'authority.applications.decide']);
    const officer = new Set(['authority.applications.read', 'authority.applications.verify']);
    const head = new Set([...officer, 'authority.applications.decide']);
    expect(GOV_ACTS.map((a) => actPermissionRefusal(a, officer))).toEqual([null, null, 'GOV_PERMISSION_MISSING', 'GOV_PERMISSION_MISSING']);
    expect(GOV_ACTS.map((a) => actPermissionRefusal(a, head))).toEqual([null, null, null, null]);
  });

  it('verify: submitted / appealed → under_verification; under_verification with no checker → stays ("complete checking"); nothing else', () => {
    expect(nextStatus('verify', { status: 'submitted', verified: false })).toBe('under_verification');
    expect(nextStatus('verify', { status: 'appealed', verified: true })).toBe('under_verification');
    expect(nextStatus('verify', { status: 'under_verification', verified: false })).toBe('under_verification');
    for (const s of ['draft', 'clarification_needed', 'approved', 'rejected', 'disbursed', 'closed']) expect([s, nextStatus('verify', { status: s, verified: false })]).toEqual([s, null]);
    expect(nextStatus('verify', { status: 'under_verification', verified: true })).toBeNull();
  });

  it('clarify / approve / reject move only from under_verification', () => {
    expect(nextStatus('clarify', facts())).toBe('clarification_needed');
    expect(nextStatus('approve', facts())).toBe('approved');
    expect(nextStatus('reject', facts())).toBe('rejected');
    for (const s of ['submitted', 'clarification_needed', 'approved', 'rejected', 'appealed', 'disbursed', 'closed'])
      for (const a of ['clarify', 'approve', 'reject'] as const) expect([s, a, nextStatus(a, facts({ status: s }))]).toEqual([s, a, null]);
  });

  it('input: a rejection names a listed code AND a sentence of 10–500; a clarification a sentence; a code only on a rejection', () => {
    expect(actInputRefusal('reject', undefined, SENTENCE)).toBe('GOV_REASON_CODE_REQUIRED');
    expect(actInputRefusal('reject', 'not_a_code', SENTENCE)).toBe('GOV_REASON_CODE_REQUIRED');
    expect(actInputRefusal('reject', 'documents_missing', undefined)).toBe('GOV_REASON_REQUIRED');
    expect(actInputRefusal('reject', 'documents_missing', 'too short')).toBe('GOV_REASON_REQUIRED');
    expect(actInputRefusal('reject', 'documents_missing', 'x'.repeat(501))).toBe('GOV_REASON_REQUIRED');
    expect(actInputRefusal('reject', 'documents_missing', SENTENCE)).toBeNull();
    expect(actInputRefusal('clarify', undefined, undefined)).toBe('GOV_NOTE_REQUIRED');
    expect(actInputRefusal('clarify', undefined, 'short')).toBe('GOV_NOTE_REQUIRED');
    expect(actInputRefusal('clarify', undefined, 'Please upload the land record page.')).toBeNull();
    expect(actInputRefusal('approve', 'other', undefined)).toBe('GOV_REASON_CODE_ONLY_ON_REJECT');
    expect(actInputRefusal('verify', 'other', undefined)).toBe('GOV_REASON_CODE_ONLY_ON_REJECT');
    expect(actInputRefusal('approve', undefined, undefined)).toBeNull();
    expect(actInputRefusal('approve', undefined, 'x'.repeat(501))).toBe('GOV_NOTE_REQUIRED');
  });

  it('the second person: a decision needs a check, and the decider is never the checker, the applicant or the assister', () => {
    for (const a of ['approve', 'reject'] as const) {
      expect(actFactsRefusal(a, null)).toBe('GOV_APPLICATION_NOT_FOUND');
      expect(actFactsRefusal(a, facts({ verified: false }))).toBe('GOV_NOT_VERIFIED');
      expect(actFactsRefusal(a, facts({ actorIsVerifier: true }))).toBe('GOV_DECIDER_IS_VERIFIER');
      expect(actFactsRefusal(a, facts({ actorIsApplicant: true }))).toBe('GOV_DECIDER_IS_APPLICANT');
      expect(actFactsRefusal(a, facts({ actorIsAssister: true }))).toBe('GOV_DECIDER_IS_ASSISTER');
      expect(actFactsRefusal(a, facts({ status: 'submitted' }))).toBe('GOV_ACT_NOT_NOW');
      expect(actFactsRefusal(a, facts())).toBeNull();
    }
    // checking and asking are not decisions: the checker may clarify; the applicant's own checker is not refused here (the decider is)
    expect(actFactsRefusal('clarify', facts({ actorIsVerifier: true }))).toBeNull();
    expect(actFactsRefusal('verify', facts({ status: 'submitted', verified: false }))).toBeNull();
    // THE LONE HEAD (GOV-0 founder Q1, open): a head who checked an application can never decide it — only one an officer checked
    expect(actFactsRefusal('approve', facts({ actorIsVerifier: true }))).toBe('GOV_DECIDER_IS_VERIFIER');
  });
});
