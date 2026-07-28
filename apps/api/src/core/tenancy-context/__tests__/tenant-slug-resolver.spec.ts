// core/tenancy-context/__tests__/tenant-slug-resolver.spec.ts
// Unit tests for the storefront slug → tenant-uuid resolver (mocked pg pool). Verifies: malformed slugs never
// touch the DB; a live tenant resolves; positive + negative results are cached; a DB error degrades to null WITHOUT
// caching (so the next request retries). Real RLS/registry behaviour is exercised by the integration/e2e suites.
import { TenantSlugResolver } from '../tenant-slug-resolver';

const TENANT = '88888888-0000-7000-8000-000000000001';

function makePools(rowsFor: (sql: string, params: unknown[]) => unknown[], onCall?: () => void) {
  let calls = 0;
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls++;
      onCall?.();
      return { rows: rowsFor(sql, params) };
    },
  };
  return { provider: { writer: () => pool } as any, calls: () => calls };
}

describe('TenantSlugResolver', () => {
  it('rejects malformed slugs without hitting the DB', async () => {
    const p = makePools(() => [{ id: TENANT }]);
    const r = new TenantSlugResolver(p.provider);
    expect(await r.resolve('')).toBeNull();
    expect(await r.resolve('not a slug!')).toBeNull();
    expect(await r.resolve('a'.repeat(60))).toBeNull(); // > 50 chars
    expect(p.calls()).toBe(0);
  });

  it('resolves a live tenant and filters on a browsable status', async () => {
    let seenSql = '';
    let seenParams: unknown[] = [];
    const p = makePools((sql, params) => { seenSql = sql; seenParams = params; return [{ id: TENANT }]; });
    const r = new TenantSlugResolver(p.provider);
    expect(await r.resolve('demo-fpo')).toBe(TENANT);
    expect(seenParams).toEqual(['demo-fpo']);
    expect(seenSql).toMatch(/status IN \('trial','active','grace'\)/);
  });

  it('lower-cases the slug and caches positive hits (one DB call per slug)', async () => {
    const p = makePools(() => [{ id: TENANT }]);
    const r = new TenantSlugResolver(p.provider);
    expect(await r.resolve('Demo-FPO')).toBe(TENANT);
    expect(await r.resolve('demo-fpo')).toBe(TENANT); // served from cache
    expect(p.calls()).toBe(1);
  });

  it('caches a miss (unknown slug) so it does not re-query within the TTL', async () => {
    const p = makePools(() => []);
    const r = new TenantSlugResolver(p.provider);
    expect(await r.resolve('ghost')).toBeNull();
    expect(await r.resolve('ghost')).toBeNull();
    expect(p.calls()).toBe(1);
  });

  it('degrades to null on a DB error and does NOT cache (retries next time)', async () => {
    let throwIt = true;
    const pool = { query: async () => { if (throwIt) throw new Error('pg down'); return { rows: [{ id: TENANT }] }; } };
    const r = new TenantSlugResolver({ writer: () => pool } as any);
    expect(await r.resolve('demo-fpo')).toBeNull();
    throwIt = false;
    expect(await r.resolve('demo-fpo')).toBe(TENANT); // not pinned to the failed result
  });
});

describe('TenantSlugResolver.getBranding (DEV-26/Q20)', () => {
  it('returns display_name + logo_url for a live tenant', async () => {
    const p = makePools(() => [{ display_name: 'Anand FPO', logo_url: 'https://cdn.example/anand-fpo-logo.svg' }]);
    const r = new TenantSlugResolver(p.provider);
    expect(await r.getBranding(TENANT)).toEqual({ displayName: 'Anand FPO', logoUrl: 'https://cdn.example/anand-fpo-logo.svg' });
  });

  it('returns logoUrl:null (never a fabricated value) when the tenant has not configured one', async () => {
    const p = makePools(() => [{ display_name: 'Anand FPO', logo_url: null }]);
    const r = new TenantSlugResolver(p.provider);
    expect(await r.getBranding(TENANT)).toEqual({ displayName: 'Anand FPO', logoUrl: null });
  });

  it('returns null for an unknown/not-live tenant id — never invents branding', async () => {
    const p = makePools(() => []);
    const r = new TenantSlugResolver(p.provider);
    expect(await r.getBranding('99999999-0000-7000-8000-000000000099')).toBeNull();
  });

  it('caches a positive hit (one DB call per tenantId)', async () => {
    const p = makePools(() => [{ display_name: 'Anand FPO', logo_url: null }]);
    const r = new TenantSlugResolver(p.provider);
    await r.getBranding(TENANT);
    await r.getBranding(TENANT);
    expect(p.calls()).toBe(1);
  });

  it('degrades to null on a DB error and does NOT cache (retries next time)', async () => {
    let throwIt = true;
    const pool = { query: async () => { if (throwIt) throw new Error('pg down'); return { rows: [{ display_name: 'Anand FPO', logo_url: null }] }; } };
    const r = new TenantSlugResolver({ writer: () => pool } as any);
    expect(await r.getBranding(TENANT)).toBeNull();
    throwIt = false;
    expect(await r.getBranding(TENANT)).toEqual({ displayName: 'Anand FPO', logoUrl: null });
  });

  it('the branding cache is keyed separately from the slug cache (resolving a slug never pins a branding entry)', async () => {
    const p = makePools(() => [{ id: TENANT, display_name: 'Anand FPO', logo_url: null }]);
    const r = new TenantSlugResolver(p.provider);
    await r.resolve('demo-fpo');
    // getBranding still does its own DB read for the same underlying tenant id — the two caches never collide.
    const branding = await r.getBranding(TENANT);
    expect(branding).toEqual({ displayName: 'Anand FPO', logoUrl: null });
  });
});
