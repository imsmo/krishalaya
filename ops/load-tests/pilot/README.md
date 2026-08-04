# Pilot load-test gate (Sprint S5)

Calibrates the existing PRD-scale k6 suite (`ops/load-tests/*.js`) down to the **PILOT gate**: 25-50
real farmers in Junagadh, thin slice (auctions/dairy/fintech OFF), infra = 2-node EKS t3.medium,
Aurora Serverless 0.5-2 ACU, single Redis. Everything here was calibrated by reading the CURRENT
controllers/DTOs/feature-flag seeds in this repo, not assumed from the scripts' own comments — several
of those comments were stale (see "Patches made").

**k6 is not runnable in this environment** (no binary, no staging reachable). Nothing below has been
executed — the founder runs `run-pilot-gate.sh` against real staging.

---

## Per-script disposition

| Script | Disposition | Why |
|---|---|---|
| `k6-order-flow.js` | **NEEDS-PATCH** (patched) | VU model was PRD-scale (500 VUs); `/v1/market/pulse` call was broken (see below); had no checkout/payment coverage despite the filename. |
| `k6-realtime-sockets.js` | **NEEDS-PATCH** (patched) | Subscribed to a channel (`listings:public`) that doesn't exist in the gateway's channel grammar; VU model (2000-5000 sockets) is PRD-scale. |
| `soak-72h.js` | **NEEDS-PATCH** (patched) | `/healthz` is missing the `/v1` prefix (real bug — would 404 every iteration); VU count (300) / duration (72h) hardcoded, not reusable at pilot scale. Now env-overridable so the pilot gate's `--soak` flag reuses this same file instead of a fork. |
| `k6-payout-batch.js` | **EXCLUDE-AT-PILOT** | `POST /v1/payout-batches/run` does not exist anywhere in `apps/api` or `apps/admin-api`. Worse than a missing HTTP route: `PayoutBatchService.runBatch` has **zero live invocation path at all** in the current codebase — `WagePriorityLaneJob` (the only caller) is never registered in `payments.module.ts`'s job registry or in `apps/worker/src/registry.ts`; only an integration test calls it directly. This is a real product gap (flagged separately below, not fixed here — adding a production trigger endpoint is out of scope for load-test calibration). Also scale-irrelevant at pilot size: 25-50 farmers' weekly payouts are a handful of rows, nothing to load-test for `FOR UPDATE SKIP LOCKED` contention. |
| `k6-auction-burst.js` | **EXCLUDE-AT-PILOT** | `auctions` feature flag defaults **OFF** (`db/seeds/core/0009_feature_flags.sql`) and is explicitly OFF for the pilot thin slice. No live auction exists to bid against; 1000-VU thundering-herd burst is PRD-scale and meaningless against a module that's switched off. |
| `k6-mcc-morning-peak.js` | **EXCLUDE-AT-PILOT** | `dairy` feature flag defaults **OFF**, explicitly OFF for the pilot thin slice. Its request body is also stale against the current DTO (`memberId`/`quantityMl`/numeric `fatPct` vs. the real `membershipId`/`weightKg`(string)/`fatPct`(string)/required `collectedOn`+`snfPct` — `apps/api/.../dto/create-milk-collection.dto.ts`) — not worth patching a body for a module that's off at pilot. |
| `k6-billion-scale-model.js` | **EXCLUDE-AT-PILOT** | Not a load run — a capacity-projection calculator (`vus:1, iterations:1`, pure math + `console.log`). Irrelevant to a 25-50 farmer pilot; keep for post-pilot GA-scale capacity planning. |

**Included in the pilot gate:** `k6-order-flow.js`, `k6-realtime-sockets.js`, and `soak-72h.js` (only
under `--soak`) — run by `run-pilot-gate.sh`.

---

## How auth is handled (investigated, not assumed)

- Real flow: `POST /v1/auth/otp` → (staging-only) `devCode` in the response when `AUTH_EXPOSE_OTP=true`
  → `POST /v1/auth/verify {phone, code, tenantId}` → `{accessToken, refreshToken, expiresInSec: 900}`.
  Verified against `apps/api/src/modules/identity/controllers/v1/auth.controller.ts` +
  `services/auth.service.ts` + `core/config/app-config.ts:187` (the exact `AUTH_EXPOSE_OTP` resolution:
  explicit `true` required outside `NODE_ENV=test`; hard-blocked in prod by `assertProductionSecurity`).
- **k6 itself never does OTP logins.** Doing that per-VU would either exceed the `/v1/auth/otp` rate
  limit (5/60s/IP — all k6 traffic looks like one IP to the API) or, worse, imply sending OTPs to real
  numbers. Instead: `provision-loadtest-identities.mjs` (new, this directory) is a **one-time-per-staging-
  environment** Node script — the same "pre-provisioned test-user token" approach
  `scripts/staging-smoke/provision.md` documents for its single founder test user, extended here to a
  **pool** of N dedicated staging-only test identities:
  1. Logs each phone in `LOAD_TEST_PHONES` in via OTP+devCode (paced under the rate limit).
  2. Self-grants `farmer`+`customer` roles via `POST /v1/onboarding/roles` (KV-BL-066, self-serve,
     `selfserve_onboarding` flag — default ON) — no admin/SQL step needed for role grants (tenant
     creation itself is still SQL, per `provision.md`; reuse that tenant here).
  3. Seeds one high-stock published listing from the first identity (so the checkout stage in the gate
     never runs a listing out of stock mid-sustain).
  4. Writes `tokens.json` + prints a `TOKENS=...` line for `profile.env`.
- The k6 scripts accept the pool via `TOKENS=accessToken:refreshToken:userId,...` and round-robin
  `TOKENS[(__VU-1) % TOKENS.length]`. A one-shot refresh-on-401 (`POST /v1/auth/refresh`) is built into
  both patched scripts because the default access-token TTL is 900s (15 min,
  `env.validation.ts:24`) — shorter than sustain(10m)+spike(~3m)+drain(1m), and much shorter than the
  60-min soak variant.

---

## Money safety (read before running against staging)

Investigated `apps/api/src/modules/payments/services/payment.service.ts` directly:

- `POST /v1/payments` (`createIntent`) creates a `payment` row in status `initiated` + a gateway "order"
  (the sandbox gateway's is a deterministic fake, no network call, no money). **No ledger entry is
  created at this point** — `payment.service.ts:39-63`.
- A ledger entry is only ever posted inside `handleWebhook` on a `payment.captured` event
  (`payment.service.ts:82-97`), reachable only via `POST /v1/payments/webhooks/sandbox` (HMAC-signed,
  proven live in `scripts/pilot-e2e/flow.mjs:296-314`) or the real Razorpay webhook.
- **`k6-order-flow.js` calls `POST /v1/checkout` and `POST /v1/payments` (a bounded, `CHECKOUT_RATE`
  fraction of iterations) and NEVER calls any `/webhooks/*` route.** Grep the file — there is no
  `webhooks` string in it. No payment ever actually completes; no wallet/ledger balance moves; no real
  UPI is ever touched, because the sandbox gateway is the only one registered in a non-prod deployment
  (`app-config.ts:268`, `allowSandbox = !isProd`) and prod hard-fails if
  `PAYMENTS_DEFAULT_PROVIDER=sandbox` — so this script is structurally incapable of moving real money,
  but it must still only ever be pointed at staging. `run-pilot-gate.sh` refuses to run if
  `STAGING_API_URL` contains `api.krishalaya.com` (the prod host string) as a blunt extra guard.
- `online_payments` (default OFF) must be enabled on the pilot tenant for checkout to reach
  `payment_pending` at all — same flag `scripts/pilot-e2e/flow.mjs` and `scripts/staging-smoke/
  provision.md` already document turning on for exactly this reason.

---

## VU-model math

Pilot population: 25-50 real farmers, plus a thin buyer-side population reusing the same accounts in
this pilot (direct-sale model, no separate large buyer cohort yet) — call it **~50 distinct active
accounts** as the planning ceiling.

1. **Peak concurrency, not total population.** Not all 50 farmers touch the app in the same instant.
   Using a standard 20-40% same-window-activity assumption for a peak morning/market window (the kind
   of burst a WhatsApp/SMS nudge or a harvest-day rush would create): 50 × 0.3 ≈ **15 concurrent
   sessions**. Each k6 VU ≈ one open session pacing requests with think-time (`sleep(Math.random()*2)`
   between iterations), so VU count ≈ concurrent-session count, not concurrent-HTTP-request count.
2. **Rounding to a clean sustain target:** 15 → **20 sustain VUs** — sits inside the brief's stated
   ~10-30 VU range, erring slightly high for margin.
3. **Headroom (2-3x):** validates that a harvest-day surge, a marketing push, or simple bursty arrival
   doesn't immediately tip a 2-node t3.medium + Aurora 0.5-2 ACU stack over. 20 × 2.5 = **50 spike
   VUs** (`PILOT_SPIKE_VUS`).
4. **Realtime sockets:** one socket per active session watching their own order-status channel — same
   15-20 concurrent estimate, same 2.5x headroom → 20 sustain / 50 spike (`PILOT_RT_*_VUS`).
5. **Soak:** a lower steady load (not the spike number) run for longer (60 min) to catch connection-pool
   exhaustion / slow drift without presenting sustained peak pressure to a tiny Aurora Serverless
   floor (0.5 ACU) — **15 VUs** for 60 min (`PILOT_SOAK_VUS`/`PILOT_SOAK_DURATION`).
6. **Checkout fraction:** real buyer sessions are mostly browsing. `CHECKOUT_RATE=0.2` (20% of
   iterations) approximates a buyer that browses several times per purchase, and keeps a single seeded
   listing's stock (100,000 kg, arbitrary but large) from depleting mid-sustain even at the spike VU
   count over a 10-15 minute window.

All of the above are env-overridable in `profile.env` — the numbers are a documented starting point,
not hardcoded law.

---

## Thresholds chosen + rationale

| Threshold | Pilot value | PRD-scale value (unchanged, non-pilot mode) | Rationale |
|---|---|---|---|
| `http_req_duration p(95)` | **<800ms** | <500ms | Relaxed vs. PRD-scale to absorb Aurora Serverless v2 ACU scale-up lag (0.5→2 ACU) and shared t3.medium node contention — infra pilot load is far below what would saturate it, but scaling *events* themselves add latency spikes worth tolerating rather than false-failing on. |
| `http_req_duration p(99)` | **<2000ms** | <1500ms | Same reasoning, wider tail allowance for the rare ACU-scaling / cold-cache request. |
| `flow_errors` (check failure rate) | **<1%** | <1% | Unchanged — 1% is already a reasonable bar at any scale; a bug that fails 1-in-100 real farmer actions is worth catching regardless of population size. |
| `server_errors_5xx` (new custom counter) | **count==0** | n/a (new) | Explicit "no 5xx, ever" gate — a plain error-rate threshold can hide a small number of 500s inside acceptable noise; at pilot scale (real farmers, real trust-building), zero 5xx is the right bar and cheap to check for. |
| Soak `http_req_duration p(99)` | **<2500ms** | <2000ms | Slightly wider than the main gate's p99 — a 60-min sustained run on a 0.5-2 ACU floor is more likely to show a scaling event somewhere in the window; still fails on sustained degradation, not on one scaling blip. |
| Soak `http_req_failed rate` | **<1%** | <1% | Unchanged. |

---

## Patches made (S5-tagged in each file)

1. **`ops/load-tests/k6-order-flow.js`**
   - `GET /v1/market/pulse` was called with no auth and no `productId`; the real route
     (`apps/api/.../market-intel/controllers/v1/mandi-prices.controller.ts`) requires both (`AuthGuard`
     + a mandatory `productId` query param) and is gated by the `market_intel` flag (default OFF, not
     part of the pilot slice). The old `200 || 404` check was silently passing against what would
     actually be a 401. Fixed to be **opt-in** (`INCLUDE_MARKET_PULSE=false` by default) — skipped
     entirely at pilot.
   - Added the real checkout+payment-intent flow (cart add → `POST /v1/checkout` → `POST /v1/payments`),
     gated by `CHECKOUT_RATE`, with the money-safety boundary (never call the webhook) called out loudly
     in the file header.
   - Added `PILOT_MODE` stage/threshold overrides (PRD-scale defaults untouched when `PILOT_MODE` is
     unset/false).
   - Added `TOKENS` pool + refresh-on-401 (see "How auth is handled").
2. **`ops/load-tests/k6-realtime-sockets.js`**
   - `channel: 'listings:public'` does not exist in `apps/realtime-gateway/src/channels/contract.ts`'s
     grammar (only `t:<tenant>:auction:<id>`, `t:<tenant>:u:<user>:orders`, `t:<tenant>:mcc:<id>` parse)
     — every channel is tenant-scoped, there is no public/anonymous channel. The old script's WS
     handshake (101) still succeeded (auth is at connect, via JWT) but the subscribe message would have
     silently received `subscribe_denied` — the check only asserted the handshake, so the script was
     green while testing nothing past connect. Fixed to subscribe to the caller's own
     `t:<TENANT_ID>:u:<userId>:orders` channel (the only pilot-reachable channel kind — `auction` needs
     the OFF `auctions` flag, `mcc` needs the `dairy.manage` permission on an OFF module).
   - Added `TOKENS` pool (with `userId` needed to build the own-order channel) + `PILOT_MODE` VU-stage
     override (2000-5000 sockets → 20 sustain / 50 spike at pilot).
3. **`ops/load-tests/soak-72h.js`**
   - `${BASE}/healthz` was missing the `/v1` prefix — `apps/api/src/main.ts` sets
     `defaultVersion: '1'` globally, so the real route is `/v1/healthz` (confirmed against
     `scripts/pilot-e2e/flow.mjs`, which calls `/v1/healthz` and is a proven-passing script). This was a
     real bug independent of pilot scope — every soak iteration's health check was 404ing.
   - Added `VUS`/`DURATION`/`SOAK_P99_MS`/`SOAK_ERR_RATE` env overrides (defaults unchanged: 300 VUs /
     72h) so `run-pilot-gate.sh --soak` reuses this file at pilot scale instead of forking a new one.

---

## Quality Gates mapping (§6, `Development_Program/00_DEVELOPMENT_MASTER_PLAN.md`)

This README does not modify the master plan. For reference, here's which pilot-gate threshold
satisfies which §6 gate row (verbatim gate names from that file):

| §6 Gate | Satisfied by |
|---|---|
| **k6 baseline** — "`ops/load-tests/*` run against staging at pilot-projected load" | `run-pilot-gate.sh` (this directory), run by the founder against real staging. The "pilot-projected load" is the VU-model math above. |
| **Manual pilot script** — "OTP login → onboard farmer → list produce → buyer order → wallet credit → payout → notification received → support ticket opened" | NOT this gate — that's `scripts/pilot-e2e/flow.mjs` (already proven, per Sprint S3/S4). This k6 gate only proves the same flow HOLDS UNDER CONCURRENT LOAD, not that it's functionally correct end-to-end. |
| **RLS gate**, **Ledger invariants**, **CI green**, **ZAP clean** | Untouched by this work — see their own tooling (`verify-rls-coverage.js`, reconciliation job assertions, `pnpm test`, `dast-zap.yml`). |

The master plan's line "No release proceeds to the next environment (staging→prod) without all six
green in that environment" still applies — this k6 pilot gate is one of the six, not a replacement for
the others.

---

## Setup — one time per staging environment

1. Provision the pilot tenant (`scripts/staging-smoke/provision.md` Part B) if not already done.
2. Confirm `online_payments` and `selfserve_onboarding` flags are enabled for the tenant
   (`provision.md` Part A covers `online_payments`; `selfserve_onboarding` defaults ON already).
3. Temporarily set `AUTH_EXPOSE_OTP=true` on the staging api deployment.
4. Run the identity/listing provisioning helper:
   ```bash
   STAGING_API_URL=https://api.staging.krishalaya.com \
   TENANT_ID=11111111-0000-7000-8000-000000000001 \
   LOAD_TEST_PHONES=+919800000001,+919800000002,+919800000003,+919800000004,+919800000005 \
   CATALOGUE_PRODUCT_ID=<a products.id under the crops category in this tenant> \
   node ops/load-tests/pilot/provision-loadtest-identities.mjs
   ```
   Copy the `TENANT_ID=`, `LISTING_ID=`, `TOKENS=` lines it prints into `profile.env`.
5. Turn `AUTH_EXPOSE_OTP` back off on staging (it's a standing "read the OTP back" affordance and
   shouldn't be left on).

## Runner usage

```bash
cd ops/load-tests/pilot
cp profile.env.example profile.env   # fill in STAGING_API_URL, TENANT_ID, TOKENS, LISTING_ID
./run-pilot-gate.sh                  # ramp -> sustain(10m) -> spike(2x, 2m) -> drain
./run-pilot-gate.sh --soak           # ... plus a 60-min pilot-scale soak afterwards
./run-pilot-gate.sh --env-file /path/to/alt.env --soak
```

Each run writes `results/<UTC-timestamp>/{order-flow,realtime-sockets,soak}.summary.json` (raw k6
`--summary-export` output) and prints a pass/fail table with p95/p99/error-rate/5xx-count per script.
Exit code is non-zero if any included script failed its thresholds.
