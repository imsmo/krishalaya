// modules/lookups/__tests__/lookups.spec.ts · unit tests for the PURE locale resolver + the service's SQL/caching
// contract (mocked replica + cache). Cross-tenant RLS denial + real name-resolution are covered by the integration
// suite against a real Postgres (lookups.integration.spec.ts).
import { LookupsService, baseLang } from '../lookups.service';

describe('baseLang (P1-9)', () => {
  it('reduces a locale tag to its ISO-639 base, lowercased', () => {
    expect(baseLang('hi-IN')).toBe('hi');
    expect(baseLang('EN_US')).toBe('en');
    expect(baseLang('gu')).toBe('gu');
  });
  it('defaults to en for missing/garbage', () => {
    expect(baseLang(undefined)).toBe('en');
    expect(baseLang('')).toBe('en');
    expect(baseLang('123')).toBe('en');
  });
});

describe('LookupsService', () => {
  const rows = [{ id: 'lv1', code: 'aadhaar', name: 'Aadhaar', sort_order: 1, meta: {} }];
  const makeReplica = (captured: { sql?: string; params?: unknown[] }) => ({
    forTenant: () => ({ query: async (sql: string, params: unknown[]) => { captured.sql = sql; captured.params = params; return { rows }; } }),
  });
  const passthroughCache = { get: async () => null, set: async () => undefined, del: async () => undefined, wrap: async (_k: string, _t: number, load: () => Promise<unknown>) => load() } as any;
  const metrics = { increment: () => undefined, observe: () => undefined, timing: () => undefined } as any;

  it('values(): scopes to platform + this tenant, dedups by code (tenant wins), resolves the locale name', async () => {
    const cap: { sql?: string; params?: unknown[] } = {};
    const svc = new LookupsService(makeReplica(cap) as any, passthroughCache, metrics);
    const out = await svc.values('t1', 'hi-IN', 'doc_type');
    expect(out).toEqual([{ id: 'lv1', code: 'aadhaar', name: 'Aadhaar', sortOrder: 1, meta: {} }]);
    expect(cap.params).toEqual(['doc_type', 't1', 'hi']);                 // [type, tenant, baseLang]
    expect(cap.sql).toMatch(/tenant_id IS NULL OR lv\.tenant_id = \$2/);  // platform + tenant
    expect(cap.sql).toMatch(/DISTINCT ON \(lv\.code\)/);                  // tenant shadows platform
    expect(cap.sql).toMatch(/translations/);                             // locale-resolved
  });

  // PC-56 STORE-1c · found on the way: an anonymous, no-tenant caller (the storefront's /for-organisations reading `tenant_type`) sent ''
  // as the tenant uuid and PostgreSQL refused it (a 500). No tenant = the platform's own values: the parameter is NULL, typed uuid.
  it('values() with NO tenant in context: the tenant parameter is NULL (platform values only), never an empty-string uuid', async () => {
    const cap: { sql?: string; params?: unknown[] } = {};
    const svc = new LookupsService(makeReplica(cap) as any, passthroughCache, metrics);
    await svc.values('', 'en', 'tenant_type');
    expect(cap.params).toEqual(['tenant_type', null, 'en']);
    expect(cap.sql).toMatch(/lv\.tenant_id = \$2::uuid/);
  });

  it('regions(): defaults to level-1 states with the resolved locale, bounded + ordered by name', async () => {
    const cap: { sql?: string; params?: unknown[] } = {};
    const svc = new LookupsService(makeReplica(cap) as any, passthroughCache, metrics);
    await svc.regions('t1', 'en', {});
    expect(cap.params).toEqual(['en', 1]);                               // [baseLang, level default 1]
    expect(cap.sql).toMatch(/r\.level = \$2/);
    expect(cap.sql).toMatch(/ORDER BY name/);
  });

  it("regions(): a parentId returns that node's children (not a level filter)", async () => {
    const cap: { sql?: string; params?: unknown[] } = {};
    const svc = new LookupsService(makeReplica(cap) as any, passthroughCache, metrics);
    await svc.regions('t1', 'gu', { parentId: 'p1' });
    expect(cap.params).toEqual(['gu', 'p1']);
    expect(cap.sql).toMatch(/r\.parent_id = \$2/);
  });
});
