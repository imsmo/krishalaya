// Unit tests for the SWR read-through Cache, using an in-memory store + a fake clock (no SQLite/expo).
import { Cache, type CacheStore } from '../offline/cache';
import type { CacheEntry } from '../offline/cache-policies';

function memStore(): CacheStore & { map: Map<string, CacheEntry> } {
  const map = new Map<string, CacheEntry>();
  return {
    map,
    async get(k) { return map.get(k); },
    async set(k, e) { map.set(k, e); },
    async remove(k) { map.delete(k); },
    async removeByPrefix(p) { for (const k of [...map.keys()]) if (k.startsWith(p)) map.delete(k); },
  };
}

const policy = { ttlMs: 1000, swrMs: 5000 };

describe('Cache (SWR)', () => {
  it('MISS → fetches, stores, returns fresh value', async () => {
    const store = memStore(); const now = 100;
    const cache = new Cache(store, () => now);
    let calls = 0;
    const r = await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => { calls++; return 42; } });
    expect(r).toEqual({ value: 42, fromCache: false });
    expect(calls).toBe(1);
  });

  it('FRESH → serves cache without calling the fetcher', async () => {
    const store = memStore(); let now = 100;
    const cache = new Cache(store, () => now);
    await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => 1 });
    now = 500; // within ttl
    let calls = 0;
    const r = await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => { calls++; return 2; } });
    expect(r.value).toBe(1);
    expect(r.fromCache).toBe(true);
    expect(calls).toBe(0);
  });

  it('STALE → returns cached immediately AND revalidates in the background', async () => {
    const store = memStore(); let now = 100;
    const cache = new Cache(store, () => now);
    await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => 1 });
    now = 100 + 2000; // past ttl, within swr
    let calls = 0;
    const r = await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => { calls++; return 99; } });
    expect(r.value).toBe(1);          // served stale immediately
    await Promise.resolve(); await Promise.resolve(); // let the fire-and-forget revalidate settle
    expect(calls).toBe(1);            // revalidation ran
    const r2 = await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => 0 });
    expect(r2.value).toBe(99);        // cache now holds the refreshed value
  });

  it('EXPIRED + fetch fails → degrades to the cached value (never throws)', async () => {
    const store = memStore(); let now = 100;
    const cache = new Cache(store, () => now);
    await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => 7 });
    now = 100 + 999_999; // fully expired
    const r = await cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => { throw new Error('offline'); } });
    expect(r).toEqual({ value: 7, fromCache: true });
  });

  it('MISS + fetch fails with no cache → throws', async () => {
    const cache = new Cache(memStore(), () => 0);
    await expect(cache.read({ scope: 'u', ns: 'n', policy, fetcher: async () => { throw new Error('x'); } })).rejects.toThrow();
  });

  it('clearScope drops only that scope', async () => {
    const store = memStore();
    const cache = new Cache(store, () => 0);
    await cache.read({ scope: 'A', ns: 'n', policy, fetcher: async () => 1 });
    await cache.read({ scope: 'B', ns: 'n', policy, fetcher: async () => 2 });
    await cache.clearScope('A');
    expect([...store.map.keys()].some((k) => k.startsWith('kvcache:A:'))).toBe(false);
    expect([...store.map.keys()].some((k) => k.startsWith('kvcache:B:'))).toBe(true);
  });
});
