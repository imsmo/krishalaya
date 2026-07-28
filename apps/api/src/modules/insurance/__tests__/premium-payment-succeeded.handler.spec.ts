// modules/insurance/__tests__/premium-payment-succeeded.handler.spec.ts · the TRUST-CRITICAL assertion:
// a policy NEVER goes proposed->active without a payment this handler itself re-verified matches the
// policy's own premiumMinor. Fakes only (no DB) — the outbox relay's real at-least-once delivery + tx
// semantics are exercised by core/outbox/__tests__/outbox-dispatcher.spec.ts, not re-proven per module
// (same convention DEV-22 QA confirmed for the idempotency wrapper).
import { PremiumPaymentSucceededHandler } from '../events/handlers/premium-payment-succeeded.handler';
import { InsurancePolicy } from '../domain/insurance-policy.entity';
import { InsurancePremiumAmountMismatchError } from '../domain/insurance.errors';

function proposedPolicy(overrides: Partial<Parameters<typeof InsurancePolicy.rehydrate>[0]> = {}) {
  return InsurancePolicy.rehydrate({
    id: 'p1', tenantId: 't1', holderUserId: 'u1', productId: 'pr1', policyNo: null,
    subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100_000_00n, premiumMinor: 2_000_00n,
    premiumPaymentId: null, status: 'proposed', validFrom: '2026-06-15', validUntil: '2026-11-30',
    parametricTriggers: null, ...overrides,
  });
}

function harness() {
  const outbox = { write: jest.fn() };
  const repo = { getForUpdate: jest.fn(), update: jest.fn() };
  const audit = { write: jest.fn() };
  const handler = new PremiumPaymentSucceededHandler(outbox as any, repo as any, audit as any);
  return { handler, outbox, repo, audit };
}
const tx = {} as any;
const baseEvent = (payload: Record<string, unknown>) => ({ id: '1', tenantId: 't1', aggregateType: 'payment', aggregateId: 'pay-1', eventType: 'payments.payment_succeeded', payload });

describe('PremiumPaymentSucceededHandler', () => {
  it('ignores events whose referenceType is not insurance_policy (e.g. an order payment)', async () => {
    const { handler, repo } = harness();
    await handler.handle(baseEvent({ referenceType: 'order', referenceId: 'o1', amountMinor: '200000' }), tx);
    expect(repo.getForUpdate).not.toHaveBeenCalled();
  });
  it('activates a proposed policy when the captured amount matches the policy\'s premium exactly', async () => {
    const { handler, repo, outbox, audit } = harness();
    const policy = proposedPolicy();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(policy);
    await handler.handle(baseEvent({ referenceType: 'insurance_policy', referenceId: 'p1', amountMinor: '200000', paymentId: 'pay-1' }), tx);
    expect(policy.status).toBe('active');
    expect(policy.toProps().premiumPaymentId).toBe('pay-1');
    expect(repo.update).toHaveBeenCalledWith(tx, policy);
    expect(outbox.write).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'insurance.policy.activated' }));
  });
  it('THE TRUST-CRITICAL GUARD: throws (never activates) when the captured amount does NOT match the policy premium', async () => {
    const { handler, repo } = harness();
    const policy = proposedPolicy();
    (repo.getForUpdate as jest.Mock).mockResolvedValue(policy);
    await expect(handler.handle(baseEvent({ referenceType: 'insurance_policy', referenceId: 'p1', amountMinor: '1', paymentId: 'pay-1' }), tx))
      .rejects.toBeInstanceOf(InsurancePremiumAmountMismatchError);
    expect(policy.status).toBe('proposed'); // never silently activated on a wrong amount
    expect(repo.update).not.toHaveBeenCalled();
  });
  it('is idempotent: a repeat delivery for an ALREADY-active policy is a no-op (relay re-delivery safety)', async () => {
    const { handler, repo } = harness();
    const policy = proposedPolicy({ status: 'active', premiumPaymentId: 'pay-1' } as any);
    (repo.getForUpdate as jest.Mock).mockResolvedValue(policy);
    await handler.handle(baseEvent({ referenceType: 'insurance_policy', referenceId: 'p1', amountMinor: '999999999', paymentId: 'pay-2' }), tx);
    expect(repo.update).not.toHaveBeenCalled(); // status !== 'proposed' -> early return, no mismatch check even attempted
  });
  it('ignores an event for a policy that does not exist / belongs to another tenant (unknown/foreign)', async () => {
    const { handler, repo } = harness();
    (repo.getForUpdate as jest.Mock).mockRejectedValue(new Error('not found'));
    await expect(handler.handle(baseEvent({ referenceType: 'insurance_policy', referenceId: 'unknown', amountMinor: '200000' }), tx)).resolves.toBeUndefined();
  });
});
