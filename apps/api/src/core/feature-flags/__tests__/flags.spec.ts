// core/feature-flags/__tests__/flags.spec.ts · default-OFF, kill-switch, allowlist, rollout, + the config/flags
// remote-config map (allEnabled).
import { FlagsService } from '../flags.service';

function svc(row: any) {
  const pools: any = { replica: () => ({ query: async () => ({ rows: row ? [row] : [], rowCount: row ? 1 : 0 }) }) };
  // PC-56 ADMIN-11: `set`/`get` were absent from this stub, and the stale-value fail-safe calls both. A cache without
  // `set` throws synchronously, so the service now guards the call itself — and the stub carries the full shape so the
  // stale path is exercised rather than merely tolerated.
  const store = new Map<string, unknown>();
  const cache: any = {
    wrap: (_k: string, _t: number, load: any) => load(),
    set: async (k: string, v: unknown) => { store.set(k, v); },
    get: async (k: string) => store.get(k) ?? null,
  };
  return new FlagsService(pools, cache);
}

/** Build a FlagsService whose replica returns an arbitrary set of `feature_flags` rows (for allEnabled tests). */
function svcWithRows(rows: Array<{ key: string; is_enabled: boolean }>) {
  const query = jest.fn().mockResolvedValue({ rows, rowCount: rows.length });
  const pools: any = { replica: () => ({ query }) };
  const store = new Map<string, unknown>();
  const cache: any = {
    wrap: (_k: string, _t: number, load: any) => load(),
    set: async (k: string, v: unknown) => { store.set(k, v); },
    get: async (k: string) => store.get(k) ?? null,
  };
  return { svc: new FlagsService(pools, cache), query };
}

describe('FlagsService.isEnabled', () => {
  it('unknown flag → OFF (fail-closed)', async () => {
    expect(await svc(null).isEnabled('x', { tenantId: 't1' })).toBe(false);
  });
  it('kill-switch (is_enabled=false) → OFF for everyone', async () => {
    expect(await svc({ is_enabled: false, rollout_pct: 100, rules: {} }).isEnabled('x', { tenantId: 't1' })).toBe(false);
  });
  it('100% rollout → ON', async () => {
    expect(await svc({ is_enabled: true, rollout_pct: 100, rules: {} }).isEnabled('x', { tenantId: 't1' })).toBe(true);
  });
  it('0% rollout → OFF unless explicitly allowlisted', async () => {
    expect(await svc({ is_enabled: true, rollout_pct: 0, rules: {} }).isEnabled('x', { tenantId: 't1' })).toBe(false);
    expect(await svc({ is_enabled: true, rollout_pct: 0, rules: { tenant_ids: ['t1'] } }).isEnabled('x', { tenantId: 't1' })).toBe(true);
  });
  it('rollout is deterministic for the same subject', async () => {
    const s = svc({ is_enabled: true, rollout_pct: 50, rules: {} });
    const a = await s.isEnabled('flagA', { tenantId: 't-stable' });
    const b = await s.isEnabled('flagA', { tenantId: 't-stable' });
    expect(a).toBe(b);
  });
});

describe('FlagsService.allEnabled (GET /v1/config/flags remote-config map)', () => {
  it('returns a { key: boolean } map reflecting the feature_flags rows', async () => {
    const { svc } = svcWithRows([
      { key: 'farmer_app', is_enabled: true },
      { key: 'auctions', is_enabled: false },
      { key: 'wallet', is_enabled: false },
    ]);
    expect(await svc.allEnabled()).toEqual({ farmer_app: true, auctions: false, wallet: false });
  });

  it('empty table → empty map (never throws)', async () => {
    const { svc } = svcWithRows([]);
    expect(await svc.allEnabled()).toEqual({});
  });

  it('is is_enabled ONLY — a partial rollout (rollout_pct<100) reads as globally "on", a documented limitation', async () => {
    const { svc } = svcWithRows([{ key: 'listing_boost', is_enabled: true, rollout_pct: 10 } as any]);
    expect(await svc.allEnabled()).toEqual({ listing_boost: true });
  });

  it('queries the feature_flags table for key + is_enabled', async () => {
    const { svc, query } = svcWithRows([]);
    await svc.allEnabled();
    expect(query.mock.calls[0][0]).toMatch(/SELECT key, is_enabled FROM feature_flags/);
  });
});
