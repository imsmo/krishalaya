// modules/dairy/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// Every MCC/membership/rate-card/collection/bill read+write binds tenant_id (Law 1). No version columns →
// mutations lock FOR UPDATE. Lists are keyset (never OFFSET). milk_collections queries carry collected_on
// so PG prunes partitions (Law 8). The cross-tenant cycle finder is bounded.
import { MccCentreRepository } from '../repositories/mcc-centre.repository';
import { DairyMembershipRepository } from '../repositories/dairy-membership.repository';
import { MilkRateCardRepository } from '../repositories/milk-rate-card.repository';
import { MilkCollectionRepository } from '../repositories/milk-collection.repository';
import { MilkBillRepository } from '../repositories/milk-bill.repository';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }

describe('mcc_centres / dairy_memberships isolation', () => {
  it('mcc.getForUpdate binds tenant_id + FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MccCentreRepository(fakeReplica().provider).getForUpdate(tx as any, 'tA', 'm1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/); expect(params).toEqual(['m1', 'tA']);
  });
  it('membership.listFor keyset (no OFFSET), tenant-bound', async () => {
    const { provider, exec } = fakeReplica();
    await new DairyMembershipRepository(provider).listFor('tA', { limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/); expect(sql).not.toMatch(/OFFSET/i);
  });
});

describe('milk_rate_cards isolation', () => {
  it('resolveActive binds tenant_id + animal type + effective-dated window', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkRateCardRepository(fakeReplica().provider).resolveActive('tA', 'cow', '2026-06-15', tx as any);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND animal_type=\$2 AND is_active=true/);
    expect(sql).toMatch(/effective_from <= \$3::date AND \(effective_to IS NULL OR effective_to >= \$3::date\)/);
    expect(params).toEqual(['tA', 'cow', '2026-06-15']);
  });
});

describe('milk_collections isolation + partition pruning', () => {
  it('aggregateUnbilledForUpdate binds tenant + membership + DATE RANGE (prunes partitions) + FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkCollectionRepository(fakeReplica().provider).aggregateUnbilledForUpdate(tx as any, 'tA', 'mem1', '2026-06-01', '2026-06-07');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND membership_id=\$2 AND collected_on >= \$3::date AND collected_on <= \$4::date AND milk_bill_id IS NULL/);
    expect(sql).toMatch(/FOR UPDATE/); expect(params).toEqual(['tA', 'mem1', '2026-06-01', '2026-06-07']);
  });
  it('listFor carries collected_on range (partition prune) + no OFFSET', async () => {
    const { provider, exec } = fakeReplica();
    await new MilkCollectionRepository(provider).listFor('tA', { membershipId: 'mem1', from: '2026-06-01', to: '2026-06-30', limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/collected_on >= \$3::date AND collected_on <= \$4::date/); expect(sql).not.toMatch(/OFFSET/i);
  });
  it('membershipsToBillForCycle is tenant-scoped, cycle-scoped AND bounded', async () => {
    // [PC-56 TENANT-6c-1] The predecessor `findMembershipsToBill` was bounded and NOTHING ELSE: no tenant predicate
    // and no payment-cycle predicate, so the (never-registered) cycle job would have swept every tenant's unbilled
    // pours into one caller-chosen window and billed a monthly member on a fortnightly boundary. All three bounds are
    // asserted here because the LIMIT was the only one that ever existed.
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkCollectionRepository(fakeReplica().provider)
      .membershipsToBillForCycle(tx as any, 'tA', 'fortnightly', '2026-07-01', '2026-07-15', 500);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/c\.tenant_id=\$1/);
    expect(sql).toMatch(/m\.payment_cycle=\$4/);
    expect(sql).toMatch(/milk_bill_id IS NULL/);
    expect(sql).toMatch(/LIMIT \$5/);
    expect(params).toEqual(['tA', '2026-07-01', '2026-07-15', 'fortnightly', 500]);
  });
});

describe('milk_bills isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; listFor keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new MilkBillRepository(fakeReplica().provider).getForUpdate(tx as any, 'tA', 'b1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/); expect(params).toEqual(['b1', 'tA']);
    const { provider, exec } = fakeReplica();
    await new MilkBillRepository(provider).listFor('tA', { limit: 50 });
    expect(exec.query.mock.calls[0][0]).not.toMatch(/OFFSET/i);
  });
});
