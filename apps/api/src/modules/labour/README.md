# Labour (M28) — dignified-work spine

Booking marketplace for farm labour, built to the platform laws. An **employer** (farmer/FPO, `worker.book`)
posts a booking, **assigns** workers, workers **consent**, and on completion **wages settle through the
wallet**. Gated by the **`labour`** feature flag (default **OFF**).

## The dignity floor (the headline invariant)
A booking's offered wage may **never** fall below the statutory **minimum wage** for its region + skill
level. This is enforced in **three** places, fail-closed:
1. `MinimumWageService.resolveFloor()` snapshots the floor from `minimum_wages` at posting (if **no** row
   is configured, the booking is **rejected** — we never silently allow a sub-floor wage).
2. The `LabourBooking.post()` aggregate throws `WAGE_BELOW_MINIMUM` (422) if the offer is below the snapshot.
3. The database `chk_dignity_floor CHECK (wage_offered_minor >= min_wage_minor)` is the physics backstop.

## The money path (Law 2 — wallet boundary only) · PC-56 TENANT-11b
Founder decision (2026-10-02): **wages are escrowed at roster confirm, plus a flat ₹20 platform fee**; the same-day
fairness fee is **refused by name** (rule not set). Every move is a balanced, idempotency-keyed WalletPort post, recorded
on a 0187 row (`labour_escrows`, `labour_wage_payouts`) that carries its txn id — `services/labour-money.service.ts` is the
only place labour money moves.

| Step | Ledger move | Key · txn type |
|---|---|---|
| Roster confirm | employer Main −(wages+fee) → employer Hold +wages, platform Fees +fee | `labour-escrow:<booking>` · `labour_escrow` |
| Pay run (per assignment, confirmed unpaid days) | employer Hold −w → worker Main +w (OT separately) | `wage:<assignment>:<sha256(days)>`, `wage-ot:…` · `wage_payout` |
| Top-up (run beyond the escrow) | employer Main → employer Hold | `labour-escrow-topup:<booking>:<n>` · `labour_escrow_topup` |
| Release (completed + nothing owed, or cancel) | employer Hold → employer Main (fee kept) | `labour-escrow-release:<booking>` · `labour_escrow_release` |

The wage is **Σ confirmed attendance**: per_day = days × rate; per_hour = regular hours × rate; per_task = rate once on
completion; OT = OT hours × hourly base × multiplier. A worker with no confirmed day is paid ₹0 and the payout row says
why. An unfunded employer is refused `EMPLOYER_FUNDS_UNAVAILABLE` (with the shortfall) and nothing moves. A booking started
before 0187 has no escrow and pays from the employer's Main.

## Lifecycle (Law 5 — state machines in `domain/*.state.ts`)
- **Booking**: `open → accepted (roster confirmed, escrowed) → in_progress → completed → paid` (+ `cancel` from
  open/accepted/in_progress, `expire` from open). 7 of the enum's 12 values; draft / pending_worker / rejected / disputed /
  no_show are unreachable on a booking. Optimistic version + row lock.
- **Assignment** (one row per worker): `pending_worker | applied → accepted | rejected | expired`; `accepted → paid`. The
  roster is locked at confirm (pending invitations lapse).
- **Attendance**: clock in (on a started job, ≤100 m) → clock out (server hours) → employer confirm — matched on the row's
  µs `created_at::text` (F-6). The work date is the India day.
- **Worker**: `age_verified_18` HARD gate; women-only enforced from `users.gender` (not recorded → refused by name).

## Endpoints
- `POST /v1/labour/bookings` (idempotent; `onBehalf` = the desk with the employer's consent) · `GET /v1/labour/bookings
  [?box=mine|open|all&sort=starts&counts=1]` · `GET /:id` (owner-checked) · `POST /:id/assignments` (idempotent) ·
  `POST /:id/confirm-roster` (idempotent, money) · `POST /:id/{start,complete}` · `POST /:id/cancel {reasonCode,…}` ·
  `POST /:id/pay` (idempotent, money).
- `GET /v1/labour/assignments[?box=mine|booking]` (roster = employer / desk; a worker sees their own row) · `GET /:id` ·
  `GET /:id/days` · `POST /:id/respond` · attendance clock-in / clock-out / confirm · `GET /v1/labour/summary` (desk) ·
  `GET /v1/labour/lookups[/floor]`.
- Permissions: `worker.book` (employer), `labour.desk` (tenant_admin, fpo_coordinator: on-behalf acts with consent),
  `labour.wages.approve` (tenant_admin: pay a desk-run booking), `booking.manage` (oversight reads).

## Guarantees per write
One ACID tx (UoW) · outbox events in the **same** tx (Law 4) · idempotency on money/create mutations
(Law 3) · quota on create (`labour_bookings`) · authz that **throws** (Law 6: `worker.book` employer +
booking-owner/`booking.manage`) · tenant_id in every query + RLS (Law 1) · keyset pagination (never OFFSET).

## Jobs
`booking-respond-timeout.job.ts` — registered in `SCHEDULED_JOB_REGISTRY` (5 min, advisory-locked by the runner): reads
only `tenants` with the kv_relay pool, claims per tenant in kv_app's unit of work, and `expireBooking` re-checks under the
row lock. No kv_relay grant on any labour table.

## Events (outbox)
`labour.worker_registered/updated`, `labour.booking_posted/started/completed`, `labour.worker_assigned`,
`labour.assignment_accepted/rejected/expired`, `labour.roster_confirmed`, `labour.wages_paid`, `labour.booking_cancelled/expired`.
`labour.roster_confirmed` and `labour.booking_cancelled` (with the reason) notify the workers (0187 catalogue).

## Scope & deferrals
**In scope:** worker profiles, bookings (dignity floor + declarations), assignments (consent), attendance, roster
confirm + escrow, the pay run (attendance-derived, OT), cancel reasons, the labour desk + consent, respond-timeout job.
**Refused by name / deferred:** the same-day fairness fee (founder: rule not set), wage runs (W166), crews + crew
broadcast, invite fan-out / widen radius, skill-match % and distance, the 7-year retention act, a 24 h pay SLA, worker
advances, insurance enrolment, migrant engagement, safety checklists, grievances, minimum-wage admin CRUD (kv_app holds
SELECT only on `minimum_wages` since 0187).

## Tests
- `__tests__/labour-booking.spec.ts` — domain: both state machines, the dignity floor, wage settlement, age gate, min-wage VO.
- `__tests__/worker-profile.service.spec.ts` — one-profile guard, outbox-in-tx, edit ownership.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id binding, optimistic version, FOR UPDATE, keyset, SKIP LOCKED, global min-wage).
- `__tests__/labour.integration.spec.ts` — real Postgres: register → age-verify → dignity-floor rejection → post → assign → accept → confirm roster → start → 2 confirmed days → complete → **pay from escrow** → RLS.
- `__tests__/tenant11b-labour-domain.spec.ts` — the wage / escrow arithmetic, keys, the µs row match, the job's per-tenant claim.
- `__tests__/tenant11b-labour-truth.integration.spec.ts` — live A1–A10 (µs clock cycle, 3-day / no-show pay, escrow + fee, unfunded refusal, OT top-up, cancel release, desk consent, women-only, owner checks, minimum_wages revoke, the job as kv_relay).
