# Worker runtime (P0-9)

The scheduled-jobs host. A standalone Node process (pg + http, no framework — same style as `wallet-service`) that
connects as **`kv_relay`** (BYPASSRLS, for cross-tenant sweeps), exposes `/metrics` + `/healthz`, and runs a
scheduler loop: every tick, each **due** job runs under its **Postgres advisory leader-lock** (so N replicas are
safe — no double purge / double recon), timed + metered, with failures isolated.

## What it runs (operational, pg-native, bounded + idempotent)
| Job | Cadence | Does | Emits (for P0-6 alerts) |
|-----|---------|------|--------------------------|
| `recon-zero-sum` | 5 min | ledger Σlegs≠0 monitor → reconciliation_runs row | `kv_recon_mismatches`, `kv_recon_age_seconds` |
| `ensure-partitions` | hourly | `CALL ensure_partitions()` | `kv_partition_days_ahead` |
| `retention-enforcer` | daily | purge `delete`-action policies past `active_months` (catalog-validated table + created_at) | `kv_retention_purged_total` |
| `idempotency-purge` | hourly | drop expired `idempotency_keys` (bounded) | `kv_idempotency_purged_total` |
| `dpdp-erasure-cooling` | hourly | advance erasure DSRs past 90-day cooling → `identity.erasure_ready` outbox | `kv_erasure_advanced_total` |
| `outbox-gauge` | 1 min | measure unrelayed outbox backlog | `kv_outbox_pending` |

Every job is timed into `worker_job{job,ok}` + failures into `worker_job_failures{job}`.

## Design
- `config.ts` — fail-closed (prod requires a non-localhost, strong-password, **kv_relay** TLS DB URL).
- `runtime/cron.ts` + `runtime/leader-lock.ts` + `runtime/runner.ts` — **pure** (clock + effects injected),
  unit-tested (`__tests__/scheduler.spec.ts`: due-logic, lock-key determinism, run/skip/lock-miss/failure-isolation).
- `runtime/leader-lock.ts` uses `pg_try_advisory_lock(key)` on a dedicated connection held for the job's duration.
- `metrics.ts` — Prometheus exposition with **valid names** (mirrors the api's sanitiser) served at `/metrics`.

## Run
```bash
NODE_ENV=production DATABASE_URL='postgresql://kv_relay:***@<aurora>:5432/krishiverse?sslmode=require' \
METRICS_PORT=9090 node apps/worker/dist/main.js
```
Deployed via the `worker` Helm chart (no Service; exec liveness; `kv_relay` env from `krishiverse-worker-env`).
Scale to ≥1 replica; the advisory locks make >1 safe.

## Deferred: domain-handler jobs (need the api business logic)
These jobs run **handler logic that lives in the `apps/api` modules** (Nest providers), which this standalone
pg process can't import cleanly:
- **Outbox relay EXECUTION** — ✅ **RESOLVED (S1, KV-BL-063)**. `outbox-gauge` still just measures the
  backlog here; running each event's *handler* (`OutboxHandlerRegistry`) now happens in **apps/api itself**,
  on an in-process timer: `apps/api/src/core/outbox/relay.runner.ts` (`OutboxRelayRunner`, registered as a
  provider in `CoreModule`, started `OnApplicationBootstrap`/stopped `OnApplicationShutdown`). This is option
  (a) from the decision below. See `docs/adr/0001-monorepo-modular-monolith.md`'s 2026-07-10 amendment for the
  rationale and `RELAY_ENABLED` / `RELAY_DATABASE_URL` / `RELAY_INTERVAL_MS` / `RELAY_BATCH_SIZE` in
  `apps/api/src/core/config/env.validation.ts` for the knobs. `outbox-gauge`'s backlog gauge remains useful as
  an independent health signal (alerts if the api-side timer stalls) — it is NOT redundant with the runner.
- **Notification dispatch / digest / push / SMS-budget**, **settlement statement generation**, **mandi/weather
  ingest**, **KYC expiry**, **scheme sync** — still need module services; unresolved (see decision below).

**Decision required** (for the remaining jobs above, one of): (a) the **api** process runs them on an internal
timer (simplest — handlers are already there, as chosen for the outbox relay above); or (b) extract a shared
`@krishalaya/domain` lib both the api and worker import; or (c) publish to a bus (bullmq/SQS — already a
worker dep) and a consumer runs handlers. Until chosen, these remain in the api or unscheduled. Tracked as
**P0-9-follow-on** in the backlog. The 6 operational jobs above (the ones the P0-7 gap named: retention,
partitions, recon, erasure, outbox-backlog) **are** built and scheduled here.

### P0-9-follow-on disposition (Sprint S4) — every job above, resolved

The decision above is now made for the pilot: **option (a)**, same as the outbox relay — but split into two
apps/api mechanisms depending on whether the job is EVENT-driven or CADENCE-driven:
- event-driven jobs are already covered by S1's `OutboxRelayRunner` (it drains `OUTBOX_HANDLER_REGISTRY`,
  which every module's event handlers — not just the outbox relay's own — register into);
- cadence-driven (time-based) jobs get a NEW, analogous host: `core/jobs/jobs.runner.ts`'s
  `ScheduledJobsRunner` (`SCHEDULED_JOB_REGISTRY`, one independent timer + Postgres advisory lock per
  registered job — `apps/worker`'s leader-lock algorithm, copied verbatim into `core/jobs/scheduled-job.ts`).

| Job (from the list above) | Category | Disposition | Notes |
|---|---|---|---|
| Notification **dispatch** | (a) event-driven | **RESOLVED-BY-S1** | `communication.module.ts`'s `onModuleInit` registers one `DomainEventFanoutHandler` per `NOTIFICATION_EVENT_MAP` entry (+ `BroadcastRequestedHandler`) into `OUTBOX_HANDLER_REGISTRY` — drained by `OutboxRelayRunner` exactly like every other outbox handler. Verified: registration call sites in `apps/api/src/modules/communication/communication.module.ts`. |
| Notification **push** | (a) event-driven | **RESOLVED-BY-S1** | Not a separate job: `DomainEventFanoutHandler.handle` → `NotificationService.fanout` dispatches every non-`inapp` channel (push/sms/whatsapp/ivr) via the gateway **inline**, inside the same relay-drained handler call — there was never a distinct "push job" to schedule. |
| Notification **digest** | (b)-shaped, but no domain logic exists | **GA-DEFERRED** | `apps/api/src/modules/communication/README.md`'s own "Deferred (schema present, not built)" section lists "the smart-digest batching engine (`batchable`/`batched_into`)" — the batching SERVICE itself was never built (only the schema columns exist). Scheduling something that doesn't exist is out of this slice's scope (no new migrations/domain logic here); building the batcher is a separate, larger piece of work. |
| **SMS-budget** (guard/report) | (b)-shaped, but no domain logic exists | **GA-DEFERRED** | Only `notifications.cost_minor` (recording) exists; there is no budget-cap or daily-cost-report SERVICE anywhere in `apps/api` to schedule — the worker's old `sms-budget-guard.ts` / `sms-budget/daily-cost-report.cron` were 3-line placeholder stubs, removed in the S0 cleanup, never implemented. |
| **Settlement statement generation** | (b) cadence-driven, domain logic exists | **IMPLEMENTED-S4-api-timer** | `modules/payments/jobs/settlement-statements.job.ts` (`SettlementStatementsJob`) already existed, fully built, but nothing ever called it. Wrapped as a `ScheduledJob` (`modules/payments/jobs/settlement-statements.cadence-job.ts`, `SettlementStatementsCadenceJob`) and registered into `SCHEDULED_JOB_REGISTRY` at `PaymentsModule.onModuleInit`; hosted by `core/jobs/jobs.runner.ts`'s `ScheduledJobsRunner` (nightly, advisory-lock protected). Pilot-relevant: `settlement_statements` backs the seller wallet-statement screen (Screen-Data-Catalog #21/59) and payments/orders are core (always-ON, unlike auctions/dairy/fintech). Knobs: `JOBS_ENABLED` / `JOBS_DATABASE_URL` / `JOBS_POOL_MAX` (runner-wide) + `SETTLEMENT_STATEMENTS_JOB_ENABLED` / `SETTLEMENT_STATEMENTS_JOB_INTERVAL_MS` (per-job) in `apps/api/src/core/config/env.validation.ts`. |
| **Mandi/weather ingest** | (c) not built, modules OFF by default | **GA-DEFERRED** | `apps/api/src/modules/market-intel/README.md` explicitly defers "Agmarknet/eNAM external ingest jobs (need the external feed API)"; the equivalent IMD/weather-provider job is likewise schema-only. Both `market_intel` and `land_soil_weather` are `is_enabled=false` by default (`db/seeds/core/0009_feature_flags.sql`). No ingest SERVICE exists in either module to schedule regardless of flag state. |
| **KYC expiry** (reminders) | (b) cadence-driven, domain logic exists, but explicitly out of scope this slice | ~~**GA-DEFERRED (this slice only — not a true GA deferral)**~~ **[DEV-03 2026-07-23 DOC-DRIFT FIX] IMPLEMENTED — the "immediate follow-on" below already landed.** `apps/api/src/modules/identity/jobs/kyc-expiry-reminders.cadence-job.ts` (`KycExpiryRemindersCadenceJob`, git-dated 2026-07-10, same day as this table) wraps the job exactly as this row's own follow-on plan describes and is registered into `SCHEDULED_JOB_REGISTRY` at `IdentityModule.onModuleInit` (gated on `KYC_EXPIRY_JOB_ENABLED`, default `true`, `KYC_EXPIRY_JOB_INTERVAL_MS` default once/day). DEV-03's boot-proof (`node dist/main.js` against a real migrated Postgres, real timers) independently confirms this at runtime: `ScheduledJobsRunner` logged `scheduled-jobs runner starting 3 job(s): kyc-expiry-reminders, settlement-statements, payout-execution` on boot. `02_BACKEND_BACKLOG.md`'s own S4 EXECUTION OUTCOMES row already said "KYC expiry = IMPLEMENTED (cross-tenant driver, daily)" — this file's table body simply never caught up to that until now. Original row text (below, struck through) is left visible per contract §7 fix-forward discipline, not deleted: ~~`apps/api/src/modules/identity/jobs/kyc-expiry-reminders.job.ts` (`KycExpiryRemindersJob`) already exists, is exported by `IdentityModule`, and `kyc` **is** `is_enabled=true` by default — this is a *stronger* pilot candidate than settlement statements on paper. It was NOT wired this slice because this sprint's constraints explicitly forbid touching `modules/identity` (a parallel S4 workstream — bank-KYC-mirror — is active there) and `KycExpiryRemindersJob.runForTenant(tenantId, days)` needs a cross-tenant driver loop that doesn't exist yet anywhere. Tracked as an **immediate follow-on** (not GA-distant): a future slice can register it into the SAME `SCHEDULED_JOB_REGISTRY` this sprint built, from a NEW file outside `modules/identity` (mirroring how `payments.module.ts` registers `SettlementStatementsCadenceJob`), with zero edits to identity's own files.~~ |
| **Scheme sync** (PFMS sync/rule-refresh/stuck-escalation/window-open-alert) | (c) not built, module OFF by default | **GA-DEFERRED** | `apps/api/src/modules/schemes/README.md`'s own "Scope & deferrals" section defers exactly this ("PFMS sync + rule-refresh + stuck-escalation + window-open-alert jobs") — needs a government PFMS API integration that doesn't exist. `schemes` is `is_enabled=false` by default; apply→submit→verify→approve→DBT-record all work today without any sync job. |
| **Payout execution** (disbursement) | (b) cadence-driven, domain logic exists | **IMPLEMENTED-S5-api-timer** | S5 review P0 finding: `modules/payments/jobs/payout-execution.job.ts` (`PayoutExecutionJob`) already existed, fully built (cross-tenant `FOR UPDATE SKIP LOCKED` claim + per-payout disburse via `PayoutService.execute`, itself already error-isolated per payout — one failing payout is marked/left for retry, the loop never batch-aborts), but was registered **NOWHERE**: no worker registry entry, no `SCHEDULED_JOB_REGISTRY` entry, no admin trigger — a queued payout (`POST /v1/payouts` → `'queued'`) never disbursed to the bank. Wrapped as a `ScheduledJob` (`modules/payments/jobs/payout-execution.cadence-job.ts`, `PayoutExecutionCadenceJob`) and registered into `SCHEDULED_JOB_REGISTRY` at `PaymentsModule.onModuleInit`; hosted by `core/jobs/jobs.runner.ts`'s `ScheduledJobsRunner`, **every 5 min by default** — deliberately NOT the once/day settlement-statements cadence, since a payout's funds are already reserved out of the user's wallet the moment it's queued. Knobs: `PAYOUT_EXECUTION_JOB_ENABLED` / `PAYOUT_EXECUTION_JOB_INTERVAL_MS` / `PAYOUT_EXECUTION_JOB_BATCH_SIZE` in `apps/api/src/core/config/env.validation.ts`. |
| **Wage-priority-lane disbursement** | (b) cadence-driven, domain logic exists | **GA-DEFERRED (functionally redundant for the pilot)** | `modules/payments/jobs/wage-priority-lane.job.ts` (`WagePriorityLaneJob`) opens a dedicated `payout_batches` (`batchType: 'wage_lane'`) envelope and claims only `priority <= WAGE_LANE_PRIORITY` payouts via `PayoutBatchService.runBatch`. Deliberately NOT wired into `SCHEDULED_JOB_REGISTRY`: `PayoutRepository.claimQueued` — driven by the payout-execution job above — already claims with `ORDER BY priority ASC, created_at ASC` and no priority filter, so wage-lane payouts (priority=`WAGE_LANE_PRIORITY`=10, promoted by `BookingClockedOutHandler`) are already claimed and disbursed ahead of default-priority (100) payouts by that job alone, every 5-minute tick. This job's only distinct value is a separate auditable `payout_batches` envelope scoped to the wage lane (a reporting nicety), not needed for a wage payout to actually reach the bank. Revisit for GA if a dashboard needs wage-lane disbursement reported as its own batch rather than interleaved with the general execution job's ticks. See the disposition comment in `wage-priority-lane.job.ts` itself. |

New infra this sprint (all in `apps/api`, none in this worker): `core/jobs/scheduled-job.ts` (contract + `lockKey`),
`core/jobs/scheduled-job.registry.ts` (`SCHEDULED_JOB_REGISTRY`), `core/jobs/jobs.runner.ts`
(`ScheduledJobsRunner`, wired into `CoreModule` next to `OutboxRelayRunner`), `core/jobs/date-window.ts` (pure
cadence-window helper), and `modules/payments/jobs/settlement-statements.cadence-job.ts`. See
`docs/adr/0001-monorepo-modular-monolith.md`'s amendment for the one-line rationale addition.
**[DEV-03 2026-07-23 DOC-DRIFT FIX]** this list omitted `modules/identity/jobs/kyc-expiry-reminders.cadence-job.ts`
(`KycExpiryRemindersCadenceJob`), which is real, git-dated the same sprint, and registered exactly like
the settlement-statements job above — added here for completeness (see the KYC-expiry row above for detail).

**S5 addendum**: `modules/payments/jobs/payout-execution.cadence-job.ts` (`PayoutExecutionCadenceJob`) added
per the two rows above — same `ScheduledJob`/`SCHEDULED_JOB_REGISTRY` infra, no changes to the core/jobs
host itself.

**[DEV-03 2026-07-23]** Continuous-run boot-proof (not just source-presence) added: a real `node dist/main.js`
boot against a migrated Postgres (embedded-postgres, all 65 migrations, `kv_relay` role logged in) confirmed —
(1) `OutboxRelayRunner` starting log: `outbox relay timer starting (interval=250ms, batch=10); registry has 49
event type(s)`; (2) `ScheduledJobsRunner` starting log: `scheduled-jobs runner starting 3 job(s): kyc-expiry-reminders,
settlement-statements, payout-execution` — exact match to the 3 cadence jobs documented in this file; (3) 4
outbox rows seeded mid-run (direct SQL insert, no manual dispatcher call) were each drained automatically within
one 250ms tick, 4 distinct `relayed 1 outbox event(s)` log lines with real, spaced timestamps (14:35:55/56/57/59);
(4) `SIGTERM` → the relay/jobs timers stopped immediately (a row seeded after the signal stayed `pending`
indefinitely, proving the timers themselves shut down cleanly) — see `Development_Program/dev03_report.md` for
full pasted evidence and one residual gap found (unrelated to this runtime: `CacheModule`/`REALTIME_PUBLISHER`'s
ad hoc `ioredis` clients have no real `onModuleDestroy` close call, so the overall **process** can outlive its
own graceful-shutdown window when Redis is unreachable — flagged, not fixed, out of this batch's scope).
