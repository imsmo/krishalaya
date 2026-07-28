// modules/insurance/__tests__/insurance-claim.entity.spec.ts · aggregate invariants + event emission.
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { ClaimEventType } from '../domain/insurance.events';
import { IllegalClaimTransitionError } from '../domain/insurance-claim.state';
import { InvalidClaimDecisionError, ClaimNotApprovedError } from '../domain/insurance.errors';

const base = {
  id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1',
  eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: 'Heavy rain damage',
};

describe('InsuranceClaim.file', () => {
  it('always starts intimated + emits Filed', () => {
    const c = InsuranceClaim.file({ ...base, now: new Date('2026-07-01T00:00:00Z') });
    expect(c.status).toBe('intimated');
    const events = c.pullEvents();
    expect(events.map((e) => e.type)).toContain(ClaimEventType.Filed);
  });
  it('computes intimatedWithin72h honestly from eventDate vs filing time', () => {
    const within = InsuranceClaim.file({ ...base, now: new Date('2026-07-01T00:00:00Z') }); // 24h later
    expect(within.toProps().intimatedWithin72h).toBe(true);
    const late = InsuranceClaim.file({ ...base, now: new Date('2026-07-10T00:00:00Z') }); // 10 days later
    expect(late.toProps().intimatedWithin72h).toBe(false);
  });
});

describe('claims progression (screens 291-292)', () => {
  it('intimated -> docs_pending -> survey_scheduled -> surveyed', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.requestDocuments();
    expect(c.status).toBe('docs_pending');
    c.scheduleSurvey('surveyor-1');
    expect(c.status).toBe('survey_scheduled');
    expect(c.toProps().surveyorUserId).toBe('surveyor-1');
    c.recordSurvey({ damagePercent: 35 });
    expect(c.status).toBe('surveyed');
    expect(c.toProps().surveyReport).toEqual({ damagePercent: 35 });
  });
  it('intimated can skip straight to survey_scheduled (evidence already sufficient)', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.scheduleSurvey('surveyor-1');
    expect(c.status).toBe('survey_scheduled');
  });
  it('farmer DISAGREEMENT (screen 292) re-opens a re-survey, never cancels the claim', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 20 });
    c.requestResurvey();
    expect(c.status).toBe('survey_scheduled');
    expect(c.toProps().surveyorUserId).toBeNull(); // pending reassignment to a SECOND surveyor
    // and the claim can complete a fresh survey cycle afterwards
    c.scheduleSurvey('surveyor-2'); c.recordSurvey({ damagePercent: 30 });
    expect(c.status).toBe('surveyed');
  });
});

describe('InsuranceClaim.decide (screen 293 settlement math source)', () => {
  function surveyed() {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    return c;
  }
  it('approved requires a positive approvedMinor', () => {
    const c = surveyed();
    c.decide('approved', 28_500_00n, null);
    expect(c.status).toBe('approved');
    expect(c.approvedMinor).toBe(28_500_00n);
    expect(c.pullEvents().map((e) => e.type)).toContain(ClaimEventType.Decided);
  });
  it('rejects an approved decision with no approvedMinor', () => {
    const c = surveyed();
    expect(() => c.decide('approved', null, null)).toThrow(InvalidClaimDecisionError);
  });
  it('rejects a rejected decision that carries an approvedMinor', () => {
    const c = surveyed();
    expect(() => c.decide('rejected', 100n, null)).toThrow(InvalidClaimDecisionError);
  });
  it('rejected decision needs no approvedMinor and moves to rejected', () => {
    const c = surveyed();
    c.decide('rejected', null, 'policy lapsed before the event');
    expect(c.status).toBe('rejected');
    expect(c.approvedMinor).toBeNull();
  });
  it('cannot decide a claim that has not been surveyed yet', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    expect(() => c.decide('approved', 100n, null)).toThrow(IllegalClaimTransitionError);
  });
});

describe('InsuranceClaim.settle (money-out, screen 293)', () => {
  it('approved -> paid, requires a prior positive approvedMinor', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    c.decide('approved', 28_500_00n, null); c.pullEvents();
    c.settle();
    expect(c.status).toBe('paid');
    expect(c.pullEvents().map((e) => e.type)).toContain(ClaimEventType.Settled);
  });
  it('cannot settle a claim with no approved decision (the trust-critical guard)', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    expect(() => c.settle()).toThrow(ClaimNotApprovedError);
  });
  it('cannot settle a rejected claim', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 0 });
    c.decide('rejected', null, null);
    expect(() => c.settle()).toThrow(ClaimNotApprovedError);
  });
});

describe('InsuranceClaim.close', () => {
  it('paid -> closed', () => {
    const c = InsuranceClaim.file(base); c.pullEvents();
    c.scheduleSurvey('s1'); c.recordSurvey({ damagePercent: 35 });
    c.decide('approved', 100n, null); c.settle();
    c.close(new Date('2026-07-15T00:00:00Z'));
    expect(c.status).toBe('closed');
    expect(c.toProps().closedAt).toEqual(new Date('2026-07-15T00:00:00Z'));
  });
});

describe('toJSON — money rendered as strings, no float', () => {
  it('serialises approvedMinor as a decimal string, null when absent', () => {
    const c = InsuranceClaim.file(base);
    expect(c.toJSON().approvedMinor).toBeNull();
    c.scheduleSurvey('s1'); c.recordSurvey({ damagePercent: 35 }); c.decide('approved', 12_345n, null);
    expect(c.toJSON().approvedMinor).toBe('12345');
    expect(typeof c.toJSON().approvedMinor).toBe('string');
  });
});
