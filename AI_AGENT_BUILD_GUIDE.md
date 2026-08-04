# AI AGENT BUILD GUIDE — Krishalaya

**Paste the "Production-Grade Contract" (§1) at the top of EVERY build command.** This guide is
the engineering constitution for building Krishalaya — a multi-tenant agri-commerce platform
targeting **millions of active users and billions of operations**, where thousands of competitors
and global attackers will probe us from day one. Build accordingly: every module is production,
not a demo.

Reference module = `apps/api/src/modules/listings`. Hardened example = `apps/api/src/modules/identity`
(read its `README.md` and `Krishalaya_Identity_Security_Audit.md`). When in doubt, match them.

---

## 1. THE PRODUCTION-GRADE CONTRACT (paste at the top of every command)

```
PRODUCTION-GRADE CONTRACT — obey for everything you build:
- This is large-scale multi-tenant SaaS for millions of users / billions of ops, under
  active attack. Write code that withstands that — never a demo.
- Match the reference: apps/api/src/modules/listings (modules) and the implemented core
  *.pg.ts files (infra). Mirror their layering, naming, and rigor.
- NO stubs, NO TODOs, NO placeholders, NO "left as an exercise". If a dependency is
  missing, build it or explicitly flag it — never fake or silently skip.
- Bake in EVERY time: tenant isolation (tenant_id + RLS), one ACID tx per write
  (UnitOfWork), outbox events IN THE SAME TX, idempotency on mutations, enforced
  authorization that THROWS (never logs), optimistic-lock or SELECT FOR UPDATE for
  concurrency, typed errors with stable codes, input validation (zod .strict()),
  metrics + structured logs (no PII/secrets), least-privilege RBAC.
- Money is ALWAYS bigint minor units and moves ONLY via the wallet-service gRPC client.
- Wrap every external call (SMS/payment/search) in core/resilience (timeout+retry+breaker).
- Tests are MANDATORY: unit (invariants + state machines) + an integration test against a
  REAL Postgres proving cross-tenant RLS denial. Mock-only tests that prove nothing are rejected.
- Think adversarially: enumerate how a hostile tenant/user/attacker abuses each endpoint and
  close it (see §4). Assume misconfiguration happens — fail CLOSED, never open.
- Before saying "done": run `npm run typecheck`, `npm run test:unit`, `npm run build`, and the
  module's integration test; self-audit against §4–§6 and §9; PASTE the green output. Red = not done.
- If a scale/security trade-off is ambiguous, choose what a top SaaS company ships and state
  the assumption. Correctness and clarity over cleverness.
```

---

## 2. PRE-FLIGHT — read before writing a line
1. `/CLAUDE.md` — the **12 laws** (10 + Law 11 god-mode-only-in-admin-api + Law 12 degrade-never-die). Non-negotiable.
2. `apps/api/src/modules/listings/` IN FULL — gold-standard structure/patterns.
3. `apps/api/src/modules/identity/` + its `README.md` + `Krishalaya_Identity_Security_Audit.md` — the security/auth bar.
4. The module's canonical schema in `db/migrations/00NN_<domain>.sql` — match column names EXACTLY; money is `bigint` minor units; flag any mismatch, never invent.
5. `apps/api/src/core/` — use core contracts by token (`UNIT_OF_WORK`, `OUTBOX_WRITER`, `QUOTA_SERVICE`, `IDEMPOTENCY_SERVICE`, `CACHE_SERVICE`, `METRICS`, `READ_REPLICA`, `ROLE_CACHE_SERVICE`, `AUDIT_WRITER`, auth/token/otp). Never instantiate `pg`/Redis in a module.
6. `docs/architecture/module-map.md` (PRD module + screens), `MODULE_STATUS.md` (progress), `START_HERE.md` (sequence).

---

## 3. WHAT TO BUILD — file structure (match listings exactly)
- `domain/*.entity.ts` — pure TS, no framework/I/O; all invariants; 95%+ unit-tested.
- `domain/*.state.ts` — the ONLY place a status field's transitions live (Law 5).
- `domain/*.errors.ts` — typed errors, stable codes mapped to HTTP.
- `domain/*.events.ts` — integration event types.
- `dto/*.ts` — zod, **`.strict()`** (rejects unknown keys → no mass-assignment).
- `repositories/*.repository.ts` — tenant-scoped (tenant_id in EVERY query), parameterized only, shard-routed, reads on replica, writes in the caller's tx, concurrency via `version` optimistic lock OR `SELECT … FOR UPDATE`.
- `services/*.service.ts` — use-cases; one ACID tx per write; outbox events in the SAME tx; idempotency on mutations; quota where it applies; enforced authz; metrics on every use-case; audit on admin actions.
- `read-models/*` — list/search/dashboard reads (replica/OpenSearch); cursor pagination, never OFFSET.
- `controllers/v1/*.controller.ts` — guards + zod validation + idempotency header + URI-versioned; validate→authorize→delegate ONLY (no business logic).
- `events/handlers/*` — events this module consumes; idempotent at the consumer.
- `jobs/*` — cron/queue work (runs in apps/worker); batched + `FOR UPDATE SKIP LOCKED`.
- `policies/*.policies.ts` — permission codes (DB-backed dynamic RBAC, Law 6).
- `__tests__/` — unit + `tenant-isolation.spec.ts` (must actually assert cross-tenant denial) + `*.integration.spec.ts` (real Postgres + RLS) + a slice SQL under `apps/api/test/sql/`.
- `README.md` — what it owns, endpoints, security properties.

If the module needs schema not in `db/migrations`: add a NEW numbered migration (never edit an applied one), with `tenant_id` + RLS on any tenant-scoped table; wallet/ledger changes need CODEOWNERS review (Law 9).

---

## 4. SECURITY REQUIREMENTS (the part attackers test first — make it explicit)
Think like a hostile competitor for every endpoint. These are mandatory, not optional:

- **Fail closed on misconfig.** Secrets must be validated at boot; in production refuse to start with weak/dev/default secrets or debug affordances (e.g. OTP exposure) enabled. (`AppConfig.assertProductionSecurity`.) Never leak codes/tokens in responses or logs outside `test`.
- **AuthN/tokens.** Short-lived access JWT (pin `algorithms:['HS256']`, check iss/aud); opaque refresh tokens stored only as salted hashes, rotated each refresh, constant-time compared. OTP: hashed at rest, single-use, per-phone request rate-limit + resend cooldown + verify-attempt cap/lockout + a per-phone verify throttle; enumeration-safe responses.
- **AuthZ / RBAC least-privilege.** Permissions resolve from the DB (RoleCache), never trusted from the client. **No privilege escalation**: platform/owner roles are NOT assignable via the tenant API (Law 11), the resolver never grants `*`, and staff overrides can't grant money/god perms nor perms the granter lacks.
- **Tenant isolation everywhere.** `tenant_id` in every query + RLS. Admin reads of other users/resources are SCOPED to the caller's tenant; a non-member returns **404 (not 403)** so attackers can't enumerate across tenants. No IDOR — never trust an id from the request without an ownership/tenant check.
- **Idempotency keys scoped per `(user, endpoint)`** — one user can never replay another's key.
- **Input validation.** zod `.strict()`; normalize/validate identifiers (phone E.164, IFSC, pincode); parameterized SQL only; guard against ReDoS in regexes.
- **PII & secrets.** Never store raw Aadhaar/PAN/bank — only vault refs + last-4, masked in responses. Never log PII, OTPs, tokens, or secrets. DPDP: consent (append-only), data-subject requests, retention.
- **Audit.** Every admin/state-changing action writes an append-only `audit_log` row IN THE SAME TX (actor, action, old/new, reason, ip, request_id).
- **Abuse/DoS.** Rate-limit/throttle sensitive endpoints; cap list sizes (always `LIMIT`); bound write amplification (don't write a row per malicious request); short `statement_timeout`/`lock_timeout`.

Deliverable: a short "Threats considered" note per module + security regression tests (see identity's `rbac-security.spec.ts`, OTP throttle test).

---

## 5. SCALE & PERFORMANCE coding rules (billions of rows/ops)
- **Cursor (keyset) pagination only** — never `OFFSET` (it scans + skips at scale).
- **Index every hot filter/sort**; queries on partitioned tables must include the partition key (`created_at` via `uuid_v7_time(id)`) so PG prunes to one partition (Law 8).
- **No N+1** — batch/join; no per-row queries in a loop.
- **CQRS** — reads go to the replica/read-model (`@ReadOnly`), never the write primary (Law 12).
- **Cache hot reads** (CacheService) with explicit invalidation on write; tenant-prefixed keys.
- **Bounded everything** — every list has a max `LIMIT`; every external call a timeout; every job batched (`FOR UPDATE SKIP LOCKED`).
- **Write through the shard + cell routers** even at shard_count=1, so scaling out is config, not rewrite (Law 12).
- **Money correctness** — `bigint` minor units only; zero-sum ledger via wallet-service; never float.

---

## 6. RESILIENCE & OBSERVABILITY (degrade, never die — Law 12)
- Wrap EVERY external dependency (SMS, payment gateway, OpenSearch, wallet gRPC) in `core/resilience` — timeout + retry-with-backoff + circuit-breaker + fallback. One hung dependency must never cascade.
- Classify requests (`core/backpressure`) so critical paths (pay/wallet/auth/bid) survive overload while sheddable traffic is dropped.
- Emit a metric + timing on every use-case; structured logs carry `request_id` (no PII/secrets). Define SLOs for new hot endpoints.
- Every feature behind a flag, default OFF, with a kill-switch (Law 10).

---

## 7. DEFINITION OF DONE (with PROOF — nothing is "done" without it)
```bash
cd apps/api
npm run typecheck        # exit 0
npm run test:unit        # all green (incl. tenant-isolation + security regression tests)
npm run build            # emits dist/
docker compose -f docker-compose.dev.yml up -d   # then load the module slice SQL
npm run test:integration # real Postgres: create→outbox, state transitions, idempotency,
                         # quota, and CROSS-TENANT RLS denial
node ../../db/scripts/verify-rls-coverage.js      # RLS gate: zero tenant tables unprotected
bash ../../tools/scripts/verify-structure.sh      # module-structure lint
```
Then: register the module in `app.module.ts`, write its `README.md`, update `MODULE_STATUS.md`,
and ensure CI (`.github/workflows/api-ci.yml` + `db-migrate.yml`) is green. **Paste the green output.**

---

## 8. THE REVIEW CHECKLIST (you, founder/CTO, before merge)
Structure & laws:
- [ ] Matches the listings file layout; no module imports another module's repository (only its service/events).
- [ ] Status changes go only through the state machine; events emitted via outbox in the same tx.
- [ ] Mutations accept Idempotency-Key (scoped per user); i18n keys, not literals.

The 8 recurring bug-classes we KEEP catching — grep the diff for each:
- [ ] **Guards that log instead of throw** (authorization must `throw`).
- [ ] **DTO ↔ usage field mismatches** (service/controller/read-model use the exact DTO field names).
- [ ] **Schema ↔ SQL column mismatches** (every column exists in `db/migrations`).
- [ ] **Inline `require(...)`** (must be top-level imports; imported error classes must exist).
- [ ] **Money as `number`/float** (only `bigint` minor units).
- [ ] **Missing `tenant_id`** in any query (instant reject).
- [ ] **Events written outside the tx** (must be inside `uow.run`).
- [ ] **Tests that mock everything** (require a real-Postgres integration test with RLS).

Security (from §4):
- [ ] No privilege escalation (platform roles unassignable here; no `*`; overrides bounded).
- [ ] Admin reads tenant-scoped (404 on non-member, no cross-tenant enumeration / IDOR).
- [ ] No PII/secrets/OTP/token in logs or responses; PII via vault refs only.
- [ ] Sensitive endpoints throttled; lists bounded; fail-closed on misconfig.
- [ ] Audit rows for admin actions.

If any fail: *"This violates the Production-Grade Contract / DoD item X and diverges from the reference at <file>. Fix and re-verify."*

---

## 9. PACE & SEQUENCING
- Build in `MODULE_STATUS.md` order; a module's dependencies come first.
- **Hard dependency:** `wallet-service` before `payments`. `orders` core (cart/order/items) can be
  built before `payments`, with the money step behind a feature flag, then completed when payments
  lands — or build `payments` immediately after `orders`. (Don't build `orders` checkout's money path
  before the wallet-service exists.)
- Harden the slice of core a module needs JUST BEFORE building it (e.g. resilience/circuit-breakers
  before `payments`).
- One module ≈ one to a few agent sessions + your review. **One module per session** — never "build 5".
- After each module: tests green → deploy to staging behind a feature flag (OFF) → enable for the
  demo tenant → smoke-test → roll the flag on gradually.

---

## 10. PER-MODULE COMPLETION RITUAL
1. All §7 gates green; output pasted. 2. Registered in `app.module.ts`. 3. `README.md` written.
4. `MODULE_STATUS.md` updated to ✅. 5. Security "threats considered" note + regression tests added.
6. CI green. Only then is the module done.

*North star: when in doubt, make it look like `listings`/`identity`, and assume an attacker is reading your code.*
