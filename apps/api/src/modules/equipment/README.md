# Equipment & CHC (M20) — farm-machinery rental

A Custom Hiring Centre (CHC) rental marketplace: equipment owners list machinery with rate cards; renters
book by the hour/acre/day; the engagement is escrow-secured and OTP-gated. Built to the platform laws.
Gated by the **`equipment`** feature flag (default **OFF**).

## The money path (Law 2 — wallet boundary only, escrow)
1. **confirm** (`quoted → confirmed`): the agreed advance/deposit is **escrowed** — renter `userMain` →
   `platform Escrow`, `txnType escrow_hold`, idempotency `eqbook-hold:<id>`.
2. **settle** (`completed → settled`, owner-initiated): the final total = `rate × actual usage`. The service
   posts up to three **zero-sum, idempotent** legs: release `min(advance,total)` from escrow → owner
   (`escrow_release`/`eqbook-release`), refund any unused hold → renter (`eqbook-refund`), and collect any
   shortfall renter → owner (`order_payment`/`eqbook-collect`). Net: owner receives exactly `total`, renter
   pays exactly `total`, escrow returns to zero.
3. **cancel** of a confirmed booking refunds the full escrow to the renter (`eqbook-cancel-refund`).

## Money correctness — float-free (Law: never float)
`total = rate_minor × actualQuantity` is computed with **exact bigint arithmetic**: quantities (hours/acres)
are scaled integers (×100) and `total = rate × qtyCenti / 100` with round-half-up integer division. No float.

## Security — OTP-gated start + anti over-billing
The meter only starts after the renter hands over a one-time code: `confirm` generates an OTP, stores **only
its HMAC hash** (server pepper), and `start` compares in **constant time** (`timingSafeEqual`).
[PC-56 HOTFIX-13 — CORRECTED, survey_ops4 C-5/C-6] This used to say the plaintext OTP "is delivered out-of-band
(SMS, deferred)": nothing delivered it, so in production a confirmed hire could never start. Now the code is
returned in the RENTER's own confirm response (only the renter can confirm) and nowhere else — not in a list, a
read, an owner's response, a log or an event. It also said completion's `actual ≤ estimate` meant "an owner
cannot inflate the bill beyond what the renter agreed to": true only up to the estimate — the owner alone types
the hours. Now (founder Q1-A, 2026-11-09, migration 0236) **nothing beyond the deposit leaves the renter's
wallet until she confirms those hours herself** (`POST /:id/confirm-usage`, renter only); `settle` with a bill
above the deposit and no confirmation is refused `SETTLE_HOURS_NOT_CONFIRMED` (409), and a bill within the
deposit settles from the deposit alone. A hire she never confirms stays `completed` and unsettled — nothing
times it out. Only the renter confirms (escrows her deposit) and confirms the hours; only the machine's owner
quotes, starts, completes and settles — the `booking.manage` administrator escape is gone from all six; cancel
keeps it (it only refunds her deposit).

## Lifecycle (Law 5 — `domain/equipment-booking.state.ts`)
`requested → quoted → confirmed → in_progress → completed → settled` (+ cancel from requested/quoted/confirmed).
No version columns → mutations lock the row **FOR UPDATE** (the booking read locks `FOR UPDATE OF b` across
its JOIN to `equipment_assets`, from which the owner is resolved — there is no `owner_user_id` column on bookings).

## Endpoints
- `POST /v1/equipment/assets` (idempotent, `equipment.manage`) · `GET` (?box=mine|browse|all) · `GET /:id`
  · `PATCH /:id` · `POST /:id/status` · `POST /:id/rates` · `GET /:id/rates`.
- `POST /v1/equipment/rentals` (request, idempotent, `equipment.rent`) · `GET` (?box=renter|owner|all) · `GET /:id`
  · `POST /:id/quote` (owner) · `POST /:id/confirm` (renter, idempotent, escrow) · `POST /:id/start` (owner, OTP)
  · `POST /:id/complete` (owner) · `POST /:id/confirm-usage` (renter, idempotent — HOTFIX-13)
  · `POST /:id/settle` (owner, idempotent, money; beyond the deposit only after `confirm-usage`) · `POST /:id/cancel`.

## Threats considered
- **No cross-party IDOR**: bookings read 404 unless caller is renter, owner, or admin; assets edited only by
  their owner. `box=all` requires `booking.manage`. A renter cannot rent their own asset.
- **Anti-mass-assignment**: zod `.strict()` DTOs; rate is server-snapshotted from the asset's active card;
  total is server-computed; advance is bounded ≤ estimated total at quote.
- **Money safety**: escrow legs are zero-sum + idempotent; cancel refunds escrow; a failed settle moves no money;
  no-overdraw means the renter must actually hold the deposit/shortfall. Audit row on settle.
- **AuthZ throws**: `equipment.manage` (owner: list/rate/quote/start/complete/settle), `equipment.rent`
  (renter: request/confirm/cancel). Tenant_id + RLS everywhere (integration proves cross-tenant denial).
- **Bounded**: keyset pagination with max `LIMIT`; the confirm-timeout job is bounded + `SKIP LOCKED`.

## Events (outbox, Law 4)
`equipment.asset_listed/updated/retired`, `equipment.rate_set`, `equipment.booking_requested/quoted/
confirmed/started/completed/settled/cancelled`.

## Jobs
`booking-confirm-timeout.job.ts` — cancels bookings left un-confirmed past their scheduled time (no escrow
held pre-confirm → nothing to refund), cross-tenant, bounded, `FOR UPDATE SKIP LOCKED`, idempotent.

## Scope & deferrals
**In scope:** equipment assets, per-asset rate cards, rental bookings (escrow hold → OTP start → metered completion → settlement), confirm-timeout job.
**Deferred (schema in 0010, not wired):** DRONES (registrations / pilots / flights, DGCA DigitalSky + RPL
expiry jobs, no-fly/weather pre-flight gate), maintenance logs, GPS area-trace (±2%) precise billing,
operator-pool integration (`operator_user_id` from labour), and the payments payout/intent linkage.

## Tests
- `__tests__/equipment-domain.spec.ts` — rental state machine, float-free totals, advance/over-estimate bounds, OTP constant-time gate.
- `__tests__/equipment-booking.service.spec.ts` — confirm escrow hold; settle release+shortfall and release+refund (zero-sum legs).
- `__tests__/equipment-asset.service.spec.ts` — quota + outbox on list; owner-only edit; duplicate reg_no → typed 409.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id, FOR UPDATE OF b + asset JOIN, keyset, effective-dated rate, bounded timeout).
- `__tests__/equipment.integration.spec.ts` — real Postgres: list→rate→request→quote→confirm[escrow]→start[OTP]→complete→**settle[zero-sum]**→RLS.

> No Postgres in the sandbox, so the live RLS / escrow-settlement assertions run on the first CI run with a service container.
