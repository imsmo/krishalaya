# Local-full-stack smoke suite — DEV-32 deliverable

The THIRD sibling in this repo's smoke-script family:

| | `scripts/pilot-e2e/` | `scripts/local-smoke/` (this one) | `scripts/staging-smoke/` |
|---|---|---|---|
| Target | api booted by `run.sh` itself (docker Postgres+Redis) | **any already-running** real `apps/api` process (`BASE_URL`) — this batch booted it against an **embedded Postgres** (no docker available in this sandbox), per `DEV-32_PILOT_SCRIPT_v1.0_EXECUTION_LOG.md` | a real deployed staging cluster |
| Outbox relay | manual one-shot tick (`relay-tick.mjs`) — S0-era finding, before S1 wired the timer | **none needed** — polls and waits for the live `RELAY_ENABLED` timer (KV-BL-063), same as staging-smoke | same — polls and waits |
| OTP | `AUTH_EXPOSE_OTP=true`, devCode read from the response | same (devCode) — **disclosed**: this is the local/dev degrade path, not a real-SMS proof | real SMS, human types the code |
| Payment | sandbox gateway + a script-forged HMAC-signed webhook | same (sandbox gateway) — **never real money** | real Razorpay, real UPI, capped at ₹1 |
| Extra checks vs both siblings | — | **flag-OFF module honesty** (insurance invisible, not 500), **RLS spot probe** (2 seeded tenants, spoofed `x-tenant-id` header must not redirect the query), **webhook-signature rejection probe** (forged signature → 401) — none of these existed in either sibling before DEV-32 | — |
| Writes/destructive ops | provisioning only (idempotent `ON CONFLICT`); the `insurance` flag-OFF check reads, never flips, unless it finds the flag already ON — then it refuses to run without `--allow-writes` | | |

## Honesty label

This suite proves the pilot loop against a **local full-stack** boot — a real, unmodified NestJS
`apps/api` process, compiled/run the normal way (`ts-node src/main.ts`), listening on real HTTP,
backed by a real (if embedded/throwaway) Postgres, with the real outbox-relay and scheduled-jobs
timers running exactly as they do in any other environment. **It is not a staging proof** — no cloud
infra, no real SMS/UPI provider, no TLS. `scripts/staging-smoke/` remains the only suite that proves
the real-provider round trips (real SMS, real ₹1 UPI). See `KRISHI_VERSE_MASTER_CONTEXT.md` §7c and
`Development_Program/dev32_report.md` for the full DEV-32 disclosure of what ran where.

## Usage

```bash
export DATABASE_ADMIN_URL="postgres://postgres:postgres@localhost:55432/krishi_dev"   # owner conn, for one-time provisioning only
export BASE_URL="http://localhost:3000"                                              # default if unset
node scripts/local-smoke/smoke.mjs
```

Flags:
- `--allow-writes` — required only if the `insurance` feature flag is found already ON in the target
  DB (check 6 needs it OFF to prove the honest-degrade path); the suite refuses to silently flip a
  flag without this flag.
- Read-only by default otherwise: every other check either reads or performs the SAME idempotent
  sandbox-money round-trip pilot-e2e already proves safe to repeat (a fresh listing/order each run,
  no teardown required, no cross-run interference beyond accumulating rows — same disclosed
  convention as `pilot-e2e/flow.mjs`).

Exit code 0 = 0 failures (SKIPs are not failures); non-zero = at least one FAIL — see the printed
`[n] PASS|FAIL|SKIP` per-check log and the summary line.

## What each check proves

1. **Health + readiness** — the booted process answers and its DB pool is up.
2. **Auth OTP request path** — OTP round-trip mints a real JWT; disclosed as the local devCode path
   (no real SMS provider reachable from this sandbox — see `scripts/staging-smoke/` for that proof).
3. **Tenant-scoped listing CRUD** — create → publish → fetch, RLS-scoped throughout.
4. **Order happy path** — cart → checkout → payment intent → signed sandbox webhook → the LIVE outbox
   relay timer auto-confirms the order (no manual tick, unlike `pilot-e2e`) → fulfil → complete →
   notification fan-out, also auto-drained.
5. **Wallet read** — the seller's own balance + ledger reflect the completed order.
6. **Flag-OFF module honesty** — `GET /v1/insurance/products` with the `insurance` flag OFF (its seeded
   default) returns 404 (invisible), never a 500 — proves `FeatureFlagGuard`'s degrade-never-die
   contract for real, not just by reading the source.
7. **RLS spot probe** — a request carrying a *different* tenant id in `x-tenant-id` while authenticated
   with a token scoped to tenant A cannot redirect the query to read tenant B's (or leak tenant A's)
   order data — tenant scoping is resolved from the verified JWT claim, never a client-supplied header
   alone (Golden Law 1).
8. **Webhook signature rejection probe** — a forged `x-webhook-signature` is rejected with 401
   (`WebhookSignatureError`, fail-closed), never silently accepted.

## Provisioning

Same constraint as `scripts/pilot-e2e/` and `scripts/staging-smoke/provision.md`: there is still no
self-serve `POST /v1/tenants` or admin-bootstrap-free role grant endpoint in this codebase (confirmed
again at DEV-32) — the suite provisions 2 tenants + 3 users + 1 product directly via `DATABASE_ADMIN_URL`
(idempotent `ON CONFLICT DO NOTHING`), then does everything else over real HTTP.
