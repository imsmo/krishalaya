# Warehousing & WDRA receipts (M21) — storage + eNWR

Deposit produce in an accredited warehouse, get a quality assay, receive an **electronic Negotiable
Warehouse Receipt (eNWR)** (later usable as loan collateral), and pay a storage fee on release. Built to the
platform laws. Gated by the **`warehousing`** feature flag (default **OFF**).

## The money path (Law 2 — wallet boundary only) — PAUSED (PC-56 OPS-1a, founder Q3-A; corrected PC-56 OPS-2c, survey C-9)
**No warehouse act moves money today.** `POST /v1/warehousing/storage-bookings/:id/release` is **refused by name**
(`STORAGE_RELEASE_AWAITS_DEPOSITOR`, 409) before any lock, fee or write, until the depositor can confirm the release and its fee herself in
her own sign-in (founder Q8-A: release stays paused through OPS-2). The code below the refusal is kept, unreachable, for the money wave.

What the release **would** do if it were switched on (this is the code as it stands, stated so nobody mistakes it for a live path):
collect the storage fee from the **depositor `userMain` → the warehouse operator's own `userMain`** (a person's wallet, by default the
administrator who listed the warehouse — `warehouse.service.ts` register), `txnType 'storage_fee'`, a zero-sum, idempotent ledger txn
(`storagefee:<bookingId>`). A free (zero-rate) warehouse would move no money; a fee-bearing warehouse with no operator fails closed
(`NO_WAREHOUSE_OPERATOR`). **Founder Q1-A (2026-11-06):** the fee is to go to the ORGANISATION's account — built in the money wave, never
before release returns.

## Money correctness — float-free (Law: never float) — the rule as it is (survey C-13, founder Q2-A)
- The fee is computed **once, at release** — not monthly, not in arrears. There is no billing run, no accrual, no promo, no free period.
- It uses the warehouse's **current** `rate_per_qtl_month_minor` **at the moment of release** — a mutable column, not a versioned tariff
  and not the rate on the day the goods arrived. Every rate change is now audited (`warehousing.warehouse.updated`, before/after — OPS-2c B4);
  locking the rate on the day goods are stored is the money wave's (founder Q2-A).
- Months = **whole 30-day periods rounded up, minimum one**, from `stored_at` (`ceil(days/30)`; a lot kept 31 days pays two). Whole days vs
  30-day periods is decided in the money wave.
- The quantity is read **in quintals**: a booking in any other unit is refused by name (`STORAGE_UNIT_NOT_QUINTAL`, OPS-2c B5;
  `domain/quantity.ts` `STORAGE_FEE_UNIT`). The quantity is parsed and printed from its decimal string, never a float (OPS-2c B23).
- `storageFeeMinor = quantity(qtl) × rate/qtl/month × months` with exact bigint arithmetic: quantity ×1000, round-half-up integer division.

## Lifecycle (Law 5 — `domain/*.state.ts`)
- **Storage booking**: `requested → confirmed → stored → released` (+ cancel from requested/confirmed).
- **eNWR**: `issued → released | cancelled`. Pledge → loan-collateral → partial-release → default is the
  **deferred fintech flow** (those transitions are intentionally unreachable here).
- No version columns → mutations lock the row **FOR UPDATE**.

## Endpoints
- `POST /v1/warehousing/warehouses` (idempotent, `warehouse.manage`) · `GET` (?box=mine|browse|all) · `GET /:id` · `PATCH /:id`.
- `POST /v1/warehousing/storage-bookings` (request, idempotent, `warehouse.store`) · `GET` (?box) · `GET /:id`
  · `POST /:id/{confirm,store}` (operator) · `POST /:id/release` (operator, idempotent, money) · `POST /:id/cancel`
  · `POST /:id/assays` (operator) · `GET /:id/assays`.
- `POST /v1/warehousing/nwr` (issue, idempotent, `warehouse.manage`) · `GET` (?box=mine|all) · `GET /:id` · `POST /:id/{release,cancel}`.

## Threats considered
- **No cross-party IDOR**: a depositor reads only their own bookings/assays; an NWR is visible to its holder
  or staff (404 otherwise); operator actions verify `warehouse.operator_user_id == caller` (or admin).
- **Platform-global warehouses** (NULL `tenant_id`, independent WDRA) are cross-tenant *visible* (browse +
  bookable) per the 0014 RLS policy, but **never editable** cross-tenant (`getForUpdate` is strictly tenant-owned).
- **Anti-mass-assignment**: zod `.strict()` DTOs; storage fee + NWR holder are server-derived (holder = the
  booking's depositor); one active eNWR per booking; `enwr_no` uniqueness → typed 409.
- **Money safety**: release is refused by name (paused); `storage_fee` would be zero-sum + idempotent; a free warehouse moves no money;
  fail-closed when no payee. Audit rows on warehouse-list, **warehouse-update (rate and operator before/after — OPS-2c B4)**, booking-release
  (unreachable while paused), eNWR-issue. Confirm, store, cancel, assay, NWR release/cancel write none yet (survey C-8 — OPS-2a/2b).
- **The operator is a member** (OPS-2c B6): a named operator who is not an active member of the tenant is refused by name
  (`WAREHOUSE_OPERATOR_NOT_A_MEMBER`) on listing and update. Note (survey C-6/F-5): "operator-only" checks still admit a `booking.manage`
  holder (every tenant_admin) — OPS-2a's first commit (founder Q11-A).
- **AuthZ throws**: `warehouse.manage` (operator), `warehouse.store` (depositor). Tenant_id + RLS everywhere
  (integration proves cross-tenant denial). Keyset pagination with max `LIMIT`.

## Events (outbox, Law 4)
`warehousing.warehouse_listed/updated`, `warehousing.booking_requested/confirmed/stored/released/cancelled`,
`warehousing.assay_recorded`, `warehousing.nwr_issued/released/cancelled`.

## Scope & deferrals
**In scope:** warehouses (incl. platform-global), storage bookings (storage-fee settlement at release — PAUSED, refused by name), assays as recorded by the warehouse, eNWR records.
**Deferred (schema in 0010, not wired):** NWR **pledge → loan collateral** + partial release + default
(fintech flow), mark-to-market revaluation job, re-assay-due job, auto-valuation from assay grade × mandi
price, multi-unit → quintal conversion (bookings are refused in any unit but quintals — OPS-2c B5), NERL/CCRL repository API integration.

## Tests
- `__tests__/warehousing-domain.spec.ts` — booking + NWR state machines, float-free storage fee, months-stored rounding, invariants.
- `__tests__/storage-booking.service.spec.ts` — release refused by name before any lock/fee/write (OPS-1a); quintal-only before `idem.remember` (OPS-2c B5).
- `__tests__/warehouse.service.spec.ts` — register quota+outbox+audit; operator-only edit; update audit before/after; operator membership (OPS-2c B4/B6).
- `__tests__/ops2c-quantity.spec.ts` — the string quantity parse/print (OPS-2c B23).
- `src/__tests__/ops2c-storage-money.integration.spec.ts` — live: B4/B5/B6, the release refusal pinned, the absences (OPS-2c).
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id, own-OR-NULL bookable, strict FOR UPDATE, keyset, one-active-NWR guard).
- `__tests__/warehousing.integration.spec.ts` — real Postgres: warehouse→book→confirm→store→assay→eNWR→**release[storage-fee zero-sum]**→RLS.

> No Postgres in the sandbox, so the live RLS / storage-fee assertions run on the first CI run with a service container.
