// modules/ambassadors/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// profiles/earnings/referrals bind tenant_id; lists are keyset (never OFFSET); mutations lock FOR UPDATE;
// commission plans resolve tenant-override-then-platform; earnings updates bind (id, created_at) for partition
// pruning; the accrual idempotency guard is reference-scoped. (TENANT-10a: the created_at bound is the RAW text.)
import { AmbassadorProfileRepository } from '../repositories/ambassador-profile.repository';
import { CommissionPlanRepository } from '../repositories/commission-plan.repository';
import { AmbassadorEarningRepository } from '../repositories/ambassador-earning.repository';
import { ReferralRepository } from '../repositories/referral.repository';
import { AmbassadorProfile } from '../domain/ambassador-profile.entity';
import { AmbassadorEarning } from '../domain/ambassador-earning.entity';
import { Referral } from '../domain/referral.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const profile = () => AmbassadorProfile.enroll({ id: 'a1', userId: 'u1', tenantId: 'tenantA', clusterRegionIds: [], tierId: null, mentorAmbassadorId: null, trainingCompletedAt: null, kioskEnabled: false, aepsEnabled: false, monthlyStipendMinor: 0n });

describe('ambassador_profiles isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; findByUser binds user_id+tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AmbassadorProfileRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'a1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const { provider, exec } = fakeReplica();
    await new AmbassadorProfileRepository(provider).findByUser('tenantA', 'u1');
    expect(exec.query.mock.calls[0][0]).toMatch(/user_id=\$1 AND tenant_id=\$2/);
  });
  it('list keyset (no OFFSET); insert binds tenant_id', async () => {
    const { provider, exec } = fakeReplica();
    await new AmbassadorProfileRepository(provider).listFor('tenantA', { limit: 50 });
    expect(exec.query.mock.calls[0][0]).toMatch(/ORDER BY created_at DESC, id DESC/); expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new AmbassadorProfileRepository(fakeReplica().provider).insert(tx as any, profile());
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO ambassador_profiles/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
  });
});

describe('commission plan resolution', () => {
  it('resolveEffective prefers tenant then platform, within the effective window', async () => {
    const { provider, exec } = fakeReplica();
    await new CommissionPlanRepository(provider).resolveEffective('tenantA', 'first_sale_facilitated');
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$2 OR tenant_id IS NULL/); expect(sql).toMatch(/ORDER BY tenant_id NULLS LAST/);
    expect(sql).toMatch(/effective_from <= CURRENT_DATE/); expect(params).toEqual(['first_sale_facilitated', 'tenantA']);
  });
});

describe('ambassador_earnings isolation', () => {
  it('insert binds tenant_id; existsFor is (ambassador,event,reference)-scoped; list keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const e = AmbassadorEarning.accrue({ id: 'e1', tenantId: 'tenantA', ambassadorId: 'a1', planId: 'p1', eventCode: 'x', referenceType: 'order', referenceId: 'o1', amountMinor: 100n });
    await new AmbassadorEarningRepository(fakeReplica().provider).insert(tx as any, e);
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO ambassador_earnings/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AmbassadorEarningRepository(fakeReplica().provider).existsFor(tx2 as any, 'a1', 'first_sale_facilitated', 'o1');
    expect(tx2.query.mock.calls[0][0]).toMatch(/ambassador_id=\$1 AND event_code=\$2 AND reference_id IS NOT DISTINCT FROM \$3/);
    const { provider, exec } = fakeReplica();
    await new AmbassadorEarningRepository(provider).listForAmbassador('tenantA', 'a1', { limit: 50 });
    expect(exec.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND ambassador_id=\$2/); expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
  // PC-56 TENANT-10a · F-1: the stamp binds (id, created_at::timestamptz from the RAW microsecond text) + tenant + payout_id IS
  // NULL in ONE statement and RETURNS the count it stamped (the service throws on a mismatch). A JS Date never reaches it.
  it('markPaid binds (id, raw created_at) for partition pruning + tenant + guards payout_id IS NULL; returns the stamped count', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const n = await new AmbassadorEarningRepository(fakeReplica().provider).markPaid(tx as any, 'tenantA', [{ id: 'e1', createdAtRaw: '2026-10-02 10:00:00.123456+05:30' }], 'pay1');
    expect(n).toBe(1);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/e\.tenant_id = \$1 AND e\.id = k\.id AND e\.created_at = k\.created_at_raw::timestamptz AND e\.payout_id IS NULL/);
    expect(params).toEqual(['tenantA', ['e1'], ['2026-10-02 10:00:00.123456+05:30'], 'pay1']);
    expect(params.some((p: unknown) => p instanceof Date)).toBe(false);
  });
  it('lockUnpaid and every list select created_at::text (the microsecond-exact cursor / stamp source)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AmbassadorEarningRepository(fakeReplica().provider).lockUnpaid(tx as any, 'tenantA', 'a1');
    expect(tx.query.mock.calls[0][0]).toMatch(/created_at::text AS created_at_raw/);
    const { provider, exec } = fakeReplica();
    await new AmbassadorEarningRepository(provider).listForAmbassador('tenantA', 'a1', { limit: 1, cursor: { c: '2026-10-02 10:00:00.123456+05:30', id: '01a0c000-0000-7000-8000-0000000000a1' } });
    expect(exec.query.mock.calls[0][0]).toMatch(/created_at < \$3::timestamptz OR \(created_at = \$3::timestamptz AND id < \$4::uuid\)/);
  });
  it('lockUnpaid uses FOR UPDATE SKIP LOCKED', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new AmbassadorEarningRepository(fakeReplica().provider).lockUnpaid(tx as any, 'tenantA', 'a1');
    expect(tx.query.mock.calls[0][0]).toMatch(/payout_id IS NULL/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE SKIP LOCKED/);
  });
});

describe('referrals isolation', () => {
  it('findByCode binds tenant_id + FOR UPDATE; insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new ReferralRepository(fakeReplica().provider).findByCode(tx as any, 'tenantA', 'CODE12');
    expect(tx.query.mock.calls[0][0]).toMatch(/tenant_id=\$1 AND code=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const r = Referral.create({ id: 'r1', tenantId: 'tenantA', referrerUserId: 'u1', refereeUserId: null, code: 'CODE12', rewardRule: {} });
    await new ReferralRepository(fakeReplica().provider).insert(tx2 as any, r);
    expect(tx2.query.mock.calls[0][0]).toMatch(/INSERT INTO referrals/); expect(tx2.query.mock.calls[0][1]).toContain('tenantA');
  });
});
