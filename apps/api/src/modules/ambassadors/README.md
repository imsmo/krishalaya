# ambassadors (PRD §16.10 + Ambassador Brochure)

The village field-agent / referral growth engine. Ambassadors onboard farmers and facilitate sales; they earn
commission on a set of seeded "earning streams" (data, not code), settled to their wallet weekly. Gated by the
`ambassadors` feature flag (default **OFF**).

## What it owns

- **Profiles** (`ambassador_profiles`) — one per user (UNIQUE), enrolled by an admin (`ambassador.manage`, Law 11
  — being an ambassador is never self-grant). Tier, mentor hierarchy, cluster regions, kiosk/AePS flags,
  `monthly_stipend_minor` (bigint). Suspend/reinstate (audited).
- **Commission plans** (`commission_plans_ambassador`) — the 7 seeded streams (0207) as data: a plan pays either
  a flat `amount_minor` or `rate_bps` of a base, capped at `cap_minor` (float-free bigint). Resolved
  tenant-override-then-platform, within the effective date window.
- **Referrals** (`referrals`) — the generic engine: any user mints a code, a new user claims it
  (`invited → signed_up`), an admin activates it (`→ activated`). If the referrer is an active ambassador,
  activation accrues the onboarding commission. Self-referral and double-use are blocked.
- **Earnings** (`ambassador_earnings`, PARTITIONED) — an append-only ledger of accrued commission (no wallet
  movement). `payout_id` NULL = unpaid. Accrual is **idempotent** (a service-level `existsFor` guard keyed on
  `(ambassador, event, reference)`, because the table's UNIQUE includes the partition key `created_at`).

## The money path

Accrual never touches money — it records what is owed. **Payout** does: `payoutAmbassador` locks the
ambassador's unpaid earnings (`FOR UPDATE SKIP LOCKED`), sums them, posts **one ZERO-SUM, idempotent
`commission` wallet transfer** — platform `Fees` → ambassador `userMain` — and stamps `payout_id` on the settled
rows, all in one ACID tx (Law 2/3/4). The `weekly-payout-batch` job (worker, BYPASSRLS pool) enumerates every
`(tenant, ambassador)` with unpaid earnings and settles each with a stable per-window idempotency key.

Accrual triggers wired this build: **referral activation** → `farmer_onboarded` (₹25 seeded); **`orders.order_completed`**
(an outbox consumer) → `first_sale_facilitated` (rate of the order total, capped) for the referring ambassador.

## Surface (v1, under the `ambassadors` flag)

Admin (`ambassador.manage`): `POST/GET /v1/ambassadors`, `GET/PATCH /v1/ambassadors/:id`,
`POST /:id/{suspend,reinstate}`, `GET /:id/earnings`, `POST /:id/payout` (Idempotency-Key).
`GET /v1/ambassadors/me`, `GET /v1/ambassadors/plans`, `GET /v1/ambassadors/me/earnings`.
Referrals (any user): `POST /v1/ambassadors/referrals` (Idempotency-Key), `POST .../claim`, `GET ...`,
`POST .../:id/activate` (`ambassador.manage`).

## Threats considered (§4)

- **Tenant isolation / RLS** — `tenant_id` binds every query; profiles/earnings/referrals are RLS-protected;
  commission plans allow NULL (platform defaults).
- **No privilege escalation** — enrollment + payouts are `ambassador.manage`-only and audited; ordinary users
  can only mint/claim/view their own referrals + see their own earnings (resolved server-side, no IDOR).
- **Money correctness** — bigint minor units only; payout is zero-sum + idempotent (Law 3) so a re-run never
  double-pays; accrual is idempotent so a re-delivered event never double-credits; commission is floored + capped.
- **Abuse** — self-referral + double referral-use rejected; codes are anchored-regex validated; lists bounded +
  keyset; accrual writes at most one row per `(ambassador, event, reference)` (no write amplification).

## Deferred (schema present, not built)

Milestone-bonus + 60-day inactivity-reassignment jobs; AePS/micro-ATM + kiosk operations; monthly stipend
disbursement; tier auto-promotion; `sale_trail` loyalty tier after N sales (only `first_sale_facilitated` wired).

> **Correction (PC-56 OPS-1b, survey OPS-1 C-2 / C-8).** "AePS/micro-ATM" above is stale in part. The AePS **log** is built:
> `controllers/v1/aeps.controller.ts` (record, own events, supervisor read), behind `ambassadors` (HOTFIX-10), audited (HOTFIX-10).
> Since OPS-1b (founder Q7-A) a record carries **no Aadhaar digit and no customer account link**: a body naming either field is refused
> by name (400 `AEPS_AADHAAR_NOT_RECORDED` / `AEPS_CUSTOMER_LINK_NOT_RECORDED`), and the reads return neither. What stays deferred is a
> real AePS service (a bank or BC provider, a device, NPCI). This platform moves no AePS money.
>
> **Correction (PC-56 OPS-1c, survey OPS-1 F-9 / OPS1-B7).** "kiosk operations" above is stale in part, and the profile's two kiosk facts
> were read by no gate. Since OPS-1c, **assisted onboarding** (`POST /v1/ambassadors/assisted-onboarding`) and **both on-behalf listing paths**
> (`POST /v1/ambassadors/on-behalf/listings`, `…/suggest`) are made only by an active ambassador whose profile has `kiosk_enabled = true` AND a
> recorded `training_completed_at`. Otherwise 403 `AMBASSADOR_KIOSK_NOT_ENABLED` / `AMBASSADOR_TRAINING_INCOMPLETE`, by name, after the
> `is_active` check and before anything is written (`domain/ambassadors.errors.ts` `assertKioskGate`). No column and no migration. The two
> facts stay independent: nothing switches kiosk mode on when training is recorded. Also since OPS-1c (founder Q8-A), no route records an
> `on_behalf_*` consent with a helper named on it (identity `ConsentHelperNotRecordedError`, 422 `CONSENT_HELPER_NOT_RECORDED`), so the
> on-behalf listing gate cannot be satisfied until a farmer-confirmed consent (OPS1-B3) exists. What stays deferred: an assisted session
> (OPS1-B4), assisted eKYC (OPS1-B5), the 60-day inactivity job and tier criteria (OPS1-B19).

## Tests

`__tests__/ambassadors-domain.spec.ts` (commission compute, referral state machine, guards),
`earning.service.spec.ts` (idempotent accrual, zero-sum commission payout, nothing-to-pay),
`tenant-isolation.spec.ts` (CI gate: tenant binding, keyset, partition-bound updates, plan fallback),
`ambassadors.integration.spec.ts` (real Postgres + seeded plans: enroll → refer → activate → ₹25 accrual →
payout to wallet → cross-tenant RLS denial; runs when `DATABASE_URL` is set).
