// modules/requirements/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// Every requirement/response read/write binds tenant_id (Law 1). No version columns → mutations lock
// the row FOR UPDATE; lists are keyset (never OFFSET); the expiry finders are bounded + SKIP LOCKED.
import { RequirementRepository } from '../repositories/requirement.repository';
import { RequirementResponseRepository } from '../repositories/requirement-response.repository';
import { Requirement } from '../domain/requirement.entity';
import { RequirementResponse } from '../domain/requirement-response.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const reqRepo = () => new RequirementRepository(fakeReplica().provider);
const respRepo = () => new RequirementResponseRepository(fakeReplica().provider);

describe('requirements tenant isolation (SQL contract)', () => {
  it('requirement.getForUpdate binds tenant_id + row-locks (no version → FOR UPDATE)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await reqRepo().getForUpdate(tx as any, 'tenantA', 'r1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['r1', 'tenantA']);
  });
  it('requirement.update is tenant-scoped with NO version clause', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const r = Requirement.post({ id: 'r1', tenantId: 'tenantA', buyerUserId: 'b1', title: 'x', quantity: '5', unitCode: 'quintal' });
    await reqRepo().update(tx as any, r);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/); expect(sql).not.toMatch(/version/);
    expect(params[1]).toBe('tenantA');
  });
  it('requirement.list (box=open) is keyset (no OFFSET), tenant-scoped, honours status, and its µs cursor is compared as timestamptz', async () => {
    const { provider, exec } = fakeReplica();
    await new RequirementRepository(provider).list('tenantA', { box: 'open', status: 'partially_matched', cursor: { kind: 'created', c: '2026-07-11 10:00:00.123456+05:30', id: '00000000-0000-4000-8000-000000000001' }, limit: 20 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND deleted_at IS NULL AND status IN \('open','partially_matched'\) AND status=\$2/);
    expect(sql).toMatch(/created_at < \$3::timestamptz OR \(created_at = \$3::timestamptz AND id < \$4::uuid\)/);
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/); expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tenantA', 'partially_matched', '2026-07-11 10:00:00.123456+05:30', '00000000-0000-4000-8000-000000000001', 20]);
  });
  it('requirement.list (sort=need_by) is the need-by ascending keyset, no need-by last', async () => {
    const { provider, exec } = fakeReplica();
    await new RequirementRepository(provider).list('tenantA', { box: 'all', sort: 'need_by', cursor: { kind: 'need_by', c: '2026-07-16', id: '00000000-0000-4000-8000-000000000001' }, limit: 5 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY COALESCE\(need_by, 'infinity'::date\) ASC, id ASC/);
    expect(sql).toMatch(/COALESCE\(need_by, 'infinity'::date\) > \$2::date/);
  });
  it('requirement.dueToExpire claims per tenant (kv_app), bounded, on the India day', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await reqRepo().dueToExpire(tx as any, 'tenantA', new Date(), 100);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND status IN \('open','partially_matched'\) AND need_by IS NOT NULL/);
    expect(sql).toMatch(/AT TIME ZONE 'Asia\/Kolkata'/); expect(sql).toMatch(/LIMIT \$3/);
    expect(params[0]).toBe('tenantA');
  });

  it('response.getForUpdate binds tenant_id + FOR UPDATE', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await respRepo().getForUpdate(tx as any, 'tenantA', 'q1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/r.id=\$1 AND r.tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['q1', 'tenantA']);
  });
  it('response.insert binds tenant_id + ON CONFLICT (uniqueness guard), no version', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const r = RequirementResponse.submit({ id: 'q1', requirementId: 'r1', tenantId: 'tenantA', sellerUserId: 's1', listingId: 'l1', quotedPriceMinor: 1000n, quantity: '1' });
    await respRepo().insert(tx as any, r);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO requirement_responses/); expect(sql).toMatch(/ON CONFLICT \(requirement_id, seller_user_id\) DO NOTHING/);
    expect(sql).not.toMatch(/version/); expect(params).toContain('tenantA');
  });
  it('response.listForRequirement binds tenant_id + requirement_id, keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new RequirementResponseRepository(provider).listForRequirement('tenantA', 'r1', { limit: 50 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/r.tenant_id=\$1 AND r.requirement_id=\$2/); expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tenantA', 'r1', 50]);
  });
  it('response.dueToExpire claims per tenant over submitted|shortlisted, bounded', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await respRepo().dueToExpire(tx as any, 'tenantA', new Date(), 100);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND status IN \('submitted','shortlisted'\) AND valid_until IS NOT NULL AND valid_until < \$2/);
    expect(params[0]).toBe('tenantA');
  });
  it('F-27c · a seller\'s own view is filtered IN SQL, before LIMIT', async () => {
    const { provider, exec } = fakeReplica();
    await new RequirementResponseRepository(provider).listForRequirement('tenantA', 'r1', { sellerUserId: 's1', limit: 20 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/r\.seller_user_id=\$3/); expect(sql.indexOf('seller_user_id=$3')).toBeLessThan(sql.indexOf('LIMIT'));
    expect(params).toEqual(['tenantA', 'r1', 's1', 20]);
  });
});
