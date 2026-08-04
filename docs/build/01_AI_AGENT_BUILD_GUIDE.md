# How to Build a Module with an AI Coding Agent (Claude Code / Cursor / etc.)

You will build most of this with AI agents. This is the exact, repeatable recipe
so every module comes out consistent and correct. **One module per agent session.**

## The brief (paste this, fill the [BRACKETS])

> You are implementing the **[MODULE]** module of Krishalaya, a multi-tenant
> agri-commerce platform. Before writing code:
> 1. Read `/CLAUDE.md` — the 12 laws are non-negotiable constraints.
> 2. Read `/apps/api/src/modules/listings/` IN FULL — it is the gold-standard
>    pattern. Your module must match its structure and patterns exactly.
> 3. Read the DB tables for this module in `/db/migrations/` (see the file named
>    for your domain) — those are the real columns; money is BIGINT minor units.
> 4. Read `/docs/architecture/module-map.md` for which PRD module + screens this serves.
>
> Then implement [MODULE] to the SAME depth as listings:
> - `domain/*.entity.ts` (pure TS, no framework, 95% unit-tested)
> - `domain/*.state.ts` for any status field (the ONLY place transitions live)
> - `repositories/*.repository.ts` — tenant-scoped, shard-routed, reads on replica
> - `services/*.service.ts` — use-cases; writes + outbox events in ONE transaction;
>   idempotency on mutations; quota where it applies
> - `read-models/*` for any list/search/dashboard read path
> - `controllers/v1/*.controller.ts` — validate→authorize→delegate only
> - `events/handlers/*` for events this module consumes (idempotent)
> - `jobs/*` for any cron/queue work (runs in apps/worker)
> - `policies/*.policies.ts` — permission codes (from DB, dynamic RBAC)
> - `__tests__/tenant-isolation.spec.ts` is MANDATORY and must actually assert
>   cross-tenant denial.
>
> Money moves ONLY by calling the wallet-service gRPC client — never INSERT into
> ledger tables. Emit events via the outbox in the same txn — never dual-write.
> Output: implement every file, then run the module's tests and the repo's
> `tools/scripts/verify-structure.sh`.

## Review checklist (you, the founder/CTO, before merge)
- [ ] Matches the listings file layout exactly
- [ ] No raw query without tenant scoping (the tenant-guard lint rule catches most)
- [ ] No `number`/float for money — only `bigint` minor units
- [ ] Status changes go through the state machine, nowhere else
- [ ] Every write others care about emits an outbox event in the same transaction
- [ ] Mutations accept Idempotency-Key
- [ ] tenant-isolation.spec actually fails when given another tenant's id
- [ ] No import of another module's repository (only its service/events)
- [ ] i18n keys for user-facing text, not literals

## Pace & sequencing
- Do modules in the BUILD_PLAN order. A module's dependencies must be built first
  (e.g. payments before orders, wallet-service before payments).
- One module ≈ one to a few agent sessions + your review. Budget per the effort
  column in the build plan.
- After each module: run its tests, deploy to staging behind a feature flag (OFF),
  enable for the demo tenant, smoke-test, then turn the flag on gradually.
