// modules/cms/__tests__/tenant-isolation.spec.ts · tenant-scoping SQL contract (CI gate).
// pages bind (tenant_id OR NULL platform) + lock FOR UPDATE; publishedBySlug serves published only; banners
// bind tenant_id, the live list bounds on is_active + window, click increments atomically; keyset (no OFFSET).
import { CmsPageRepository } from '../repositories/cms-page.repository';
import { BannerRepository } from '../repositories/banner.repository';
import { CmsPage } from '../domain/cms-page.entity';
import { Banner } from '../domain/banner.entity';

function fakeReplica() { const exec = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) }; return { provider: { forTenant: () => exec } as any, exec }; }
const page = () => CmsPage.create({ id: 'p1', tenantId: 'tenantA', slug: 'privacy-policy', pageKind: 'policy', defaultTitle: 'P', body: 'b', version: 1 });
const banner = () => Banner.create({ id: 'b1', tenantId: 'tenantA', placement: 'home_hero', mediaId: 'm1', languageCode: 'en', targetUrl: null, audienceRules: {}, startsAt: new Date(), endsAt: new Date(Date.now() + 86400000) });

describe('cms_pages isolation', () => {
  it('getForUpdate binds tenant_id + FOR UPDATE; insert binds tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
    await new CmsPageRepository(fakeReplica().provider).getForUpdate(tx as any, 'tenantA', 'p1');
    expect(tx.query.mock.calls[0][0]).toMatch(/id=\$1 AND tenant_id=\$2/); expect(tx.query.mock.calls[0][0]).toMatch(/FOR UPDATE/);
    const tx2 = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new CmsPageRepository(fakeReplica().provider).insert(tx2 as any, page(), 'tenantA', 'u1');
    expect(tx2.query.mock.calls[0][0]).toMatch(/INSERT INTO cms_pages/); expect(tx2.query.mock.calls[0][1]).toContain('tenantA');
  });
  it('publishedBySlug scopes to tenant OR platform, published-only, and the TENANT row wins (F-14); index is keyset (no OFFSET)', async () => {
    const { provider, exec } = fakeReplica();
    await new CmsPageRepository(provider).publishedBySlug('tenantA', 'privacy-policy');
    expect(exec.query.mock.calls[0][0]).toMatch(/\(tenant_id=\$1 OR tenant_id IS NULL\)/); expect(exec.query.mock.calls[0][0]).toMatch(/status='published'/);
    // PC-56 TENANT-8c: ranked by version alone, a platform v5 shadowed the tenant's own v1.
    expect(exec.query.mock.calls[0][0]).toMatch(/ORDER BY \(tenant_id IS NULL\) ASC, version DESC/);
    const fr = fakeReplica();
    await new CmsPageRepository(fr.provider).index('tenantA', { limit: 50, cursor: 'about' });
    const [sql, params] = fr.exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id = \$1/); expect(sql).toMatch(/slug > \$2/); expect(sql).toMatch(/ORDER BY slug LIMIT \$3/); expect(sql).not.toMatch(/OFFSET/i);
    expect(params).toEqual(['tenantA', 'about', 50]);
  });
});

describe('banners isolation', () => {
  it('insert binds tenant_id; live list bounds on is_active + window; keyset (no OFFSET)', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new BannerRepository(fakeReplica().provider).insert(tx as any, banner(), 'u1');
    expect(tx.query.mock.calls[0][0]).toMatch(/INSERT INTO banners/); expect(tx.query.mock.calls[0][1]).toContain('tenantA');
    const { provider, exec } = fakeReplica();
    await new BannerRepository(provider).listFor('tenantA', { box: 'live', limit: 50 });
    const [sql] = exec.query.mock.calls[0];
    expect(sql).toMatch(/tenant_id=\$1/); expect(sql).toMatch(/is_active=true AND starts_at <= now\(\) AND ends_at > now\(\)/); expect(sql).not.toMatch(/OFFSET/i);
  });
  it('incrementClick is an atomic +1 bound by id + tenant_id', async () => {
    const tx = { query: jest.fn().mockResolvedValue({ rows: [], rowCount: 1 }) };
    await new BannerRepository(fakeReplica().provider).incrementClick(tx as any, 'tenantA', 'b1');
    const [sql, params] = tx.query.mock.calls[0];
    expect(sql).toMatch(/SET click_count = click_count \+ 1/); expect(sql).toMatch(/WHERE id=\$1 AND tenant_id=\$2/); expect(params).toEqual(['b1', 'tenantA']);
  });
});
