// apps/api/src/core/feature-flags/__tests__/admin11-targeting.spec.ts · PC-56 ADMIN-11.
//
// The evaluator's new half, tested where it runs. Two properties matter most:
//   1. A COUNTRY OR PLAN RULE NOW EXCLUDES — for two years it did not, and the console said it did.
//   2. THE FAIL-SAFE SERVES LAST-KNOWN VALUES AND NEVER MAKES A GOOD READ WORSE.
import { FlagsService } from '../flags.service';

const TEN = '11111111-1111-4111-8111-111111111111';

/** A service whose flag row is fixed and whose `tenant_flag_context` answer is controllable. Two different queries hit
 *  the same stub, so it dispatches on the SQL — crude, and it keeps the test honest about which read happened. */
function svc(row: any, ctxRow: { plan_code: string | null; country_code: string | null } | null = null, opts: { failLoad?: boolean } = {}) {
  const store = new Map<string, unknown>();
  const query = jest.fn(async (sql: string) => {
    if (String(sql).includes('tenant_flag_context')) return { rows: ctxRow ? [ctxRow] : [], rowCount: ctxRow ? 1 : 0 };
    if (opts.failLoad) throw new Error('replica down');
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  });
  const pools: any = { replica: () => ({ query }) };
  const cache: any = {
    wrap: async (_k: string, _t: number, load: any) => load(),
    set: async (k: string, v: unknown) => { store.set(k, v); },
    get: async (k: string) => store.get(k) ?? null,
  };
  return { svc: new FlagsService(pools, cache), query, store };
}

describe('ADMIN-11 · the evaluator honours plan and country', () => {
  const flag = (rules: unknown) => ({ is_enabled: true, rollout_pct: 100, rules });

  it('EXCLUDES a tenant outside a country rule', async () => {
    const a = svc(flag({ countries: ['IN'] }), { plan_code: 'growth', country_code: 'BD' });
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(false);
    const b = svc(flag({ countries: ['IN'] }), { plan_code: 'growth', country_code: 'IN' });
    expect(await b.svc.isEnabled('x', { tenantId: TEN })).toBe(true);
  });

  it('EXCLUDES a tenant outside a plan rule', async () => {
    const a = svc(flag({ plans: ['professional'] }), { plan_code: 'starter', country_code: 'IN' });
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(false);
  });

  // A tenant between subscriptions has no plan, and a flag limited to `professional` must not serve them.
  it('EXCLUDES a tenant whose plan or country cannot be resolved', async () => {
    const a = svc(flag({ countries: ['IN'] }), { plan_code: null, country_code: null });
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(false);
    const b = svc(flag({ plans: ['pro'] }), null);   // no row at all
    expect(await b.svc.isEnabled('x', { tenantId: TEN })).toBe(false);
  });

  it('still lets an allowlisted tenant through every other rule', async () => {
    const a = svc(flag({ tenant_ids: [TEN], countries: ['IN'] }), { plan_code: 'starter', country_code: 'BD' });
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(true);
  });

  // **AN UNTARGETED FLAG COSTS NO EXTRA READ.** The common case must not pay for the feature: the context query only
  // runs when a plan or country rule exists.
  it('does not resolve the tenant context for an untargeted flag', async () => {
    const a = svc(flag({}), { plan_code: 'growth', country_code: 'IN' });
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(true);
    expect(a.query.mock.calls.filter(([sql]) => String(sql).includes('tenant_flag_context')).length).toBe(0);
  });

  it('is still OFF for everyone when the kill switch is down, whatever the targeting says', async () => {
    const a = svc({ is_enabled: false, rollout_pct: 100, rules: { tenant_ids: [TEN], countries: ['IN'] } },
      { plan_code: 'growth', country_code: 'IN' });
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(false);
  });
});

describe('ADMIN-11 · the fail-safe W004 promises', () => {
  it('serves the LAST-KNOWN value when the read fails', async () => {
    // First read succeeds and seeds the stale copy; then the replica goes away.
    const store = new Map<string, unknown>();
    let fail = false;
    const query = jest.fn(async () => {
      if (fail) throw new Error('replica down');
      return { rows: [{ is_enabled: true, rollout_pct: 100, rules: {} }], rowCount: 1 };
    });
    const pools: any = { replica: () => ({ query }) };
    const cache: any = {
      // No caching of the hot key, so every call re-reads — which is what makes the second call hit the failure.
      wrap: async (_k: string, _t: number, load: any) => load(),
      set: async (k: string, v: unknown) => { store.set(k, v); },
      get: async (k: string) => store.get(k) ?? null,
    };
    const s = new FlagsService(pools, cache);
    expect(await s.isEnabled('x', { tenantId: TEN })).toBe(true);
    fail = true;
    // **THE PROMISE**: "Flags continue serving last-known values (fail-safe)." Before this wave the call threw and the
    // guard returned 500 — a database blip turning every flagged feature into an error.
    expect(await s.isEnabled('x', { tenantId: TEN })).toBe(true);
  });

  it('is OFF, not an error, for a flag it has never successfully read', async () => {
    const a = svc(null, null, { failLoad: true });
    // Fail-CLOSED where there is nothing to serve: an unknown flag has always meant off, and a read failure must not
    // become an exception the caller has to handle.
    expect(await a.svc.isEnabled('x', { tenantId: TEN })).toBe(false);
  });

  // **A CACHE WITHOUT `set` THROWS SYNCHRONOUSLY**, so `.catch()` never runs — this test exists because the first
  // implementation swallowed a perfectly good read and returned OFF.
  it('never lets the stale-write path spoil a successful read', async () => {
    const pools: any = { replica: () => ({ query: async () => ({ rows: [{ is_enabled: true, rollout_pct: 100, rules: {} }], rowCount: 1 }) }) };
    const brokenCache: any = { wrap: async (_k: string, _t: number, load: any) => load() };   // no set, no get
    expect(await new FlagsService(pools, brokenCache).isEnabled('x', { tenantId: TEN })).toBe(true);
  });
});
