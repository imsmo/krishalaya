// modules/reviews/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// Every review / eligibility read/write binds tenant_id (Law 1). No version column → mutations lock
// the row FOR UPDATE; the public list reads only published; lists are keyset (never OFFSET); the
// (order,reviewer,target) and one-per-order uniqueness use ON CONFLICT.
import { ReviewRepository } from '../repositories/review.repository';
import { Review } from '../domain/review.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const repo = () => new ReviewRepository(fakeReplica().provider);

describe('reviews tenant isolation (SQL contract)', () => {
  it('getForUpdate binds tenant_id + row-locks (no version → FOR UPDATE)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await repo().getForUpdate(tx as any, 'tenantA', 'rv1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/id=\$1 AND tenant_id=\$2/); expect(sql).toMatch(/FOR UPDATE/);
    expect(params).toEqual(['rv1', 'tenantA']);
  });

  it('insert binds tenant_id, guards duplicates with ON CONFLICT, no version', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const rv = Review.submit({ id: 'rv1', tenantId: 'tenantA', orderId: 'o1', reviewerUserId: 'b1', targetType: 'seller', targetId: 's1', stars: 5 });
    await repo().insert(tx as any, rv);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO reviews/);
    expect(sql).toMatch(/ON CONFLICT \(order_id, reviewer_user_id, target_type, target_id\) DO NOTHING/);
    expect(sql).not.toMatch(/version/); expect(params).toContain('tenantA');
  });

  it('update is tenant-scoped with NO version clause', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    const rv = Review.submit({ id: 'rv1', tenantId: 'tenantA', orderId: 'o1', reviewerUserId: 'b1', targetType: 'seller', targetId: 's1', stars: 5 });
    await repo().update(tx as any, rv);
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/); expect(sql).not.toMatch(/version/);
    expect(params[1]).toBe('tenantA');
  });

  it('eligibility insert binds tenant_id + ON CONFLICT(order_id)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await repo().insertEligibility(tx as any, 'tenantA', 'o1', 'b1', 's1');
    // PC-56 STORE-5a · B3: the first statement reads the window settings on the SAME (relay) transaction; the insert stamps expires_at from them
    expect(tx.query.mock.calls[0][0]).toMatch(/kv_platform_setting\('reviews\.invite_window_days'\)/);
    const [sql, params] = tx.query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO review_eligibility/);
    expect(sql).toMatch(/ON CONFLICT \(order_id\) DO NOTHING/);
    expect(sql).toMatch(/expires_at\)\s+VALUES \(\$1,\$2,\$3,\$4, now\(\) \+ make_interval\(days => \$5::int\)\)/);
    expect(params).toEqual(['tenantA', 'o1', 'b1', 's1', 30]);   // the setting is absent in this fake → the named fallback (30)
  });

  it('public listForTarget binds tenant_id, filters to published, keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new ReviewRepository(provider).listForTarget('tenantA', 'seller', 's1', { limit: 20 });
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND target_type=\$2 AND target_id=\$3 AND status='published'/);
    expect(sql).toMatch(/ORDER BY created_at DESC, id DESC/); expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tenantA', 'seller', 's1', 20]);
  });

  it('summaryForTarget binds tenant_id + published only', async () => {
    const { provider, exec } = fakeReplica();
    await new ReviewRepository(provider).summaryForTarget('tenantA', 'seller', 's1');
    const [sql, params] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1 AND target_type=\$2 AND target_id=\$3 AND status='published'/);
    expect(params).toEqual(['tenantA', 'seller', 's1']);
  });
});
