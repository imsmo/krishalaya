# KRISHALAYA — LAWS FOR AI CODING AGENTS (and humans)
Read before writing ANY code. These are constraints, not suggestions.
The founder OS, PRD v4, and Database_Architecture/ are the source of truth.

## The 10 Code Laws
1. TENANT CONTEXT ALWAYS: every request resolves tenant from JWT; every query
   runs with `app.tenant_id` set (core/tenancy-context does this — never bypass).
   Never write a raw query without tenant scoping. RLS is the net, not the plan.
2. MONEY ONLY VIA WALLET-SERVICE: app code never INSERTs ledger rows. Call the
   wallet gRPC client. Amounts are BIGINT minor units + currency. Never float.
3. EVERY MUTATION IS IDEMPOTENT: accept Idempotency-Key; money ops require it.
4. EVENTS VIA OUTBOX ONLY: same-transaction outbox insert; never dual-write to
   SQS/OpenSearch/webhooks directly from request handlers.
5. STATE MACHINES IN ONE PLACE: status transitions live in domain/*.state.ts
   per module; controllers/services never set status fields directly.
6. NO HARDCODED BUSINESS DATA: languages, categories, roles, rates, templates
   come from DB (see db/seeds). If you are writing a string a tenant admin
   should control — stop, it belongs in a table.
7. ALL USER-FACING TEXT THROUGH i18n: keys, never literals. Vernacular first.
8. PARTITIONED TABLE LOOKUPS use uuid_v7_time(id) to prune (see db/scripts).
9. NEW DB CHANGES = numbered migration in db/migrations via PR. Never edit
   applied migrations. Migrations touching wallet/ledger need CODEOWNERS review.
10. EVERY FEATURE BEHIND A FLAG (core/feature-flags), default OFF, kill-switch.

## Module Blueprint (copy apps/api/src/modules/listings — the exemplar)
controllers/ → dto/ → services/ → domain/ (entities, state, events) →
repositories/ → jobs/ → policies/ → __tests__/. One module = one PRD module
= one future microservice. No module imports another module's repositories —
only its public service or events.

## Definition of Done
Unit tests (domain logic 95%+), integration test for each endpoint, i18n keys
added for 3 launch languages, audit_log entries for admin actions, feature
flag wired, OpenAPI annotations, no lint errors (incl. tenant-guard rule).

## Law 11 (added at final review)
GOD MODE IS A SEPARATE WORLD: owner/platform operations live ONLY in
apps/admin-api (own auth realm, FIDO2, IP allowlist). Never add an
owner-level endpoint to apps/api. Tenant code never imports admin code.

## Law 12 (scale)
DEGRADE, NEVER DIE: wrap every external dep (core/resilience); classify every
request (core/backpressure) so critical paths (pay/wallet/auth/bid) survive
overload while sheddable traffic is dropped. Reads tolerate replica lag via
@ReadOnly + read-models. Write code through core/sharding + core/cells routers
even while shard_count=1 — so scaling out is config, not rewrite.
