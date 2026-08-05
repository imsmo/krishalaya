// core/sharding/shard-directory.ts · PC-52 sharding EXECUTION. Two pure pieces that turn shard day into
// config, not code (ADR-0007):
//   1. parseShardDirectory — explicit tenant→shard PINS (env SHARD_DIRECTORY='{"<tenantId>":2,...}').
//      A pin beats the hash. This is what makes LIVE MIGRATION possible: copy a tenant's rows to the new
//      shard, pin it, verify, unpin-and-flip — one tenant at a time, no big-bang.
//   2. urlForShard — per-shard connection URLs (env DATABASE_URL_SHARD_<n> / DATABASE_URL_REPLICA_SHARD_<n>),
//      falling back to the default URLs so shard 0 / single-shard behaviour is byte-identical to today.
export function parseShardDirectory(raw: string | undefined, shardCount: number): Readonly<Record<string, number>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [tenantId, shard] of Object.entries(parsed)) {
      const n = Number(shard);
      if (Number.isInteger(n) && n >= 0 && n < shardCount) out[tenantId] = n; // out-of-range pins are ignored, never crash boot
    }
    return out;
  } catch { return {}; } // malformed directory must never take the API down — hash routing still stands
}

export function urlForShard(env: Record<string, string | undefined>, shardId: number, role: 'writer' | 'replica', fallback: string): string {
  const key = role === 'writer' ? `DATABASE_URL_SHARD_${shardId}` : `DATABASE_URL_REPLICA_SHARD_${shardId}`;
  return env[key] || fallback;
}
