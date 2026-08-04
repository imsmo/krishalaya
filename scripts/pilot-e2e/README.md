# Pilot E2E — Sprint S0 deliverable

One command that proves the Krishalaya pilot slice works, end to end, on your own machine:

```
OTP login -> onboard farmer + buyer -> create + publish listing -> buyer orders (direct sale)
  -> wallet credit/escrow -> payout (stub provider) -> notification recorded
```

## TL;DR

```bash
scripts/pilot-e2e/run.sh
```

Add `--keep` to leave Postgres/Redis and the api running afterwards (useful for poking around
manually with `curl` once the script finishes).

## What it actually does

1. **Checks prerequisites**: `docker`, `docker compose` (v2 plugin), `node` (>=20), `pnpm`.
2. **Boots Postgres + Redis** via `apps/api/docker-compose.dev.yml` (a real, already-working
   compose file with uncommented `postgres:16` + `redis:7` services — the *root*
   `docker-compose.yml` has its own postgres/redis blocks commented out, so this script
   deliberately targets the api's own compose file instead of trying to fix that one).
3. **Migrates** (`pnpm migrate`, as the Postgres owner) and **grants LOGIN** to the `kv_app` /
   `kv_wallet` / `kv_relay` roles the migrations create as `NOLOGIN` (mirrors
   `db/local/local-login-roles.sql`, done here via `scripts/pilot-e2e/grant-login.mjs` so you don't
   need the `psql` CLI installed).
4. **Seeds** core + rules + catalogue reference data only — **not** `--demo** (`pnpm seed`, no
   `--demo` flag; the pilot tenant/users/product below are created fresh by the flow script itself,
   not from the staging-only demo seed).
5. **Starts the api** in dev mode (`pnpm --filter api start:dev`) in the background, waits for
   `GET /v1/readyz`.
6. Prints a **loud warning** about the outbox relay (see below), then
7. **Runs the flow** (`scripts/pilot-e2e/flow.mjs`) and prints a PASS/FAIL summary per step.
8. **Tears down** (kills the api process, `docker compose down`) unless you passed `--keep`.

## Files in this directory

| File | Role |
|---|---|
| `run.sh` | Orchestrator — infra up, migrate+seed, start api, run the flow, tear down. |
| `flow.mjs` | The actual HTTP flow (Node's built-in `fetch`, no new deps) + the one bit of direct-SQL seeding (tenant/users/roles — see "Onboarding" below). |
| `relay-tick.mjs` | Thin launcher for a **one-shot** outbox relay drain (see "Why a manual relay tick"). |
| `grant-login.mjs` | Gives `kv_app`/`kv_wallet`/`kv_relay` a LOGIN password locally (no `psql` needed). |
| `../../apps/api/src/modules/payments/pilot-e2e/relay-tick.ts` | The actual relay-tick implementation (new file; no existing source was modified). |

## The flow, step by step (verified against the controller source)

| # | Step | Endpoint |
|---|---|---|
| 0 | Onboard farmer + buyer | direct SQL (see below — no self-serve endpoint exists yet) |
| 1 | Health check | `GET /v1/healthz` |
| 2 | Readiness | `GET /v1/readyz` |
| 3 | OTP login — farmer | `POST /v1/auth/otp` -> `POST /v1/auth/verify` |
| 4 | OTP login — buyer | `POST /v1/auth/otp` -> `POST /v1/auth/verify` |
| 5 | Create listing | `POST /v1/listings` (`ListingsController.create`, `apps/api/src/modules/listings/controllers/listings.controller.ts`) |
| 6 | Publish listing | `POST /v1/listings/:id/publish` |
| 7 | Verify listing is public | `GET /v1/listings/:id` |
| 8 | Buyer adds to cart | `POST /v1/cart/items` (`CartsController`, `.../orders/controllers/v1/carts.controller.ts`) |
| 9 | Buyer checks out (direct sale) | `POST /v1/checkout` (`CheckoutController`, `.../orders/controllers/v1/checkout.controller.ts`) — order starts `payment_pending` because `online_payments` is on |
| 10 | Create payment intent | `POST /v1/payments` (`PaymentsController`, `.../payments/controllers/v1/payments.controller.ts`) |
| 11 | Simulate payment success | `POST /v1/payments/webhooks/sandbox` (HMAC-signed, `SandboxGateway`) |
| 12 | **Relay tick #1** | `payments.payment_succeeded` -> order `confirmed`, escrow credited |
| 13 | Verify order confirmed | `GET /v1/orders/:id` |
| 14 | Seller fulfils order | `POST /v1/orders/:id/packed` -> `/ready` -> `/delivered` |
| 15 | Buyer confirms receipt | `POST /v1/orders/:id/complete` (emits `orders.order_completed`) |
| 16 | **Relay tick #2** | escrow released to seller wallet + notification fan-out |
| 17 | Seller requests payout | `POST /v1/payouts` (stub `SandboxPayoutGateway`) |
| 18 | Notification recorded | `GET /v1/notifications` |

There is no `orderType`/`saleType` request field for "direct sale" specifically — every order placed
through cart -> `POST /v1/checkout` is a direct-sale order (`orders.source = 'direct'`, set
server-side); auctions/RFQ orders are created by different flows entirely.

## Dev-mode OTP

`apps/api/src/core/auth/otp.service.ts` + `.../identity/services/auth.service.ts`: there is **no
fixed OTP code**. The real, randomly-generated code is returned in the `POST /v1/auth/otp` response
as `data.devCode`, but **only** when `config.auth.exposeOtp` is true — which requires
`AUTH_EXPOSE_OTP=true` (or `NODE_ENV=test`). `run.sh` sets `AUTH_EXPOSE_OTP=true` when it starts the
api. If you start the api yourself instead of via `run.sh`, make sure that env var is set or
`flow.mjs`'s "devCode present" assertion will fail. In dev mode the OTP is also printed to the api
log by `core/auth/sms.noop.ts` (`[dev SMS] ...`) if you want to eyeball it instead.

## Onboarding: why direct SQL, not an HTTP call

There is no self-serve `POST /v1/farmers`, `/v1/buyers`, or `/v1/onboarding/*` endpoint in this
codebase today. Becoming a "farmer" or "buyer" (`customer`) is a row in `user_tenant_roles`; the
only HTTP path that writes one is `POST /v1/rbac/assignments`, which requires the caller to already
hold `identity.approve` — i.e. an admin bootstrapping someone else, not a self-serve signup. The
repo's own integration tests hit the same wall and solve it the same way we do here: insert
tenant/user/role rows directly through a privileged pg connection (see
`apps/api/test/helpers/fixtures.ts`'s `makeTenant`/`makeUser`, and
`apps/api/test/e2e/bootstrap.ts`'s `enableFlag()` for the feature-flag pattern this script reuses).
`flow.mjs`'s first step does exactly that — tenant, farmer user, buyer user, their tenant-roles, a
farmer bank account (for the payout step), and turning on the `online_payments` + `communication`
feature flags (both seeded **off** by default in `db/seeds/core/0009_feature_flags.sql`). Every step
after that is a genuine HTTP call, including the OTP login itself — the pre-seeded phone numbers
just let the JWT come back with the right permissions on first login (permissions are computed
server-side from `user_tenant_roles` at login time, never trusted from the client).

## Why a manual relay tick (the S0 finding this script works around)

`apps/api/src/core/outbox/relay.poller.ts` exports `runRelay()`, but **nothing in this repo calls it
at runtime**. `apps/worker`'s `outbox-gauge` job only *measures* the pending backlog — see
`apps/worker/src/jobs/outbox-gauge.job.ts` and `apps/worker/WORKER-RUNTIME.md` ("⛔ Deferred:
domain-handler jobs"), which says outright that running each event's handler
(`OutboxHandlerRegistry`) "requires the api domain" and is an open decision (tracked as
`P0-9-follow-on`). Until S1 makes that call and wires a permanent timer, **payment_succeeded never
turns into an order confirmation, escrow never releases, and notifications never fan out** — no
matter how long you wait, in dev, staging, or production, as the codebase stands today.

`run.sh` prints a large warning banner about this before running the flow. `flow.mjs` calls
`relay-tick.mjs` explicitly at the two points where the relay would normally have to have run
(after the payment webhook, and after the buyer marks the order complete).

**Mechanism chosen, and why** (three options were on the table):

1. *Import the compiled dispatcher into a plain `.mjs`* — rejected. The dispatcher and its handlers
   are TypeScript with decorator metadata; there's no stable compiled-JS module surface for a
   script outside `apps/api` to import.
2. *`node --conditions` against `apps/api/dist`* — rejected. The production build
   (`tsc -p tsconfig.build.json`) is not a published/stable import target, and requires a full build
   step first.
3. **`pnpm --filter @krishalaya/api exec ts-node <file>.ts` — chosen.** `ts-node` is already a
   *devDependency* of `@krishalaya/api` (`apps/api/package.json`) — no new package was added
   anywhere. The implementation is a **new file**,
   `apps/api/src/modules/payments/pilot-e2e/relay-tick.ts` (no existing source touched), which
   copies the exact hand-wired dependency graph already proven in
   `apps/api/src/modules/payments/__tests__/orders-payments-e2e.integration.spec.ts` (that jest spec
   constructs `OutboxDispatcher` + `OutboxHandlerRegistry` + handlers with `new`, against a raw `pg`
   `Pool` — no Nest DI bootstrap required), and additionally registers the communication module's
   `DomainEventFanoutHandler` for every entry in `notification-event-map.ts` so the "notification
   recorded" step has something to observe. `scripts/pilot-e2e/relay-tick.mjs` is only a thin
   `child_process` launcher for it — it was type-checked clean with
   `tsc --noEmit` against `apps/api`'s own `tsconfig.json` compiler options during development of
   this script.

**This is a stand-in for the local proof only.** S1 must make the outbox relay run continuously —
see the three options in `apps/worker/WORKER-RUNTIME.md`'s "Deferred: domain-handler jobs" section.

## Prerequisites (what the founder needs installed)

- Docker + the `docker compose` v2 plugin (`docker compose version` must work).
- Node.js >= 20 (see the repo's `.nvmrc`).
- `pnpm` (`packageManager` pin in the root `package.json`; `corepack enable` gets you the right
  version automatically).
- Nothing else — no `psql` CLI required (the login-grant step uses `pg` via Node instead), and no
  new npm packages are installed by this script anywhere in the workspace.

## Known repo gap this script works around (flagging, not silently hiding)

`apps/api/src/main.ts` does `import 'dotenv/config'`, but `@krishalaya/api` does **not** declare
`dotenv` as a dependency (checked: absent from `apps/api/package.json` and from the `apps/api`
importer section of `pnpm-lock.yaml`). With `.npmrc`'s `shamefully-hoist=false`, that import throws
`MODULE_NOT_FOUND` on a strict `pnpm install` — i.e. **the api cannot boot via `ts-node src/main.ts`
today** unless something papers over it. `run.sh` detects this and symlinks the already-resolved
`dotenv` package (other workspace apps — `worker`, `wallet-service`, etc. — already depend on it)
into `apps/api/node_modules/dotenv`. No `package.json` was touched by this script or this fix; it's
an install-time link, not a source edit. **This should be fixed properly** (add `dotenv` to
`apps/api/package.json`'s dependencies) as part of the repo-hygiene track of this sprint — flagging
it here rather than leaving it silently patched.

## Troubleshooting

- **Ports already in use (5432 / 6379 / 3000)** — something else on your machine is already
  listening. Stop it, or edit the port mappings in `apps/api/docker-compose.dev.yml` / re-run with a
  different `PORT` (you'll need to adjust `PILOT_API_BASE` in `run.sh` to match).
- **`devCode present` assertion fails in step 3/4** — the api wasn't started with
  `AUTH_EXPOSE_OTP=true`. If you started the api yourself instead of letting `run.sh` do it, set that
  env var.
- **`api never became ready`** — check the tail of `/tmp/kv-pilot-e2e-api.log` (printed
  automatically by `run.sh` on this failure). Common causes: Postgres roles don't have LOGIN yet
  (re-run `node scripts/pilot-e2e/grant-login.mjs postgres://postgres:postgres@localhost:5432/krishi_dev`),
  or the `dotenv` workaround above didn't apply cleanly (run `pnpm install` at the repo root first).
- **A step fails with `HTTP 403`** — almost always a missing feature flag or permission. This
  script turns on `online_payments` and `communication` (both OFF by default); if you've modified
  the seed data, make sure those flags are still enabled for the pilot tenant.
- **Relay tick step fails / times out** — check that `pnpm` is on `PATH` inside the subprocess (the
  launcher shells out to `pnpm --filter @krishalaya/api exec ts-node ...`); run
  `pnpm --filter @krishalaya/api exec ts-node --version` manually to confirm it resolves.
- **Re-running repeatedly against the same machine** — every run creates a brand-new tenant +
  farmer + buyer with fresh random phone numbers, so OTP rate limits (`OTP_REQUEST_MAX_PER_HOUR`,
  `OTP_VERIFY_MAX_PER_HOUR` — `apps/api/src/core/auth/otp.service.ts`) never accumulate across runs.
- **Leftover containers/processes after a crash** — `docker compose -f apps/api/docker-compose.dev.yml down`
  and `kill $(cat /tmp/kv-pilot-e2e-api.pid)` clean up manually.

## S1 note

Once S1 wires the permanent outbox relay timer (in the api process, the worker, or via a bus +
consumer — see the three options above), `relay-tick.mjs`/`relay-tick.ts` become unnecessary for a
*running* environment; they can stay as a useful manual "flush now" tool for local debugging, or be
deleted. The two `⚠️ RELAY TICK` steps printed by `flow.mjs` are the exact two points in the flow
where a real deployment would rely on the timer instead of a manual call.
