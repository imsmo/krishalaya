# Staging Smoke Suite — Sprint S2 deliverable

The staging-flavored sibling of `scripts/pilot-e2e/` (read that first — it is the model this suite
copies its shape from). **Read this whole file, and `provision.md`, before you run anything** — this
suite spends real rupees and sends real SMS/OTP messages to a real phone.

```
health+TLS -> OTP login (real SMS, human types the code) -> profile fetch (RLS sanity)
  -> listing create+publish+public fetch -> ₹1 LIVE payment (real UPI, human pays)
  -> webhook-replay check -> notification check -> ₹1 refund -> eKYC session start
```

## How this differs from `scripts/pilot-e2e/`

| | `pilot-e2e` | `staging-smoke` |
|---|---|---|
| Target | `localhost:3000`, docker-composed Postgres/Redis | a real `STAGING_API_URL` (deployed staging cluster) |
| DB access | direct `pg` connection from the laptop (seeds a tenant/users itself) | **none** — staging Postgres is not reachable from a laptop; provisioning is a separate one-time step (`provision.md`) done via admin-api and/or `psql` over a bastion |
| OTP | `AUTH_EXPOSE_OTP=true`, code read straight out of the HTTP response | **real SMS** (MSG91/Twilio) to a real phone; the script `readline`-prompts a human to type the code in |
| Payment | sandbox gateway, fake webhook posted by the script itself | **real Razorpay**, real UPI, capped at **₹1 and never more** — the script prompts loudly for confirmation before charging and polls for the real webhook to land (no simulated webhook call anywhere) |
| Outbox relay | manually ticked (`relay-tick.mjs`) because S0 found nothing runs it | **not needed** — S1 (KV-BL-063) wired the permanent relay timer in the api process, so `payment_succeeded -> order confirmed` and `order_completed -> notification fan-out` happen on their own. This suite only *polls and waits*, it never ticks anything. |
| Webhook replay | n/a (pilot doesn't test replay) | **documented as a Razorpay-dashboard action**, not faked — see "Check 6" below for why no in-repo endpoint can do this |
| Blast radius if it fails | a throwaway local Postgres | a shared staging environment + a real ₹1 — every step is designed to be safely skippable/re-runnable and never charges more than once per run |

## Prerequisites

1. **Staging is up per the S1 runbook.** `apps/api` and `apps/admin-api` are deployed and reachable
   (the composition is `infra/terraform/envs/staging/` — same modules as prod, pilot-sized, per
   `infra/DEPLOY-RUNBOOK.md` + `infra/EDGE-RUNBOOK.md`; migrations + reference-data seed applied,
   **not** `db/seeds/demo/*`). **Flagged gap found while writing this suite:** `main.tf`'s `dns`
   module comment cites `S1_STAGING_APPLY_RUNBOOK.md §5` for the `staging.krishiverse.ai` DNS
   delegation step, but no such file exists anywhere in the repo — treat the DEPLOY/EDGE runbooks
   above as the working equivalent until that file is actually written, and don't go looking for it.
2. **Real provider keys are loaded into staging's secrets** (not this repo, not `.env`): live-mode-or-
   sandboxed-but-real `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` (a **test-mode**
   Razorpay account is fine and recommended for this suite — it still moves through the exact same
   code path and still requires a real UPI app to approve, but no real settlement bank account is at
   risk; see `apps/api/PAYMENTS-GO-LIVE.md` §1 for the key names), a real `SMS_PROVIDER`
   (`msg91` or `twilio`) with valid creds, and (for check 9) `EKYC_PROVIDER_KIND` pointed at a real
   aggregator if you intend to run that check.
3. **One-time provisioning done** — a pilot tenant + the founder's own phone registered as a test user
   with `farmer` + `customer` (+ `tenant_admin`, for the refund permission) roles, and the
   `online_payments` / `communication` / `kyc` feature flags turned on for that tenant. **Do this via
   `provision.md` before running `smoke.mjs` the first time** — it will fail fast (with a clear error)
   on every check if this hasn't been done.
4. Node.js >= 20 (repo `.nvmrc`) on the machine running the script. **No new npm dependencies** —
   `smoke.mjs` uses only Node's built-ins (`fetch`, `node:tls`, `node:readline/promises`,
   `node:crypto`). `node --check scripts/staging-smoke/smoke.mjs` passes clean.
5. A phone in your hand that can receive SMS and has a UPI app installed — you (the founder) are the
   human in the loop for checks 2, 5, and optionally 9. Have it nearby before you start.

## Usage

```bash
export STAGING_API_URL="https://staging-api.krishiverse.ai"      # no trailing slash
export TENANT_ID="<pilot tenant id from provision.md>"
export FOUNDER_PHONE="+91XXXXXXXXXX"                              # the real phone provisioned in provision.md

# optional, unlocks the automated recon/ledger checks (6 + 8) instead of a manual-only fallback:
export ADMIN_API_URL="https://staging-admin-api.krishiverse.ai"
export ADMIN_API_TOKEN="<a platform_recon_viewer-or-better admin-api token>"

node scripts/staging-smoke/smoke.mjs
```

Flags:
- `--skip-money` — skip checks 5, 6, 7 and 8 (the ₹1 payment, webhook-replay check, notification check — no order ⇒ nothing to notify — and refund).
  Use this to smoke-test everything *except* real money movement (health, login, profile, listings,
  notifications) — useful when staging is only partially provider-configured.
- `--skip-ekyc` — skip check 9 (eKYC session start). This is also the **default behaviour** unless
  you export `EKYC_TEST_ID_NUMBER` (see check 9 below) — starting a real eKYC session means sending a
  real Aadhaar/PAN number to a real government-adjacent provider, which this script will never do
  silently.
- `--help` — print usage and exit.

The script prints an ordered `[n] PASS|FAIL|SKIP` line per check as it goes (same shape as
`pilot-e2e/flow.mjs`), then a summary table, and exits non-zero if anything FAILed (a SKIP is not a
failure).

## What each check proves (and the exact endpoint it hits)

| # | Check | Endpoint(s) | Proves |
|---|---|---|---|
| 1 | Health, readiness, TLS | `GET /v1/healthz`, `GET /v1/readyz`, raw `tls.connect` to the host | the deployed api answers, its DB pool is up, and the edge cert is valid and not expiring soon |
| 2 | Real OTP round-trip | `POST /v1/auth/otp` -> (human types the SMS code) -> `POST /v1/auth/verify` | the real SMS provider (MSG91/Twilio) actually delivers a working OTP end-to-end, not just that dev-mode `devCode` works |
| 3 | Authenticated profile fetch | `GET /v1/users/me` | the minted JWT is valid, RBAC resolved the founder's roles, and the response is scoped to `TENANT_ID` (structural RLS sanity — there is no tenant param in the URL, so cross-tenant reads are architecturally impossible here, not just policy-forbidden) |
| 4 | Listing create + publish + public fetch | `POST /v1/listings`, `POST /v1/listings/:id/publish`, `GET /v1/listings/:id` (no auth header) | the farmer role can list produce, publishing flips it to public, and an anonymous caller (no token at all) can see it — proves the `@Public()` storefront path works against real staging |
| 5 | ₹1 live payment | `POST /v1/cart/items`, `POST /v1/checkout`, `POST /v1/payments`, then **the human pays via UPI**, then poll `GET /v1/payments/:id` + `GET /v1/orders/:id` | a real payment captures through the real Razorpay webhook, S1's outbox relay timer (no manual tick) flips the order to `confirmed`, and escrow is credited — the actual go-live proof from `apps/api/PAYMENTS-GO-LIVE.md` §3, run for real |
| 6 | Webhook replay no-op | **no API call** — a before/after ledger-zero-sum comparison via `GET /v1/recon/overview` (admin-api), bracketing a **manual** Razorpay-dashboard "resend delivery" action | idempotency of a real redelivered webhook — see "Check 6" below for why this can't be triggered from outside |
| 7 | Notification recorded | `GET /v1/notifications` | the order-confirmed event fanned out to the seller's inbox for real (communication flag + real relay) |
| 8 | ₹1 refund + reconciliation | `POST /v1/payments/:id/refund`, poll `GET /v1/payments/:id`, `GET /v1/recon/overview` (admin-api, if configured) | the refund endpoint reverses the escrow leg for real money, and the platform ledger still nets to zero afterwards |
| 9 | eKYC session start | `POST /v1/kyc/ekyc/start` (+ human-typed provider OTP -> `POST /v1/kyc/ekyc/verify`), only if `EKYC_TEST_ID_NUMBER` is set | a real Aadhaar/PAN goes through the real eKYC provider adapter (`HttpEkycProvider`) end-to-end; otherwise documents the manual mobile/web KYC screen as the way to prove this |

## Check 6 in detail — why there's no "replay" endpoint to call

Searched `apps/api` and `apps/admin-api` for anything resembling an admin/sandbox webhook-replay
trigger. There isn't one: `apps/api/src/modules/payments/controllers/v1/payment-webhooks.controller.ts`
exposes exactly `POST /v1/payments/webhooks/:provider` (the same **public, signature-verified ingest**
endpoint Razorpay itself calls) and `POST /v1/payments/webhooks/:provider/payouts` — no
authenticated "replay the last delivery" surface exists anywhere, in either app. `apps/api/PAYMENTS-GO-LIVE.md`
§4 confirms this is intentional/expected: the replay test is meant to be done **from the Razorpay
dashboard** ("In the Razorpay dashboard, **resend** the same `payment.captured` event"), because only
Razorpay holds the original signed delivery to redeliver — a script forging a second copy of the
webhook itself would not be testing replay-idempotency of a *real* redelivery, it would just be
calling the ingest endpoint twice with a payload of our own construction (which the codebase's own
`payments.integration.spec.ts` already covers in CI). **This suite does not fake it.** Check 6 prints
the current `ledgerZeroSum` from `GET /v1/recon/overview`, prompts you to go do the dashboard resend
manually (or press Enter to skip if you don't have dashboard access to hand), then re-fetches
`ledgerZeroSum` and asserts it's still balanced with no new mismatch — the closest automatable
approximation of "a replay was a no-op" without inventing a webhook call that doesn't exist in
production. If `ADMIN_API_URL`/`ADMIN_API_TOKEN` aren't set, this check prints the manual dashboard
step + the SQL from `PAYMENTS-GO-LIVE.md` §4 and reports **SKIP**, not FAIL.

## Cost warning — this suite spends real money

Checks 5 and 8 move **exactly ₹1 (100 paise)** through a real payment gateway and back — never more.
The script hard-asserts the order total is exactly 100 paise before it will create a payment intent,
and refuses to proceed (throws, does not silently clamp) if provisioning produced a different amount.
Before check 5 actually calls the gateway, it prints the exact amount and gateway order id and
requires you to type a literal confirmation phrase (not just Enter) to proceed — there is no
`--yes`/non-interactive flag to bypass this, on purpose. If your Razorpay account is in **test mode**
(recommended — see prerequisite 2), no real settlement occurs at all even though the code path is
identical; if it's in **live mode**, you will be out ₹1 (refunded back to you in check 8) plus
whatever your bank/UPI app's own transfer floor is (usually none for ₹1 UPI). Running the full suite
repeatedly creates a new order/payment each time — it is not a one-time-only script — so re-running it
costs another real ₹1 each time checks 5/8 are not skipped.

## Troubleshooting

- **Check 2 hangs waiting for the OTP** — real SMS delivery can take 10-60s depending on carrier/DLT
  routing; the prompt waits indefinitely (no timeout) since a human has to act. `OTP_REQUEST_MAX_PER_HOUR`
  / `OTP_VERIFY_MAX_PER_HOUR` (`apps/api/src/core/config/env.validation.ts`) still apply on staging —
  re-running this suite many times per hour against the same phone will eventually 429.
  `POST /v1/auth/otp` is also IP-rate-limited to 5/min and `verify` to 10/min (`RateLimit` decorators
  on `AuthController`) — don't loop-retry check 2 tightly.
- **Check 3/4 fail with 403** — almost always a missing feature flag (`online_payments`,
  `communication`, `kyc`) or a missing role on the founder's `user_tenant_roles` row for `TENANT_ID`.
  Re-check `provision.md`.
- **Check 5 payment never captures** — confirm the UPI payment actually completed on your phone (a
  cancelled/failed UPI attempt never fires the webhook); confirm staging's Razorpay webhook is
  registered per `apps/api/PAYMENTS-GO-LIVE.md` §2 pointed at the staging api's public URL; check the
  api's logs for a rejected/forged-signature webhook.
- **Check 8 refund 403s** — the founder's provisioned roles must include `tenant_admin` (grants
  `wallet.adjust`); a plain `customer`/`farmer` role cannot refund (see `payments.policies.ts`).
- **Checks 6/8's admin-api half is SKIPPED** — set `ADMIN_API_URL` + `ADMIN_API_TOKEN` (a token for a
  role with at least `platform_recon_viewer`, see `apps/admin-api/src/core/rbac/owner-roles.ts`); the
  `GET /v1/recon/overview` read does **not** require the FIDO2 hardware-key/step-up guards (those only
  gate the *mutation* routes in `recon-monitor.controller.ts`), so a plain admin-api bearer token is
  enough for these two checks specifically.
- **Check 9 is always SKIPPED and I want to run it** — set `EKYC_TEST_ID_NUMBER` (and optionally
  `EKYC_TEST_DOC_TYPE=aadhaar|pan`, default `aadhaar`) to a real id you're willing to submit to the
  real staging eKYC provider, and drop `--skip-ekyc`. The script will still print a loud confirmation
  prompt before sending it. Recommended default: leave it unset and do this one manually through the
  mobile/web KYC screen against staging instead — see check 9's SKIP message for exactly what to do.

## S1/S2 context this suite assumes

- The outbox relay runs continuously in the api process (S1, KV-BL-063) — this suite never ticks
  anything manually, unlike `pilot-e2e`.
- `dotenv` is a declared dependency of `@krishalaya/api` (S1, KV-BL-064) — irrelevant to this suite
  (it never boots the api locally), noted only because `pilot-e2e/README.md` flagged it and it's now
  fixed.
- Provider adapters (Razorpay, MSG91/Twilio, eKYC) are the S2 wiring this suite is meant to smoke-test
  — if a provider isn't configured yet on staging, run with `--skip-money`/`--skip-ekyc` and file the
  gap rather than treating a SKIP as done.

> **Re-run note:** the suite never clears the cart; a re-run without the provision.md teardown will fail-safe at the ₹1 money guard (total ≠ 100 paise) rather than overcharge. Run the teardown SQL (or empty the cart in-app) before re-running check 5.
