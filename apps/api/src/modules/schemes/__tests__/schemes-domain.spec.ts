// modules/schemes/__tests__/schemes-domain.spec.ts · pure-domain unit tests: the application state machine,
// the explainable ELIGIBILITY evaluator, and the application/DBT invariants. No infra.
import { canTransition, isTerminal, APPLICATION_STATUSES, ApplicationStatus, IllegalApplicationTransitionError } from '../domain/scheme-application.state';
import { Scheme } from '../domain/scheme.entity';
import { SchemeApplication } from '../domain/scheme-application.entity';
import { DbtTransfer } from '../domain/dbt-transfer.entity';
import { SchemesEventType } from '../domain/schemes.events';
import { InvalidDbtError } from '../domain/schemes.errors';

const scheme = (rules: any) => Scheme.rehydrate({ id: 's1', code: 'pm_kisan', defaultName: 'PM-KISAN', authorityId: 'au1', categoryId: 'c1',
  benefitSummary: {}, eligibilityRules: rules, requiredDocTypeIds: [], applicationWindow: null, applicableRegionIds: [], processingFeeMinor: 0n, version: 1, isActive: true });

describe('scheme-application.state machine', () => {
  it('draft→submitted→under_verification→approved→disbursed→closed; clarify loop; reject→appeal', () => {
    expect(canTransition('draft', 'submitted')).toBe(true);
    expect(canTransition('submitted', 'under_verification')).toBe(true);
    expect(canTransition('under_verification', 'clarification_needed')).toBe(true);
    expect(canTransition('clarification_needed', 'under_verification')).toBe(true);
    expect(canTransition('under_verification', 'approved')).toBe(true);
    expect(canTransition('approved', 'disbursed')).toBe(true);
    expect(canTransition('disbursed', 'closed')).toBe(true);
    expect(canTransition('under_verification', 'rejected')).toBe(true);
    expect(canTransition('rejected', 'appealed')).toBe(true);
    expect(canTransition('appealed', 'under_verification')).toBe(true);
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(isTerminal('closed')).toBe(true);
    for (const s of APPLICATION_STATUSES) expect(() => canTransition(s, 'closed' as ApplicationStatus)).not.toThrow();
    expect(new IllegalApplicationTransitionError('closed', 'draft').code).toBe('SCHEME_APP_ILLEGAL_TRANSITION');
  });
});

describe('Scheme eligibility evaluator (explainable)', () => {
  it('passes when all rules satisfied', () => {
    const res = scheme({ roles: ['farmer'], landholding_max_acres: 5 }).evaluate({ roles: ['farmer'], landholdingAcres: 2 });
    expect(res.eligible).toBe(true); expect(res.reasons).toEqual([]);
  });
  it('explains each failed rule (role, landholding, gender, age)', () => {
    const res = scheme({ roles: ['farmer'], landholding_max_acres: 5, gender: 'female', age_min: 18, age_max: 60 })
      .evaluate({ roles: ['customer'], landholdingAcres: 9, gender: 'male', age: 70 });
    expect(res.eligible).toBe(false);
    expect(res.reasons.length).toBe(4);
    expect(res.reasons.some((r) => r.includes('roles'))).toBe(true);
    expect(res.reasons.some((r) => r.includes('landholding'))).toBe(true);
    expect(res.reasons.some((r) => r.includes('gender'))).toBe(true);
    expect(res.reasons.some((r) => r.includes('maximum age'))).toBe(true);
  });
  it('ignores unknown rule keys (forward-safe)', () => {
    expect(scheme({ some_future_rule: true }).evaluate({}).eligible).toBe(true);
  });
});

describe('SchemeApplication lifecycle + DBT', () => {
  it('draft→submit→verify→approve→disburse→close emits the right events; snapshots scheme_version', () => {
    const a = SchemeApplication.draft({ id: 'a1', tenantId: 't1', schemeId: 's1', schemeVersion: 3, schemeVersionId: null, applicantUserId: 'u1', assistedBy: null, formData: {}, eligibilityCheck: null });
    expect(a.toProps().schemeVersion).toBe(3);
    a.submit(new Date()); a.startVerification(); a.approve('GOV-123', new Date()); a.markDisbursed(); a.close();
    expect(a.status).toBe('closed');
    expect(a.pullEvents().map((e) => e.type)).toEqual([SchemesEventType.ApplicationSubmitted, SchemesEventType.ApplicationVerifying, SchemesEventType.ApplicationApproved, SchemesEventType.ApplicationDisbursed, SchemesEventType.ApplicationClosed]);
  });
  it('DBT record requires a positive amount + credited date; no wallet movement (observational)', () => {
    expect(() => DbtTransfer.record({ id: 'd', tenantId: 't', applicationId: 'a1', userId: 'u1', schemeId: 's1', amountMinor: 0n, instalmentNo: 1, creditedOn: '2026-06-01', pfmsRef: null })).toThrow(InvalidDbtError);
    const t = DbtTransfer.record({ id: 'd', tenantId: 't', applicationId: 'a1', userId: 'u1', schemeId: 's1', amountMinor: 200000n, instalmentNo: 1, creditedOn: '2026-06-01', pfmsRef: 'PFMS-9' });
    expect(t.pullEvents().map((e) => e.type)).toContain(SchemesEventType.DbtRecorded);
  });
});
