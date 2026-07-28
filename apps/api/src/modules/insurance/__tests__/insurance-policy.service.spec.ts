// modules/insurance/__tests__/insurance-policy.service.spec.ts · enrolment use-case tests (fakes, no DB).
// Pins: propose() computes premium SERVER-SIDE from premium_calc + govt_subsidy_bps (never trusts a client
// premium), creates one row per subject atomically (screen 284's multi-animal case), and cancel() is
// ownership-enforced + idempotent.
import { InsurancePolicyService } from '../services/insurance-policy.service';
import { InsuranceProduct } from '../domain/insurance-product.entity';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { InsuranceForbiddenError, PolicyNotAwaitingPremiumError, InsurancePolicyNotFoundError } from '../domain/insurance.errors';

const cropProduct = InsuranceProduct.rehydrate({
  id: 'pr1', partnerId: 'partner-insurer-1', productKindId: 'k-pmfby', defaultName: 'PMFBY Groundnut',
  premiumCalcRaw: { kind: 'pct_of_sum_insured', bps: 1200 }, sumInsuredRules: {},
  govtSubsidyBps: 8333, ourCommissionBps: 0, isParametric: false, isActive: true,
});

function harness() {
  const tx = { query: jest.fn() };
  const uow = { run: jest.fn(async (_t: string, fn: any) => fn(tx)) };
  const outbox = { write: jest.fn() };
  const idem = { remember: jest.fn(async (_k: string, _u: string, _e: string, fn: any) => fn()) };
  const quota = { assertWithinLimit: jest.fn(), increment: jest.fn() };
  const metrics = { inc: jest.fn(), observe: jest.fn() };
  const audit = { write: jest.fn() };
  const repo = { insert: jest.fn(), getForUpdate: jest.fn(), update: jest.fn(), getById: jest.fn(), listFor: jest.fn() };
  const productSvc = { getActiveProductForEnrolment: jest.fn(async () => cropProduct) };
  const payments = { createIntent: jest.fn(async () => ({ paymentId: 'pay-1', gatewayOrderId: 'gw-1', provider: 'sandbox', amountMinor: '200000', status: 'initiated' })) };
  const svc = new InsurancePolicyService(uow as any, outbox as any, idem as any, quota as any, metrics as any, audit as any, repo as any, productSvc as any, payments as any);
  return { svc, repo, outbox, quota, productSvc, idem, payments };
}
const farmer = { userId: 'u1', canManage: false };

describe('propose — enrolment (screens 283-285)', () => {
  it('crop (single subject): premium is server-computed from premium_calc + govt_subsidy_bps, never client-supplied', async () => {
    const { svc, repo } = harness();
    const dto = { productId: 'pr1', subjectType: 'crop_season', subjects: [{ subjectId: 'plot1', sumInsuredMinor: '10000000' }], validFrom: '2026-06-15', validUntil: '2026-11-30' } as any;
    const out = await svc.propose('t1', farmer, 'idem-1', dto);
    expect(out.policies).toHaveLength(1);
    expect(repo.insert).toHaveBeenCalledTimes(1);
    // ₹1,00,000 sum insured (10,000,000 minor units) × 12% = ₹12,000 total (1,200,000 minor units);
    // 83.33% govt-subsidised → farmer share ≈ ₹2,000, govt ≈ ₹10,000
    const p = out.policies[0];
    expect(BigInt(p.premiumMinor) + BigInt(p.govtShareMinor)).toBe(1_200_000n); // exact split, no drift (Law 2)
    expect(BigInt(p.premiumMinor)).toBeGreaterThan(0n);
  });
  it('livestock (multi-subject): N subjects → N insurance_policies rows, ONE tx, ONE idempotency key', async () => {
    const { svc, repo } = harness();
    const dto = {
      productId: 'pr1', subjectType: 'animal',
      subjects: [{ subjectId: 'cow1', sumInsuredMinor: '3000000' }, { subjectId: 'cow2', sumInsuredMinor: '3000000' }],
      validFrom: '2026-01-01', validUntil: '2027-01-01',
    } as any;
    const out = await svc.propose('t1', farmer, 'idem-2', dto);
    expect(out.policies).toHaveLength(2);
    expect(repo.insert).toHaveBeenCalledTimes(2);
    expect(out.policies[0].subjectId).toBe('cow1'); expect(out.policies[1].subjectId).toBe('cow2');
  });
  it('health+life (person, no subjectId supplied) defaults the subject to the caller (self)', async () => {
    const { svc, repo } = harness();
    const dto = { productId: 'pr1', subjectType: 'person', subjects: [{ sumInsuredMinor: '50000000' }], validFrom: '2026-01-01', validUntil: '2027-01-01' } as any;
    await svc.propose('t1', farmer, 'idem-3', dto);
    const inserted = (repo.insert as jest.Mock).mock.calls[0][1] as InsurancePolicy;
    expect(inserted.toProps().subjectId).toBe('u1'); // == farmer.userId
  });
  it('enforces the plan quota before creating any policy', async () => {
    const { svc, quota } = harness();
    const dto = { productId: 'pr1', subjectType: 'crop_season', subjects: [{ subjectId: 'plot1', sumInsuredMinor: '10000000' }], validFrom: '2026-06-15', validUntil: '2026-11-30' } as any;
    await svc.propose('t1', farmer, 'idem-4', dto);
    expect(quota.assertWithinLimit).toHaveBeenCalledWith('t1', 'insurance_policies');
  });
  it('is idempotent: same key → the remember() wrapper is exercised (not called twice for real)', async () => {
    const { svc, idem } = harness();
    const dto = { productId: 'pr1', subjectType: 'crop_season', subjects: [{ subjectId: 'plot1', sumInsuredMinor: '10000000' }], validFrom: '2026-06-15', validUntil: '2026-11-30' } as any;
    await svc.propose('t1', farmer, 'idem-5', dto);
    expect(idem.remember).toHaveBeenCalledWith('idem-5', 'u1', 'insurance.policy.propose', expect.any(Function));
  });
});

describe('cancel — withdraw/surrender (screen 287 "Cancelled" example)', () => {
  it('owner can cancel their own proposed policy', async () => {
    const { svc, repo } = harness();
    const policy = InsurancePolicy.rehydrate({ id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: null, subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100000n, premiumMinor: 2000n, premiumPaymentId: null, status: 'proposed', validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null });
    (repo.getForUpdate as jest.Mock).mockResolvedValue(policy);
    const out = await svc.cancel('t1', farmer, 'idem-c1', 'p1');
    expect(out.status).toBe('cancelled');
    expect(repo.update).toHaveBeenCalledTimes(1);
  });
  it('a non-owner non-manager cannot cancel someone else\'s policy', async () => {
    const { svc, repo } = harness();
    const policy = InsurancePolicy.rehydrate({ id: 'p1', tenantId: 't1', holderUserId: 'someone-else', productId: 'pr1', policyNo: null, subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100000n, premiumMinor: 2000n, premiumPaymentId: null, status: 'proposed', validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null });
    (repo.getForUpdate as jest.Mock).mockResolvedValue(policy);
    await expect(svc.cancel('t1', farmer, 'idem-c2', 'p1')).rejects.toBeInstanceOf(InsuranceForbiddenError);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('initiatePremiumPayment — DEV-23 (KV-BL-053, screen 288)', () => {
  const proposedPolicy = () => InsurancePolicy.rehydrate({ id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: null, subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100000n, premiumMinor: 200000n, premiumPaymentId: null, status: 'proposed', validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null });

  it('creates a payments-module intent for a proposed policy using the POLICY\'S OWN server-side premium (never client-supplied)', async () => {
    const { svc, repo, payments } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(proposedPolicy());
    const out = await svc.initiatePremiumPayment('t1', farmer, 'idem-pp1', 'p1');
    expect(out.paymentId).toBe('pay-1');
    expect(payments.createIntent).toHaveBeenCalledWith('t1', 'u1', expect.any(String), expect.objectContaining({
      purpose: 'insurance_premium', amountMinor: '200000', currencyCode: 'INR',
      referenceType: 'insurance_policy', referenceId: 'p1',
    }));
  });
  it('refuses to initiate premium collection for a policy that is not "proposed" (e.g. already active)', async () => {
    const { svc, repo, payments } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(InsurancePolicy.rehydrate({ ...proposedPolicy().toProps(), status: 'active' }));
    await expect(svc.initiatePremiumPayment('t1', farmer, 'idem-pp2', 'p1')).rejects.toBeInstanceOf(PolicyNotAwaitingPremiumError);
    expect(payments.createIntent).not.toHaveBeenCalled();
  });
  it('a non-owner non-manager gets 404 (anti-IDOR), never reaches the payments module', async () => {
    const { svc, repo, payments } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(InsurancePolicy.rehydrate({ ...proposedPolicy().toProps(), holderUserId: 'someone-else' }));
    await expect(svc.initiatePremiumPayment('t1', farmer, 'idem-pp3', 'p1')).rejects.toBeInstanceOf(InsurancePolicyNotFoundError);
    expect(payments.createIntent).not.toHaveBeenCalled();
  });
  it('is idempotent: the remember() wrapper is exercised on the caller key', async () => {
    const { svc, repo, idem } = harness();
    (repo.getById as jest.Mock).mockResolvedValue(proposedPolicy());
    await svc.initiatePremiumPayment('t1', farmer, 'idem-pp4', 'p1');
    expect(idem.remember).toHaveBeenCalledWith('idem-pp4', 'u1', 'insurance.policy.initiate_premium_payment', expect.any(Function));
  });
});
