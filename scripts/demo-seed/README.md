# Demo seed — "make the app look like a real application"

One command that fills the founder's own demo tenant (`demo-fpo`) with **genuinely valid** data —
real listings, real orders in three different states, a real wallet balance with real ledger
entries, and a real (queued) payout — by driving the same HTTP APIs the mobile app uses. Nothing is
hand-inserted into the database.

```bash
node scripts/demo-seed/run.mjs
```

## Why this exists (and why `db/local/demo-design-data.sql` couldn't do it)

The founder's ask was simple: "add dummy data so the app displays like a real application." The
existing `db/local/demo-design-data.sql` looked like it should cover this, but it can't, because the
money-shaped tables it would need to touch are **invariant-protected**:

- **`orders`** is uuidv7-partitioned and PRUNE-checked — a hand-picked id breaks partition routing.
- **The wallet ledger is hash-chained and zero-sum** — a nightly reconciliation job verifies this;
  a hand-inserted credit with no matching debit (or a broken hash chain) fails reconciliation.
- **Bids are immutable**, **escrow release is a server-computed side effect of a real event**, not a
  column you can set.

`demo-design-data.sql` also predates money entirely (no `price_minor`, no `order_items`, no wallet
rows) — see its new header comment, added by this same change, marking it **deprecated for
app-flow testing** (it's still fine as a design-preview-only fixture; see that file).

This script instead does what `scripts/pilot-e2e/flow.mjs` already proved works for the pilot slice:
log in for real, call the real endpoints, and let the real domain logic (checkout, payment webhook,
escrow release, wallet ledger) produce rows that are correct by construction.

## Prerequisites

1. **The api is running locally** (`pnpm --filter api start:dev` or via `scripts/pilot-e2e/run.sh`'s
   infra step), reachable at `http://localhost:3000` (override with `DEMO_API_BASE`).
2. **`AUTH_EXPOSE_OTP=true`** on the api process — the dev OTP is read back from
   `POST /v1/auth/otp`'s `data.devCode` (see `apps/api/src/core/auth/otp.service.ts` +
   `identity/services/auth.service.ts`). No real SMS is sent.
3. **`EKYC_PROVIDER_KIND=sandbox`** on the api process — this binds `SandboxEkycProvider`
   (`apps/api/src/modules/identity/gateway/sandbox-ekyc.provider.ts`), which accepts a fixed OTP
   (`123456`) instead of a live eKYC callback. Never available in production
   (`assertProductionSecurity` refuses to boot with this in `NODE_ENV=production`).
4. **`DATABASE_ADMIN_URL`** (or `DATABASE_URL`) set in the api's environment — needed by the manual
   outbox relay tick this script shells out to (see "Why a manual relay tick" below). Same
   requirement `scripts/pilot-e2e/flow.mjs` documents.
5. **Migrations + core/rules/catalogue seeds have run** (`pnpm migrate && pnpm seed`), **and the
   `--demo` seed has run at least once** (`pnpm seed --demo`) so the `demo-fpo` tenant
   (`88888888-0000-7000-8000-000000000001`) exists — this is the SAME tenant
   `apps/mobile/.env`'s `EXPO_PUBLIC_TENANT_ID` points at, and the same tenant the founder already
   logs into as `+91 9900000101` per `docs/local-setup/08-make-the-demo-work.md`. If you've done
   that runbook already, this is done.
6. **Feature flags ON for this tenant**: `online_payments` (default **OFF** —
   `db/seeds/core/0009_feature_flags.sql` — must be flipped on; `selfserve_onboarding` and `kyc` are
   already ON by default). Flip it once:
   ```bash
   psql "$KV_DB" -c "UPDATE feature_flags SET is_enabled=true, rollout_pct=100 WHERE key='online_payments';"
   ```
   (Same `$KV_DB` convention as `docs/local-setup/08-make-the-demo-work.md`.)
7. **MinIO/S3 is optional** — this script never uploads listing photos (no `mediaIds`), so media
   storage doesn't need to be running.
8. No new npm packages: only Node's built-in `fetch`/`crypto`/`child_process` — same footprint as
   `scripts/pilot-e2e/flow.mjs`.

## What gets created

| # | What | How | Idempotent? |
|---|---|---|---|
| 1 | 3 personas logged in / onboarded | `POST /v1/auth/otp` → `POST /v1/auth/verify` → `POST /v1/onboarding/roles` | Yes — verify reuses the existing `users` row by phone; the role grant is a documented no-op if already granted (KV-BL-066) |
| 2 | Ramesh's sandbox eKYC (Aadhaar) | `POST /v1/kyc/ekyc/start` → `POST /v1/kyc/ekyc/verify` | Yes — skipped if a `verified` aadhaar session already exists (`GET /v1/kyc/ekyc/sessions`) |
| 3 | Ramesh's payout bank account (UPI) | `POST /v1/bank-accounts` | Yes — skipped if any bank account already exists (`GET /v1/bank-accounts`) |
| 4 | 4 listings (wheat/groundnut/onion/chilli) | `GET /v1/products?q=` (catalogue search) → `POST /v1/listings` → `POST /v1/listings/:id/publish` | Yes — matched/reused by exact **title** via `GET /v1/listings?mine=true&q=` before creating anything |
| 5 | 3 orders in 3 states (see below) | cart → checkout → payment webhook → order transitions | **No** — each run places 3 NEW orders (see "Limits" below) |
| 6 | Ramesh's wallet balance + ledger | real escrow release off order (c) completing | N/A (read-only verification step) |
| 7 | 1 payout request | `POST /v1/payouts` | **No** — each run withdraws the then-current available balance |

### The canon data (design-canon prices — `docs/design-data/SCREEN-DATA-CATALOG.json`)

| Listing | Price | Qty | Sale type | Note |
|---|---|---|---|---|
| Premium Wheat — Lokwan | ₹2,880/qtl | 50 qtl | direct | |
| GG-20 Groundnut | ₹6,180/qtl | 25 qtl | direct | |
| Onion — Medium Grade | ₹1,450/qtl | 10 qtl | direct | |
| Red Chilli — Teja (Organic) | ₹14,500/qtl | 2 qtl | direct | **Degrades** to the nearest catalogue product (crops.spices) if "chilli" isn't in `db/seeds/catalogue/0103_launch_crops_30.sql`'s launch-30 set — the script never invents a product row; it searches `GET /v1/products?q=chilli` first and only falls back if that's empty, logging a note either way |

### The three orders (all placed by Anand Stores against Ramesh's listings)

| Order | Listing / qty | Flow | Final state |
|---|---|---|---|
| (a) | Wheat, 5 qtl (₹14,400 — matches the exact canon line in `SCREEN-DATA-CATALOG.md`: *"Buyer Anand Stores confirmed order ... for 5 quintal wheat at ₹2,880/qtl ... Payment pending"*) | `cart` → `checkout` only | **`payment_pending`** |
| (b) | Groundnut, 2 qtl (₹12,360) | `checkout` → `payments` intent → sandbox webhook → relay tick → `packed` → `ready` | **`ready`** (the closest real status to "in transit/shipped" — see note below) |
| (c) | Onion, 10 qtl (₹14,500) | `checkout` → `payments` intent → sandbox webhook → relay tick → `packed` → `ready` → `delivered` → `complete` → relay tick (escrow release) | **`completed`** — Ramesh's wallet balance + ledger now show real earnings |

**On "in transit/shipped":** this codebase's real transition endpoints are
`packed` → `ready` → `delivered` → `complete` (`apps/api/src/modules/orders/controllers/v1/orders.controller.ts`)
— there is no separate `shipped`/`in_transit` endpoint. Order (b) is deliberately left at `ready`
(packed + ready for dispatch, not yet delivered) as the closest real analogue.

## Why a manual relay tick (reused from `scripts/pilot-e2e/`)

`apps/api/src/core/outbox/relay.poller.ts` isn't wired to run on a timer yet (see
`scripts/pilot-e2e/README.md`'s "Why a manual relay tick" for the full story) — nothing turns
`payments.payment_succeeded` into an order confirmation, or `orders.order_completed` into an escrow
release, unless something drains the outbox. This script shells out to the *exact same*
`scripts/pilot-e2e/relay-tick.mjs` (no new file, no duplicated logic) after the payment webhook and
after order (c) completes.

## The KYC gate (why eKYC has to happen before the bank account and the payout)

Two S3-review findings gate money-out on verified KYC:
`PayoutService.requestPayout` (`payout-kyc-gate.spec.ts`) and `BankAccountService.add`/
`addFullBankAccount` (`bank-account-kyc-gate.spec.ts`) both reject with a 403
(`KycRequiredError`/`BankAccountKycRequiredError`) unless the caller has
`user_tenant_roles.kyc_status='verified'` on an active role. `POST /v1/kyc/ekyc/verify`'s success
path (`EkycService.verify`) is what flips that column — so this script always does eKYC **before**
adding a bank account or requesting a payout. The sandbox eKYC uses the same Verhoeff-valid test
Aadhaar (`999999990019`) the repo's own integration test trusts
(`apps/api/src/modules/identity/__tests__/ekyc-cycle.integration.spec.ts`), and the same fixed OTP
(`123456`, `SANDBOX_EKYC_OTP` in `sandbox-ekyc.provider.ts`).

## The payout stays "queued" — that's expected

`POST /v1/payouts` reserves the wallet funds and queues the payout; actual disbursement is driven by
`PayoutExecutionCadenceJob`, which runs **every 5 minutes inside the api process**
(`apps/api/src/modules/payments/jobs/payout-execution.cadence-job.ts`) against the sandbox payout
gateway. If the api keeps running for 5+ minutes after this script finishes, the payout will flip
`queued` → `processing` → paid on its own. Poll `GET /v1/payouts/:id` (or the app's payout-history
screen) to watch it. This script does not add a manual trigger for that job — it's already wired to
run continuously, unlike the outbox relay.

## The three login phones

| Persona | Role | Phone | Notes |
|---|---|---|---|
| Ramesh Patel | farmer | `+91 9900000101` | The founder's existing login. Owns all 4 listings + the 3 orders as seller. eKYC-verified, has a payout bank account. |
| Anand Stores | buyer (customer) | `+91 9900000201` | Places all 3 demo orders. |
| Meera Ben Patel | second farmer | `+91 9900000301` | Onboarded only (farmer role) — a second real farmer identity in the tenant for future stories; this script doesn't give her listings (not asked for). |

Dev OTP: this script reads `devCode` back from `POST /v1/auth/otp` automatically
(`AUTH_EXPOSE_OTP=true` required). To sign in manually from the app/Postman instead, request an OTP
for the phone and check the api log (`[dev SMS] ...`, `core/auth/sms.noop.ts`) or the same
`devCode` field.

## Idempotency / re-running

Safe to re-run any time:
- **Personas** — reused by phone (users are global, matched at `POST /v1/auth/verify`); the role
  grant is a documented no-op if already granted.
- **eKYC / bank account** — skipped if already verified / already on file.
- **Listings** — reused by exact title match (`GET /v1/listings?mine=true&q=<title>`); a `draft`
  match gets published, a `published` (or `sold_out`) match is left as-is.
- **Orders — NOT idempotent, by design.** Every run places 3 *new* orders (`orders.orderNo` is
  always fresh). This mirrors real usage (a farmer's order history is supposed to grow) and is
  explicitly called out, not hidden. Repeated runs will also draw down the fixed listing quantities
  (Onion's 10 qtl in particular is fully consumed by ONE run of order (c) — a second run's order (c)
  will find it sold out and skip with a note, not fail the whole script).
- **Payout** — a fresh payout request each run, for whatever the wallet's available balance is at
  that moment (`0` after nothing has completed → skipped with a note).

### `--reset`? Not provided (on purpose)

There's no flag to wipe and restart clean. Tearing down three phone numbers' worth of data cleanly
means walking `orders` → `order_items` → `payments` → `wallet_ledger_entries`/`wallet_accounts` →
`payouts` → `kyc_documents`/`ekyc_sessions` → `bank_accounts` → `user_tenant_roles` → `users` in FK
order across two databases (`krishiverse` + the wallet-service's own `kv_wallet`) — non-trivial
enough that getting it wrong (deleting a hash-chained ledger row out of order, say) is worse than
not offering it. If you want a truly fresh demo tenant, the safe option is a full local Postgres
reset (drop + recreate `krishiverse` and `kv_wallet`, re-migrate, re-seed) rather than a partial
psql teardown — see `docs/local-setup/` for that sequence.

## Troubleshooting

- **`No devCode in /v1/auth/otp response`** — the api wasn't started with `AUTH_EXPOSE_OTP=true`.
- **`eKYC did not verify`** — confirm the api has `EKYC_PROVIDER_KIND=sandbox`; any other value talks
  to a real (unconfigured, in dev) eKYC provider and will fail.
- **`403` on bank-accounts / payouts** — the KYC step didn't actually flip `kyc_status='verified'`;
  re-run the script (it's idempotent for this step) and check the eKYC step's output for the real
  error.
- **A listing step says "SKIPPED"** — either the catalogue search found nothing for that crop and no
  degrade category matched either (extremely unlikely — `crops.spices` always has cumin), or (on a
  rerun) the listing is sold out at that exact title. Check the printed NOTE.
- **`relay tick exited with code 1`** — same troubleshooting as `scripts/pilot-e2e/README.md`: check
  `DATABASE_ADMIN_URL`/`DATABASE_URL` is set and `pnpm --filter @krishalaya/api exec ts-node --version`
  resolves.
- **Order (c) says "sold out — skipping"** — expected after a few reruns (10 qtl total stock); either
  ignore (orders (a)/(b)/wallet still get exercised) or bump `Onion — Medium Grade`'s listed
  `quantityTotal` in `db` directly is NOT recommended — instead accept the skip, or do a fresh
  tenant/reset per above.
- **`HTTP 403` on `POST /v1/onboarding/roles`** — `selfserve_onboarding` flag got turned off; it's ON
  by default (`db/seeds/core/0013_selfserve_onboarding_flag.sql`).
- **`HTTP 404`/flag-gated errors on `/v1/payments` or `/v1/payouts`** — `online_payments` is still OFF;
  see prerequisite #6.
