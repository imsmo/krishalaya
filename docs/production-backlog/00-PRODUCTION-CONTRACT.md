# 00 — THE PRODUCTION-GRADE CONTRACT (paste at the top of EVERY task)

This is the engineering constitution for Krishalaya — multi-tenant agri-commerce for **millions of users and
billions of operations**, under active attack from global competitors. Every task in this backlog is **production,
never a demo**. Copy the block below verbatim above each task you hand off.

> It extends `AI_AGENT_BUILD_GUIDE.md` §1 with clauses for frontend / mobile / infra tasks, because this backlog
> spans more than the API. For a pure `apps/api` module task, the original §1 is sufficient; this superset is safe
> for all tracks.

---

```
PRODUCTION-GRADE CONTRACT — obey for everything you build:

SCOPE & QUALITY
- This is large-scale multi-tenant SaaS for millions of users / billions of ops, under active
  attack. Write code that withstands that — never a demo, never a placeholder.
- NO stubs, NO TODOs, NO "left as an exercise". If a dependency is missing, build it or
  EXPLICITLY FLAG it (documented in the relevant *_BUILD_BACKLOG.md) — never fake or silently skip.
- Match the reference for the track you're in:
  * apps/api module → apps/api/src/modules/listings (+ identity for the security bar).
  * web app → that app's existing features/** + lib/** patterns (server-only data, i18n, no token in bundle).
  * mobile → apps/mobile existing core/** + features/** (no apiClient() in screens, flags default-OFF).
  * infra → infra/terraform + infra/helm + ops/ existing patterns.

CORE INVARIANTS (every API write)
- Tenant isolation: tenant_id in EVERY query + RLS. Re-resolve the subject from the token (no IDOR);
  a non-member resource returns 404, never 403 (no cross-tenant enumeration).
- One ACID tx per write (UnitOfWork); outbox events IN THE SAME TX; idempotency on every mutation
  (Idempotency-Key scoped per (user, endpoint)).
- Concurrency via optimistic version OR SELECT ... FOR UPDATE. Status transitions live ONLY in *.state.ts.
- Typed errors with stable codes; zod .strict() DTOs (reject unknown keys → no mass-assignment).
- Enforced RBAC that THROWS (never logs); permissions resolve from DB, never trusted from client;
  no privilege escalation; platform/owner roles are NOT assignable via the tenant API (Law 11).

MONEY (Law 2/3/4/11)
- Money is ALWAYS bigint minor units and moves ONLY through the wallet-service double-entry ledger.
  Never float, never a balance computed outside the ledger. Wallet/ledger changes need CODEOWNERS review.

SECURITY (attackers test this first)
- Fail CLOSED on misconfig. Secrets validated at boot; in production refuse to start with weak/dev/default
  secrets or debug affordances (e.g. OTP exposure) enabled (AppConfig.assertProductionSecurity).
- Never store raw Aadhaar/PAN/bank — only vault refs + last-4, masked in responses. Never log PII/OTP/tokens/secrets.
- DPDP: append-only consent, data-subject export/delete, retention. Audit every admin/state-changing action
  into append-only audit_log IN THE SAME TX (actor, action, old/new, reason, ip, request_id).
- Rate-limit/throttle sensitive endpoints; cap every list with LIMIT; bound write amplification; short
  statement/lock timeouts. Guard regexes against ReDoS. Validate identifiers (phone E.164, IFSC, pincode).

SCALE (billions of rows/ops)
- Keyset (cursor) pagination only — never OFFSET. Index every hot filter/sort. Partitioned-table queries
  must include the partition key so PG prunes. No N+1 (batch/join). Reads on the replica/read-model (CQRS).
- Cache hot reads with explicit invalidation, tenant-prefixed keys. Route writes through the shard + cell
  routers even at shard_count=1 (scaling out is config, not a rewrite).

RESILIENCE (degrade, never die — Law 12)
- Wrap EVERY external call (SMS/payment/eKYC/weather/search/wallet gRPC/push) in core/resilience
  (timeout + retry-with-backoff + circuit-breaker + fallback). One hung dependency must never cascade.
- Classify critical paths (pay/wallet/auth/bid) so they survive overload (core/backpressure).
- Emit a metric + timing on every use-case; structured logs carry request_id (no PII/secrets).
- Every feature behind a flag, default OFF, with a kill-switch.

EXTERNAL-PROVIDER TASKS (this backlog has many)
- Define a PORT (interface) in core; the real adapter lives behind it, wrapped in resilience.
- Keep a no-op/degrade adapter for local/dev (the dev path must NEVER leak codes in prod).
- Provider secrets come from the secret manager, validated at boot. Webhooks are signature-verified server-side.
- Costs/rate-limits/abuse on the provider are YOUR problem — cap and meter them.

TESTS — MANDATORY
- Unit (invariants + state machines) + an integration test against a REAL Postgres proving cross-tenant RLS
  denial. Mock-only tests that prove nothing are rejected. Frontend/mobile: pure features/** unit-tested;
  e2e/Maestro where the track already has it.

DEFINITION OF DONE — with PROOF (nothing is "done" without it)
- Run the track's gate and PASTE the green output:
  * apps/api: pnpm typecheck && pnpm test:unit && pnpm build && pnpm test:integration
              && node db/scripts/verify-rls-coverage.js && bash tools/scripts/verify-structure.sh
  * web/mobile: pnpm typecheck && pnpm test (+ pnpm build for web).
  * infra: terraform plan/validate, helm lint/template, a dry-run apply where possible.
- Self-audit against the SECURITY + SCALE + RESILIENCE sections above. Update the relevant *_BUILD_BACKLOG.md
  and MODULE_STATUS.md. Red = not done.

If a scale/security trade-off is ambiguous, choose what a top global SaaS ships and STATE the assumption.
Correctness and clarity over cleverness. Build it as if a hostile competitor audits it tomorrow.
```

---

## Pre-flight every task agent should do before writing code
1. Read `/CLAUDE.md` — the **12 Laws** (esp. Law 11 god-mode-only-in-admin-api, Law 12 degrade-never-die).
2. Read the **reference module/app** for the track (above).
3. Read the **canonical schema** for the domain in `db/migrations/00NN_*.sql` — match column names exactly; money
   is `bigint` minor units. If schema is missing, add a NEW numbered migration (never edit an applied one) with
   `tenant_id` + RLS on any tenant-scoped table.
4. Read the relevant `*_BUILD_BACKLOG.md` note for the exact "flagged" reason this task exists.
