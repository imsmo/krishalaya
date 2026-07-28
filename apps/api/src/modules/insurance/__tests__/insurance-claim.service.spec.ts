// modules/insurance/__tests__/insurance-claim.service.spec.ts · claims use-case tests (fakes, no DB).
// Pins: filing requires the policy to be ON COVER (active); decisions cap approvedMinor at the policy's own
// sum insured; settlement is the TRUST-CRITICAL money-out path — RBAC-gated, idempotent, credits the
// claimant's wallet via the wallet port (never a new money primitive), and fires the underlying policy's
// active->claimed transition in the SAME tx.
import { InsuranceClaimService } from '../services/insurance-claim.service';
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { InsuranceForbiddenError, PolicyNotOnCoverError, InvalidClaimEventTypeError, InvalidClaimDecisionError, ClaimEvidenceNotAttachableError } from '../domain/insurance.errors';

// A FRESH InsurancePolicy instance per call — the entity mutates `props` in place (e.g. markClaimed()), so a
// module-level shared instance would leak status across tests (test-fixture bug, not a production one: the
// real repository always constructs a fresh aggregate per getForUpdate() call).
function freshActivePolicy() {
  return InsurancePolicy.rehydrate({
    id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: null,
    subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100_000_00n, premiumMinor: 2_000_00n,
    premiumPaymentId: 'pay-1', status: 'active', validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null,
  });
}
function freshProposedPolicy() {
  return InsurancePolicy.rehydrate({ ...freshActivePolicy().toProps(), status: 'proposed' });
}

function harness() {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const quota = { assertWithinLimit: jest.fn(), increment: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const wallet = { post: jest.fn(async () => ({ txnId: 'txn-1', alreadyApplied: false })), balanceMinor: jest.fn() };
  const audit = { write: jest.fn() };
  const repo = {
    insert: jest.fn(), getForUpdate: jest.fn(), update: jest.fn(), getById: jest.fn(), listFor: jest.fn(),
    attachEvidence: jest.fn(), evidenceAttachable: jest.fn(async () => true), resolveEventTypeId: jest.fn(async () => 'evt-flood'),
    countEvidence: jest.fn(async () => 0),
  };
  const policies = { getById: jest.fn(async () => freshActivePolicy()), getForUpdate: jest.fn(async () => freshActivePolicy()), update: jest.fn() };
  const svc = new InsuranceClaimService(uow as any, outbox as any, idem as any, quota as any, metrics as any, wallet as any, audit as any, repo as any, policies as any);
  return { svc, repo, policies, outbox, quota, idem, wallet, audit };
}
const farmer = { userId: 'u1', canManage: false };
const insurer = { userId: 'agent1', canManage: true };
const fileDto = { policyId: 'p1', eventDate: '2026-06-30', eventTypeCode: 'flood', description: 'flood damage' } as any;

describe('file — claim intimation (screens 289-290)', () => {
  it('files a claim against an ON-COVER (active) policy', async () => {
    const { svc, repo } = harness();
    const out = await svc.file('t1', farmer, 'idem-1', fileDto);
    expect(out.status).toBe('intimated');
    expect(repo.insert).toHaveBeenCalledTimes(1);
  });
  it('rejects filing against a policy that is NOT on cover (e.g. still proposed)', async () => {
    const { svc, policies } = harness();
    (policies.getById as jest.Mock).mockResolvedValue(freshProposedPolicy());
    await expect(svc.file('t1', farmer, 'idem-2', fileDto)).rejects.toBeInstanceOf(PolicyNotOnCoverError);
  });
  it('rejects an unknown claim_event code', async () => {
    const { svc, repo } = harness();
    (repo.resolveEventTypeId as jest.Mock).mockResolvedValue(null);
    await expect(svc.file('t1', farmer, 'idem-3', fileDto)).rejects.toBeInstanceOf(InvalidClaimEventTypeError);
  });
  it('enforces the plan quota before creating any claim', async () => {
    const { svc, quota } = harness();
    await svc.file('t1', farmer, 'idem-4', fileDto);
    expect(quota.assertWithinLimit).toHaveBeenCalledWith('t1', 'insurance_claims');
  });
  it('attaches evidence media in the SAME tx when supplied', async () => {
    const { svc, repo } = harness();
    await svc.file('t1', farmer, 'idem-5', { ...fileDto, evidenceMediaIds: ['media-1', 'media-2'] });
    expect(repo.attachEvidence).toHaveBeenCalledWith(expect.anything(), expect.any(String), ['media-1', 'media-2']);
  });
  it('rejects filing with evidence media that is not the caller\'s own clean-scanned asset', async () => {
    const { svc, repo } = harness();
    (repo.evidenceAttachable as jest.Mock).mockResolvedValue(false);
    await expect(svc.file('t1', farmer, 'idem-6', { ...fileDto, evidenceMediaIds: ['someone-elses-media'] })).rejects.toBeInstanceOf(ClaimEvidenceNotAttachableError);
  });
  it('is idempotent: the remember() wrapper is exercised on the caller key', async () => {
    const { svc, idem } = harness();
    await svc.file('t1', farmer, 'idem-7', fileDto);
    expect(idem.remember).toHaveBeenCalledWith('idem-7', 'u1', 'insurance.claim.file', expect.any(Function));
  });
});

describe('decide — RBAC + sum-insured cap (screen 293)', () => {
  function surveyedClaim() {
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    return c;
  }
  it('a non-manager cannot decide a claim', async () => {
    const { svc } = harness();
    await expect(svc.decide('t1', farmer, 'c1', { decision: 'approved', approvedMinor: '100' } as any)).rejects.toBeInstanceOf(InsuranceForbiddenError);
  });
  it('caps approvedMinor at the policy\'s own sum insured — never invents money beyond cover', async () => {
    const { svc, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(surveyedClaim());
    await expect(svc.decide('t1', insurer, 'c1', { decision: 'approved', approvedMinor: '10000001' } as any))
      .rejects.toBeInstanceOf(InvalidClaimDecisionError);
  });
  it('accepts a decision within the sum-insured cap', async () => {
    const { svc, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(surveyedClaim());
    const out = await svc.decide('t1', insurer, 'c1', { decision: 'partially_approved', approvedMinor: '2850000' } as any);
    expect(out.status).toBe('partially_approved');
    expect(out.approvedMinor).toBe('2850000');
  });
});

describe('settle — money-out (the trust-critical path, screen 293)', () => {
  function approvedClaim() {
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    c.decide('approved', 28_500_00n, null); c.pullEvents();
    return c;
  }
  it('a non-manager cannot settle a claim', async () => {
    const { svc } = harness();
    await expect(svc.settle('t1', farmer, 'idem-s1', 'c1')).rejects.toBeInstanceOf(InsuranceForbiddenError);
  });
  it('credits the claimant\'s wallet from the platform payouts account — zero-sum, via the EXISTING wallet port', async () => {
    const { svc, repo, wallet } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(approvedClaim());
    const out = await svc.settle('t1', insurer, 'idem-s2', 'c1');
    expect(out.status).toBe('paid');
    expect(wallet.post).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      txnType: 'insurance_claim_settlement',
      idempotencyKey: 'insurance-claim-settle:c1',
      legs: [
        { account: expect.objectContaining({ accountCode: 'payouts' }), amountMinor: -28_500_00n },
        { account: expect.objectContaining({ userId: 'u1' }), amountMinor: 28_500_00n },
      ],
    }));
  });
  it('fires the underlying policy\'s active->claimed transition in the SAME settlement', async () => {
    const { svc, repo, policies } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(approvedClaim());
    await svc.settle('t1', insurer, 'idem-s3', 'c1');
    expect(policies.getForUpdate).toHaveBeenCalledWith(expect.anything(), 't1', 'p1');
    expect(policies.update).toHaveBeenCalledTimes(1);
    const updatedPolicy = (policies.update as jest.Mock).mock.calls[0][1] as InsurancePolicy;
    expect(updatedPolicy.status).toBe('claimed');
  });
  it('is idempotent on the caller key (Law 3)', async () => {
    const { svc, repo, idem } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(approvedClaim());
    await svc.settle('t1', insurer, 'idem-s4', 'c1');
    expect(idem.remember).toHaveBeenCalledWith('idem-s4', 'agent1', 'insurance.claim.settle', expect.any(Function));
  });
});

describe('insurer-side RBAC gate (mirrors the lender-partner pattern)', () => {
  it('requestDocuments/scheduleSurvey/recordSurvey/close all require insurance.manage', async () => {
    const { svc } = harness();
    await expect(svc.requestDocuments('t1', farmer, 'c1')).rejects.toBeInstanceOf(InsuranceForbiddenError);
    await expect(svc.scheduleSurvey('t1', farmer, 'c1', { surveyorUserId: 's1' } as any)).rejects.toBeInstanceOf(InsuranceForbiddenError);
    await expect(svc.recordSurvey('t1', farmer, 'c1', { damagePercent: 10 } as any)).rejects.toBeInstanceOf(InsuranceForbiddenError);
    await expect(svc.close('t1', farmer, 'c1')).rejects.toBeInstanceOf(InsuranceForbiddenError);
  });
});

describe('acknowledgeAssessment — screen 292 agree/disagree', () => {
  function surveyedClaim() {
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    return c;
  }
  it('agree records no state change', async () => {
    const { svc, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(surveyedClaim());
    const out = await svc.acknowledgeAssessment('t1', farmer, 'c1', { agree: true });
    expect(out.status).toBe('surveyed');
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('disagree re-opens the survey loop (never cancels the claim)', async () => {
    const { svc, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(surveyedClaim());
    const out = await svc.acknowledgeAssessment('t1', farmer, 'c1', { agree: false });
    expect(out.status).toBe('survey_scheduled');
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
});

describe('anti-IDOR: getById returns 404 (not 403) to a non-owner non-manager', () => {
  it('hides another claimant\'s claim', async () => {
    const { svc, repo } = harness();
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'someone-else', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    (repo.getById as jest.Mock).mockResolvedValue(c);
    await expect(svc.getById('t1', farmer, 'c1')).rejects.toMatchObject({ code: 'INSURANCE_CLAIM_NOT_FOUND' });
  });
});
