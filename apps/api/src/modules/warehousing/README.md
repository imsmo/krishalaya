# Warehousing & WDRA receipts (M21) — storage + eNWR

Deposit produce in a warehouse, have the warehouse record its own assay entry, and keep the records of any eNWR receipt numbers already
recorded. **This platform does not issue an eNWR** (PC-56 OPS-2b, founder Q3-A — issue is refused by name), no receipt can be pledged as loan
collateral (founder Q7-A — refused by name on the loan application too), and the storage fee at release is paused (OPS-1a). Built to the
platform laws. Gated by the **`warehousing`** feature flag (default **OFF**).

## Receipts and assays (PC-56 OPS-2b, founder Q3-A, Q4-A, Q5-A, Q7-A, Q11-A, Q13-A — survey F-1, F-2, F-7, F-8, F-16)
- `POST /v1/warehousing/nwr` → **409 `ENWR_ISSUE_NOT_ON_PLATFORM`** ("This platform does not issue an eNWR. No receipt is recorded here in a
  depositor's name. Nothing was recorded.") after the permission and Idempotency-Key checks, **before** the idempotency record, the unit of work
  and any read or write. The old body is kept unreachable, for the record: it recorded a receipt in the depositor's name on the operator's word
  (a typed number, a picked repository, a typed valuation; no repository call, no word from her).
- `POST /v1/warehousing/nwr/:id/release` → **409 `ENWR_RELEASE_NOT_STANDALONE`** — a receipt is never released on its own; nothing is locked or written.
- `POST /v1/warehousing/nwr/:id/cancel` — **the warehouse's named operator only** (`warehouses.operator_user_id = caller`, no administrator
  escape → 403 `WAREHOUSE_OPERATOR_ONLY`), `Idempotency-Key` required (400), a reason required (400 `ENWR_CANCEL_REASON_REQUIRED`), **one audit
  row** `warehousing.nwr.cancelled` (status before/after + the reason); a replay with the same key returns the stored response. No console button calls it.
- `POST /v1/warehousing/storage-bookings/:id/assays` — the warehouse's own entry, **not a lab certificate, and it sets no price** (nothing reads
  an assay to value anything); a `stored` booking only (409 `BOOKING_NOT_STORED`); the named operator only (403 `WAREHOUSE_OPERATOR_ONLY`, no
  administrator escape); **one audit row** `warehousing.assay.recorded`.
- `POST /v1/fintech/loan-applications` carrying `nwrId` → **422 `LOAN_ENWR_PLEDGE_NOT_ON_PLATFORM`** before anything is written (fintech module).
- The records already in `nwr_receipts` stay readable (`GET …/nwr?box=mine|all`, `GET …/nwr/:id`). The API body still carries `holderUserId`
  and `valuationMinor` (pinned live as today's truth); the ops console never renders either (Q4-A, Q9-A).

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
- **eNWR record**: `issued → released | cancelled` in the machine; through the API only `issued → cancelled` is reachable (release refused by
  name, OPS-2b). `pledged`, `partially_released` and `defaulted` have no transition.
- No version columns → mutations lock the row **FOR UPDATE**.

## Endpoints
- `POST /v1/warehousing/warehouses` (idempotent, `warehouse.manage`) · `GET` (?box=mine|browse|all) · `GET /:id` · `PATCH /:id`.
- `POST /v1/warehousing/storage-bookings` (request, idempotent, `warehouse.store`) · `GET` (?box) · `GET /:id`
  · `POST /:id/{confirm,store}` (operator) · `POST /:id/release` (operator, idempotent, money) · `POST /:id/cancel`
  · `POST /:id/assays` (operator) · `GET /:id/assays`.
- `POST /v1/warehousing/nwr` (issue — **refused by name**, OPS-2b) · `GET` (?box=mine|all) · `GET /:id` · `POST /:id/release` (**refused by
  name**) · `POST /:id/cancel` (the named operator, keyed, reason, audited).

## Threats considered
- **No cross-party IDOR**: a depositor reads only their own bookings/assays; an NWR is visible to its holder
  or staff (404 otherwise); operator actions verify `warehouse.operator_user_id == caller` — strictly (no admin) on assay record and receipt
  cancel since OPS-2b; "or admin" (the `booking.manage` escape) on the others until OPS-2a.
- **Platform-global warehouses** (NULL `tenant_id`, independent WDRA) are cross-tenant *visible* (browse +
  bookable) per the 0014 RLS policy, but **never editable** cross-tenant (`getForUpdate` is strictly tenant-owned).
- **Anti-mass-assignment**: zod `.strict()` DTOs; storage fee server-derived; no receipt can be created through the API (OPS-2b).
- **Money safety**: release is refused by name (paused); `storage_fee` would be zero-sum + idempotent; a free warehouse moves no money;
  fail-closed when no payee. Audit rows on warehouse-list, **warehouse-update (rate and operator before/after — OPS-2c B4)**, **assay record
  and receipt cancel (OPS-2b)**, booking-release and eNWR-issue (both unreachable — refused by name). Confirm, store and booking cancel write
  none yet (survey C-8 — OPS-2a).
- **The operator is a member** (OPS-2c B6): a named operator who is not an active member of the tenant is refused by name
  (`WAREHOUSE_OPERATOR_NOT_A_MEMBER`) on listing and update. Note (survey C-6/F-5): apart from assay record and receipt cancel (strict since
  OPS-2b), "operator-only" checks still admit a `booking.manage` holder (every tenant_admin) — OPS-2a's first commit (founder Q11-A).
- **AuthZ throws**: `warehouse.manage` (operator), `warehouse.store` (depositor). Tenant_id + RLS everywhere
  (integration proves cross-tenant denial). Keyset pagination with max `LIMIT`.

## Events (outbox, Law 4)
`warehousing.warehouse_listed/updated`, `warehousing.booking_requested/confirmed/stored/released/cancelled`,
`warehousing.assay_recorded`, `warehousing.nwr_issued/released/cancelled`.

## Scope & deferrals
**In scope:** warehouses (incl. platform-global), storage bookings (storage-fee settlement at release — PAUSED, refused by name), assays as recorded by the warehouse, the eNWR records already recorded (read; cancel by the named operator).
**Deferred (schema in 0010, not wired):** NWR **pledge → loan collateral** + partial release + default
(fintech flow), mark-to-market revaluation job, re-assay-due job, auto-valuation from assay grade × mandi
price, multi-unit → quintal conversion (bookings are refused in any unit but quintals — OPS-2c B5), NERL/CCRL repository API integration.

## Tests
- `__tests__/warehousing-domain.spec.ts` — booking + NWR state machines, float-free storage fee, months-stored rounding, invariants.
- `__tests__/storage-booking.service.spec.ts` — release refused by name before any lock/fee/write (OPS-1a); quintal-only before `idem.remember` (OPS-2c B5).
- `__tests__/warehouse.service.spec.ts` — register quota+outbox+audit; operator-only edit; update audit before/after; operator membership (OPS-2c B4/B6).
- `__tests__/ops2c-quantity.spec.ts` — the string quantity parse/print (OPS-2c B23).
- `src/__tests__/ops2c-storage-money.integration.spec.ts` — live: B4/B5/B6, the release refusal pinned, the absences (OPS-2c).
- `__tests__/ops2b-receipts.service.spec.ts` — issue / standalone release refused before `idem.remember` (ordering spies), cancel operator-only + key + reason + one audit row, assay strict operator + audit (OPS-2b).
- `src/__tests__/ops2b-receipts.integration.spec.ts` — live: B2, B1, the assay rules, the register as the API answers it, B8, the absences (OPS-2b).
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id, own-OR-NULL bookable, strict FOR UPDATE, keyset, one-active-NWR guard).
- `__tests__/warehousing.integration.spec.ts` — real Postgres: warehouse→book→confirm→store→assay→eNWR issue **refused by name** (OPS-2b
  named update)→release→RLS (red in its own `beforeAll` on the `makeCategory` fixture trap since before OPS-1a — known, not chased).

> No Postgres in the sandbox, so the live RLS / storage-fee assertions run on the first CI run with a service container.
