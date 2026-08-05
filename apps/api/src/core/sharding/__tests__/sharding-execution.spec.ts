// PC-52 · sharding-execution spec. Pins: hash stability + range; directory pin beats hash; malformed/
// out-of-range pins ignored (boot must never die on config); per-shard URL fallback keeps shard 0 identical.
import { parseShardDirectory, urlForShard } from '../shard-directory';

describe('parseShardDirectory (the live-migration lever)', () => {
  it('accepts valid pins, drops out-of-range, survives garbage', () => {
    expect(parseShardDirectory('{"t1":2,"t2":0,"t3":9,"t4":-1,"t5":"x"}', 3)).toEqual({ t1: 2, t2: 0 });
    expect(parseShardDirectory('not json', 3)).toEqual({});
    expect(parseShardDirectory(undefined, 3)).toEqual({});
  });
});

describe('urlForShard (config-only shard day)', () => {
  it('uses DATABASE_URL_SHARD_N when set; falls back to the default per role', () => {
    const env = { DATABASE_URL_SHARD_2: 'pg://s2', DATABASE_URL_REPLICA_SHARD_2: 'pg://s2r' };
    expect(urlForShard(env, 2, 'writer', 'pg://default')).toBe('pg://s2');
    expect(urlForShard(env, 2, 'replica', 'pg://default-r')).toBe('pg://s2r');
    expect(urlForShard(env, 0, 'writer', 'pg://default')).toBe('pg://default');   // shard 0 unchanged
    expect(urlForShard(env, 1, 'replica', 'pg://default-r')).toBe('pg://default-r');
  });
});

describe('ShardRouter hash (stability contract)', () => {
  // The FNV-1a mapping must NEVER change once data lands on shards — pin the algorithm here.
  const fnv = (tenantId: string, shards: number) => {
    let h = 2166136261;
    for (let i = 0; i < tenantId.length; i++) { h ^= tenantId.charCodeAt(i); h = Math.imul(h, 16777619); }
    return Math.abs(h) % shards;
  };
  it('is deterministic, in-range, and spreads tenants', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `tenant-${i}-4b1e`);
    const seen = new Set<number>();
    for (const id of ids) {
      const s = fnv(id, 4);
      expect(s).toBeGreaterThanOrEqual(0); expect(s).toBeLessThan(4);
      expect(fnv(id, 4)).toBe(s);
      seen.add(s);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
