// modules/insurance/__tests__/pmfby-policy-sync.handler.spec.ts · DEV-25/KV-BL-057 integration-point test:
// PMFBY sync fires ONLY for a crop_season policy proposal AND ONLY when `pmfby_sync` is ON — every other
// case is a SILENT skip (never an error, never a DLQ entry), matching the honesty/kill-switch convention.
import { PmfbyPolicySyncHandler } from '../events/handlers/pmfby-policy-sync.handler';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { InsuranceProduct } from '../domain/insurance-product.entity';

function cropPolicy() {
  return InsurancePolicy.rehydrate({
    id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: null,
    subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100_000_00n, premiumMinor: 2_000_00n,
    premiumPaymentId: null, status: 'proposed', validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null,
  });
}
const cropProduct = InsuranceProduct.rehydrate({
  id: 'pr1', partnerId: 'partner-1', productKindId: 'kind-pmfby', defaultName: 'PMFBY Groundnut',
  premiumCalcRaw: { kind: 'pct_of_sum_insured', bps: 1200 }, sumInsuredRules: {},
  govtSubsidyBps: 8333, ourCommissionBps: 0, isParametric: false, isActive: true,
});

function harness(flagOn: boolean) {
  const pmfby = { submitEnrolment: jest.fn(async () => ({ status: 'submitted', govtApplicationRef: 'ref-1' })) };
  const flags = { isEnabled: jest.fn(async () => flagOn) };
  const audit = { write: jest.fn() };
  const policies = { getById: jest.fn(async () => cropPolicy()) };
  const products = { getById: jest.fn(async () => cropProduct), resolveInsuranceKindCode: jest.fn(async () => 'pmfby') };
  const handler = new PmfbyPolicySyncHandler(pmfby as any, flags as any, audit as any, policies as any, products as any);
  return { handler, pmfby, flags, audit, policies, products };
}
const tx = {} as any;
const baseEvent = (payload: Record<string, unknown>) => ({ id: '1', tenantId: 't1', aggregateType: 'insurance_policy', aggregateId: 'p1', eventType: 'insurance.policy_proposed', payload });

describe('PmfbyPolicySyncHandler', () => {
  it('SILENT-SKIPS when subjectType !== crop_season (e.g. animal) — never calls the provider', async () => {
    const { handler, pmfby } = harness(true);
    await handler.handle(baseEvent({ policyId: 'p1', subjectType: 'animal', holderUserId: 'u1', productId: 'pr1', sumInsuredMinor: '10000000', premiumMinor: '200000' }), tx);
    expect(pmfby.submitEnrolment).not.toHaveBeenCalled();
  });
  it('SILENT-SKIPS when `pmfby_sync` flag is OFF — never calls the provider (kill-switch, default OFF, §8)', async () => {
    const { handler, pmfby, flags } = harness(false);
    await handler.handle(baseEvent({ policyId: 'p1', subjectType: 'crop_season', holderUserId: 'u1', productId: 'pr1', sumInsuredMinor: '10000000', premiumMinor: '200000' }), tx);
    expect(flags.isEnabled).toHaveBeenCalledWith('pmfby_sync', { tenantId: 't1' });
    expect(pmfby.submitEnrolment).not.toHaveBeenCalled();
  });
  it('flag ON + crop_season: calls the PMFBY port with the resolved product code, then records the result via audit ONLY', async () => {
    const { handler, pmfby, audit, products } = harness(true);
    await handler.handle(baseEvent({ policyId: 'p1', subjectType: 'crop_season', holderUserId: 'u1', productId: 'pr1', sumInsuredMinor: '10000000', premiumMinor: '200000' }), tx);
    expect(pmfby.submitEnrolment).toHaveBeenCalledWith(expect.objectContaining({ policyId: 'p1', tenantId: 't1', productCode: 'pmfby', holderUserId: 'u1' }));
    expect(products.resolveInsuranceKindCode).toHaveBeenCalledWith(tx, 'kind-pmfby');
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'insurance.policy.pmfby_sync_attempted', entityId: 'p1', newValue: expect.objectContaining({ status: 'submitted', govtApplicationRef: 'ref-1' }) }));
  });
  it('never throws on an unavailable provider result (a hung/unreachable govt portal must never fail the outbox event)', async () => {
    const { handler, pmfby, audit } = harness(true);
    (pmfby.submitEnrolment as jest.Mock).mockResolvedValue({ status: 'unavailable', failureReason: 'pmfby_portal_not_configured' });
    await expect(handler.handle(baseEvent({ policyId: 'p1', subjectType: 'crop_season', holderUserId: 'u1', productId: 'pr1', sumInsuredMinor: '10000000', premiumMinor: '200000' }), tx)).resolves.toBeUndefined();
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ newValue: expect.objectContaining({ status: 'unavailable', failureReason: 'pmfby_portal_not_configured' }) }));
  });
  it('returns quietly when the policy is gone/not ours (repo returns null)', async () => {
    const { handler, pmfby, policies } = harness(true);
    (policies.getById as jest.Mock).mockResolvedValue(null);
    await handler.handle(baseEvent({ policyId: 'p1', subjectType: 'crop_season' }), tx);
    expect(pmfby.submitEnrolment).not.toHaveBeenCalled();
  });
});
