// modules/insurance/__tests__/insurance-claim.service.spec.ts · claims use-case tests (fakes, no DB).
// Pins: filing requires the policy to be ON COVER (active); decisions cap approvedMinor at the policy's own
// sum insured. PC-56 PARTNER-3a (founder Q1 / Q2 / Q5): settlement is REFUSED BY NAME — the old money-out cases (a wallet credit from the
// platform's payouts account, the policy flipped to claimed) are replaced by the refusal: nothing is read, keyed or posted. The claimant is
// the policy's HOLDER (an assisted filing audits the filer); a death claim on one's own cover needs a nominee; the decider is never the filer,
// the claimant or the surveyor; the surveyor is an active member of the claim's organisation and never the claimant.
import { InsuranceClaimService } from '../services/insurance-claim.service';
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { InsuranceForbiddenError, PolicyNotOnCoverError, InvalidClaimEventTypeError, InvalidClaimDecisionError, ClaimEvidenceNotAttachableError,
  InsuranceSettlementNotOnPlatformError, InsuranceClaimNeedsNomineeError, InsuranceDeciderConflictError, InsuranceSurveyorInvalidError, InsurancePolicyNotFoundError } from '../domain/insurance.errors';
import { decisionConflict, needsNominee } from '../services/insurance-claim.service';

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
    countEvidence: jest.fn(async () => 0), filerOf: jest.fn(async () => 'u1'), isActiveMember: jest.fn(async () => true),
  };
  const policies = { getById: jest.fn(async () => freshActivePolicy()), getForUpdate: jest.fn(async () => freshActivePolicy()), update: jest.fn() };
  const vetCert = { verify: jest.fn(async () => ({ status: 'verified', providerRef: 'ref-1' })) };
  const flags = { isEnabled: jest.fn(async () => true), assertEnabled: jest.fn(async () => true) };
  // PC-56 PARTNER-3a: the service holds NO wallet port any more (the settle posting is removed); the fake is kept to prove it is never called
  const svc = new InsuranceClaimService(uow as any, outbox as any, idem as any, quota as any, metrics as any, vetCert as any, flags as any, audit as any, repo as any, policies as any);
  return { svc, repo, policies, outbox, quota, idem, wallet, audit, vetCert, flags };
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

describe('settle — REFUSED BY NAME from the tenant realm (PC-56 PARTNER-3a, founder Q1; was the money-out path of screen 293)', () => {
  function approvedClaim() {
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    c.pullEvents();
    c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    c.decide('approved', 28_500_00n, null); c.pullEvents();
    return c;
  }
  it('PC-56 PARTNER-3a · settle is REFUSED BY NAME for a manager — nothing read, keyed or posted; the claim and the policy untouched', async () => {
    const { svc, repo, wallet, idem, policies, audit, outbox } = harness();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(approvedClaim());
    await expect(svc.settle('t1', insurer, 'c1')).rejects.toBeInstanceOf(InsuranceSettlementNotOnPlatformError);
    await expect(svc.settle('t1', insurer, 'c1')).rejects.toMatchObject({ code: 'INSURANCE_SETTLEMENT_NOT_ON_PLATFORM', httpStatus: 403,
      message: 'Claim settlement is not made on the platform yet: an insurer\'s funding leg does not exist. Nothing has been paid.' });
    for (const m of [repo.getForUpdate, repo.update, wallet.post, idem.remember, policies.getForUpdate, policies.update, audit.write, outbox.write]) expect(m).not.toHaveBeenCalled();
  });
  it('PC-56 PARTNER-3a · settle is refused for a non-manager too (the same sentence — no money path exists for anybody)', async () => {
    const { svc } = harness();
    await expect(svc.settle('t1', farmer, 'c1')).rejects.toBeInstanceOf(InsuranceSettlementNotOnPlatformError);
  });
  it('PC-56 PARTNER-3a · the service source carries no wallet posting any more (removed, not merely unreachable)', () => {
    const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'services', 'insurance-claim.service.ts'), 'utf8') as string;
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    for (const w of ['wallet.post', 'WALLET_SERVICE', 'PlatformAccount', 'userMain(', 'markClaimed']) expect([w, code.includes(w)]).toEqual([w, false]);
  });
});

describe('PC-56 PARTNER-3a · founder Q2 — the claimant is the HOLDER; assisted filings are audited; a death on one\'s own cover needs a nominee', () => {
  it('the holder files: the claimant is the holder, created_by the holder, assisted false', async () => {
    const { svc, repo, audit } = harness();
    const out = await svc.file('t1', farmer, 'idem-h1', fileDto);
    expect(out.claimantUserId).toBe('u1');
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'u1');
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: 'u1', action: 'insurance.claim.filed', newValue: { policyId: 'p1', assisted: false } }));
  });
  it('a desk member files on the holder\'s policy: the claimant is STILL the holder; the filer is created_by and the audit actor, assisted true', async () => {
    const { svc, repo, audit, outbox } = harness();
    const out = await svc.file('t1', insurer, 'idem-h2', fileDto);
    expect(out.claimantUserId).toBe('u1');
    expect(repo.insert).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'agent1');
    expect(audit.write).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ actorUserId: 'agent1', newValue: { policyId: 'p1', assisted: true } }));
    const filed = (outbox.write as jest.Mock).mock.calls.map((c) => c[1]).find((e) => e.eventType === 'insurance.claim_filed');
    expect(filed.payload).toMatchObject({ claimantUserId: 'u1', eventTypeCode: 'flood' });
  });
  it('a non-holder without insurance.manage → 404 (no IDOR), nothing written', async () => {
    const { svc, repo } = harness();
    await expect(svc.file('t1', { userId: 'neighbour', canManage: false }, 'idem-h3', fileDto)).rejects.toBeInstanceOf(InsurancePolicyNotFoundError);
    expect(repo.insert).not.toHaveBeenCalled();
  });
  it('a death claim on a person policy whose subject is the holder → INSURANCE_CLAIM_NEEDS_NOMINEE (422); an accident on it is the holder\'s own', async () => {
    const { svc, policies, repo } = harness();
    const person = () => InsurancePolicy.rehydrate({ ...freshActivePolicy().toProps(), subjectType: 'person', subjectId: 'u1' });
    (policies.getById as jest.Mock).mockImplementation(async () => person());
    await expect(svc.file('t1', insurer, 'idem-n1', { ...fileDto, eventTypeCode: 'death' })).rejects.toBeInstanceOf(InsuranceClaimNeedsNomineeError);
    await expect(svc.file('t1', farmer, 'idem-n2', { ...fileDto, eventTypeCode: 'death' })).rejects.toMatchObject({ code: 'INSURANCE_CLAIM_NEEDS_NOMINEE', httpStatus: 422 });
    expect(repo.insert).not.toHaveBeenCalled();
    const out = await svc.file('t1', farmer, 'idem-n3', { ...fileDto, eventTypeCode: 'accident' });
    expect(out.claimantUserId).toBe('u1');
    expect([needsNominee({ subjectType: 'person', subjectId: null, holderUserId: 'u1' }, 'death'), needsNominee({ subjectType: 'person', subjectId: 'other', holderUserId: 'u1' }, 'death'),
      needsNominee({ subjectType: 'animal', subjectId: 'a1', holderUserId: 'u1' }, 'death')]).toEqual([true, false, false]);
  });
});

describe('PC-56 PARTNER-3a · founder Q2 — the decider is never the filer, the claimant or the surveyor (the desk still decides — Q3)', () => {
  function surveyed() {
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    c.pullEvents(); c.scheduleSurvey('surveyor-1'); c.recordSurvey({ damagePercent: 35 });
    return c;
  }
  it('the surveyor → 409 INSURANCE_DECIDER_CONFLICT; the filer → 409; another manager decides', async () => {
    const { svc, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockImplementation(async () => surveyed());
    (repo.filerOf as jest.Mock).mockResolvedValue('agent1');
    await expect(svc.decide('t1', { userId: 'surveyor-1', canManage: true }, 'c1', { decision: 'rejected' } as any)).rejects.toMatchObject({ code: 'INSURANCE_DECIDER_CONFLICT', httpStatus: 409, details: { claimId: 'c1', as: 'surveyor' } });
    await expect(svc.decide('t1', insurer, 'c1', { decision: 'rejected' } as any)).rejects.toBeInstanceOf(InsuranceDeciderConflictError);
    expect(repo.update).not.toHaveBeenCalled();
    const out = await svc.decide('t1', { userId: 'admin2', canManage: true }, 'c1', { decision: 'approved', approvedMinor: '100' } as any);
    expect(out.status).toBe('approved');
    expect([decisionConflict('u1', { filer: null, claimant: 'u1', surveyor: null }), decisionConflict('x', { filer: null, claimant: 'u1', surveyor: null })]).toEqual(['claimant', null]);
  });
});

describe('PC-56 PARTNER-3a · founder Q5 — the surveyor is an active member of the claim\'s organisation, never the claimant', () => {
  function intimated() {
    const c = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-flood', description: null });
    c.pullEvents(); return c;
  }
  it('the claimant → 422 INSURANCE_SURVEYOR_INVALID; a non-member → 422; a member → scheduled', async () => {
    const { svc, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockImplementation(async () => intimated());
    await expect(svc.scheduleSurvey('t1', insurer, 'c1', { surveyorUserId: 'u1' } as any)).rejects.toMatchObject({ code: 'INSURANCE_SURVEYOR_INVALID', httpStatus: 422, details: { reason: 'claimant' } });
    (repo.isActiveMember as jest.Mock).mockResolvedValueOnce(false);
    await expect(svc.scheduleSurvey('t1', insurer, 'c1', { surveyorUserId: 'outsider' } as any)).rejects.toBeInstanceOf(InsuranceSurveyorInvalidError);
    expect(repo.isActiveMember).toHaveBeenCalledWith(expect.anything(), 't1', 'outsider');
    expect(repo.update).not.toHaveBeenCalled();
    const out = await svc.scheduleSurvey('t1', insurer, 'c1', { surveyorUserId: 'member-1' } as any);
    expect(out.status).toBe('survey_scheduled');
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

// ---- DEV-25/KV-BL-057 (Wave 7 external integration #3): verifyVetCert — advisory-only, livestock-only ----
function livestockPolicy() {
  return InsurancePolicy.rehydrate({
    id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr-livestock', policyNo: null,
    subjectType: 'animal', subjectId: 'animal-1', sumInsuredMinor: 50_000_00n, premiumMinor: 1_000_00n,
    premiumPaymentId: 'pay-1', status: 'active', validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null,
  });
}
describe('verifyVetCert (DEV-25, Wave 7 external integration #3)', () => {
  const livestockClaim = InsuranceClaim.file({ id: 'c1', tenantId: 't1', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt-death', description: null });
  it('requires insurance.manage', async () => {
    const { svc } = harness();
    await expect(svc.verifyVetCert('t1', farmer, 'c1', { certRef: 'cert-1' })).rejects.toBeInstanceOf(InsuranceForbiddenError);
  });
  it('rejects a non-livestock claim (policy subjectType !== animal) — not applicable', async () => {
    const { svc, repo, policies } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(livestockClaim);
    (policies.getById as jest.Mock).mockResolvedValue(freshActivePolicy()); // crop_season
    await expect(svc.verifyVetCert('t1', insurer, 'c1', { certRef: 'cert-1' })).rejects.toMatchObject({ code: 'INSURANCE_VET_CERT_NOT_APPLICABLE' });
  });
  it('flag OFF: returns unavailable/manual-review WITHOUT calling the external provider at all', async () => {
    const { svc, repo, policies, flags, vetCert } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(livestockClaim);
    (policies.getById as jest.Mock).mockResolvedValue(livestockPolicy());
    (flags.isEnabled as jest.Mock).mockResolvedValue(false);
    const out = await svc.verifyVetCert('t1', insurer, 'c1', { certRef: 'cert-1' });
    expect(vetCert.verify).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: 'unavailable', manualReviewRequired: true });
  });
  it('flag ON: calls the provider and NEVER auto-transitions the claim status (advisory-only)', async () => {
    const { svc, repo, policies, vetCert } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(livestockClaim);
    (policies.getById as jest.Mock).mockResolvedValue(livestockPolicy());
    const out = await svc.verifyVetCert('t1', insurer, 'c1', { certRef: 'cert-1' });
    expect(vetCert.verify).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'c1', certRef: 'cert-1', tenantId: 't1' }));
    expect(out).toMatchObject({ status: 'verified', manualReviewRequired: false });
    expect(repo.update).not.toHaveBeenCalled(); // advisory-only — never mutates claim status
  });
  it('a rejected/unavailable provider result always sets manualReviewRequired=true (never auto-verified)', async () => {
    const { svc, repo, policies, vetCert } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(livestockClaim);
    (policies.getById as jest.Mock).mockResolvedValue(livestockPolicy());
    (vetCert.verify as jest.Mock).mockResolvedValue({ status: 'unavailable', failureReason: 'vet_cert_provider_unavailable' });
    const out = await svc.verifyVetCert('t1', insurer, 'c1', { certRef: 'cert-1' });
    expect(out.manualReviewRequired).toBe(true);
  });
});
