# PC-52 · shard-day runbook (config, not code)

Trigger: Phase-3 tenant count. Everything below is env + data; zero code changes.

1. **Provision** shard clusters; run migrations on each. Set `DATABASE_URL_SHARD_<n>` (+ `_REPLICA_`) per pod env.
2. **Flip** `SHARD_COUNT=<n>`. New tenants hash across shards; all EXISTING tenants still hash — so first:
3. **Pin the world**: set `SHARD_DIRECTORY` pinning every existing tenant to shard 0 BEFORE flipping SHARD_COUNT (pins beat hash → nothing moves).
4. **Migrate one tenant at a time**: copy rows (RLS-scoped dump by tenant_id) → verify counts/checksums → change that tenant's pin to the target shard → redeploy env → delete origin rows after soak.
5. **Retire pins** whose hash already equals their pin (keeps the directory small).
Invariants: the FNV-1a mapping is spec-pinned (sharding-execution.spec.ts) — never change it once data lands; a malformed directory degrades to hash routing, never a boot failure.
