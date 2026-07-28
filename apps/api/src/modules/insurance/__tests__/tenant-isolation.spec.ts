// modules/insurance/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate, Law 1).
// insurance_policies binds tenant_id in every query; no version column → mutations lock FOR UPDATE. Lists are
// keyset (never OFFSET). insurance_products is GLOBAL reference data (no tenant_id predicate on its own rows).
// Mirrors modules/fintech/__tests__/tenant-isolation.spec.ts exactly (same convention, same table family).
// DEV-23 extends this file with InsuranceClaimRepository (same table family, same conventions).
import { InsurancePolicyRepository } from '../repositories/insurance-policy.repository';
import { InsuranceProductRepository } from '../repositories/insurance-product.repository';
import { InsuranceClaimRepository } from '../repositories/insurance-claim.repository';
import { InsuranceClaim } from '../domain/insurance-claim.entity';
import { InsurancePolicy } from '../domain/insurance-policy.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }

describe('insurance_policies isolation', () => {
  it('getForUpdate binds id+tenant_id AND locks FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'p1', tenant_id: 'tA', holder_user_id: 'u1', product_id: 'pr1', policy_no: null, subject_type: 'crop_season', subject_id: 'plot1', sum_insured_minor: '100000', premium_minor: '2000', premium_payment_id: null, status: 'proposed', valid_from: '2026-06-15', valid_until: '2026-11-30', parametric_triggers: null, created_at: new Date() }], rowCount: 1 }) };
    await new InsurancePolicyRepository(fakeReplica().provider).getForUpdate(tx as any, 'tA', 'p1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['p1', 'tA']);
  });
  it('insert binds tenant_id from the aggregate (never a client-supplied bare value)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const p = InsurancePolicy.propose({ id: 'p1', tenantId: 'tA', holderUserId: 'u1', productId: 'pr1', policyNo: null, subjectType: 'crop_season', subjectId: 'plot1', sumInsuredMinor: 100000n, premiumMinor: 2000n, premiumPaymentId: null, validFrom: '2026-06-15', validUntil: '2026-11-30', parametricTriggers: null });
    await new InsurancePolicyRepository(fakeReplica().provider).insert(tx as any, p);
    expect(tx.query.mock.calls[0][1]).toContain('tA');
  });
  it('listFor is keyset (never OFFSET), scoped to tenant_id + optional holder', async () => {
    const { provider, exec } = fakeReplica();
    await new InsurancePolicyRepository(provider).listFor('tA', { holderUserId: 'u1', limit: 50 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/holder_user_id=\$2/);
    expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tA', 'u1', 50]);
  });
});

describe('insurance_products — GLOBAL reference data (no tenant_id predicate on its own rows)', () => {
  it('list() queries without a tenant_id predicate, keyset by id', async () => {
    const { provider, exec } = fakeReplica();
    await new InsuranceProductRepository(provider).list('tA', { activeOnly: true, afterId: null, limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).not.toMatch(/tenant_id/);
    expect(sql).not.toMatch(/OFFSET/i);
    expect(sql).toMatch(/ORDER BY id ASC/);
  });
});

describe('insurance_claims isolation — DEV-23 (KV-BL-054)', () => {
  it('getForUpdate binds id+tenant_id AND locks FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'c1', tenant_id: 'tA', policy_id: 'p1', claimant_user_id: 'u1', event_date: '2026-06-30', event_type_id: 'evt1', description: null, status: 'intimated', intimated_within_72h: true, surveyor_user_id: null, survey_report: null, approved_minor: null, payout_id: null, closed_at: null, created_at: new Date() }], rowCount: 1 }) };
    await new InsuranceClaimRepository(fakeReplica().provider).getForUpdate(tx as any, 'tA', 'c1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['c1', 'tA']);
  });
  it('insert binds tenant_id from the aggregate (never a client-supplied bare value)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const claim = InsuranceClaim.file({ id: 'c1', tenantId: 'tA', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt1', description: null });
    await new InsuranceClaimRepository(fakeReplica().provider).insert(tx as any, claim);
    expect(tx.query.mock.calls[0][1]).toContain('tA');
  });
  it('update binds id+tenant_id in its WHERE clause (no cross-tenant write possible)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const claim = InsuranceClaim.file({ id: 'c1', tenantId: 'tA', policyId: 'p1', claimantUserId: 'u1', eventDate: '2026-06-30', eventTypeId: 'evt1', description: null });
    await new InsuranceClaimRepository(fakeReplica().provider).update(tx as any, claim);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/);
    expect(params).toEqual(['c1', 'tA', 'intimated', null, null, null, null, null]);
  });
  it('listFor is keyset (never OFFSET), scoped to tenant_id + optional claimant/policy/status', async () => {
    const { provider, exec } = fakeReplica();
    await new InsuranceClaimRepository(provider).listFor('tA', { claimantUserId: 'u1', limit: 50 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/claimant_user_id=\$2/);
    expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tA', 'u1', 50]);
  });
  it('resolveEventTypeId reads the GLOBAL claim_event lookup vocabulary (no tenant_id column on that row)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'evt1' }] }) };
    await new InsuranceClaimRepository(fakeReplica().provider).resolveEventTypeId(tx as any, 'flood');
    const [sql] = tx.query.mock.calls[0];
    expect(sql).toMatch(/type_code='claim_event'/); expect(sql).toMatch(/tenant_id IS NULL/);
  });
});
