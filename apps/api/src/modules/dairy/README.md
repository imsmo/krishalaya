# Dairy (M16) — milk procurement spine

The cooperative / Milk Collection Centre (MCC) procurement system: enrol farmer members, price milk by
quality, record twice-daily collections, and **settle per-cycle milk bills by paying farmers through the
wallet**. Built to the platform laws. Gated by the **`dairy`** feature flag (default **OFF**).

## The money path (Law 2 — wallet boundary only)
Milk-bill settlement (`POST /v1/dairy/milk-bills/:id/pay`, `approved → paid`) transfers the bill's **net**
amount **tenant `main` → farmer `userMain`**, `txnType = 'milk_payment'`, as a **zero-sum, idempotent**
ledger txn (`milkbill:<billId>`). The cooperative's tenant wallet is the payer (funded by dairy sales); the
wallet's no-overdraw rule means it must hold the balance. Net is computed in the domain as
`gross − Σ deductions` (feed credit, loan EMI, etc.). Bank disbursement (the `payout_id` link to the
payments payout path) is deferred — this credits the farmer's in-platform wallet.

## Money correctness — float-free pricing (Law: never float)
`MilkRateCard.priceMinor()` computes the collection amount with **exact bigint arithmetic**. Weight/fat/snf
arrive as decimal strings and are parsed to **scaled integers** (kg×1000, %×100); the price is
`weightMilliKg × fatCentiPct × rateFat / 10⁷ (+ snf axis) (+ base × weight)` with round-half-up integer
division. No IEEE float ever touches a money value. Models: `two_axis` (fat + snf), `fat_pooled`,
`snf_pooled`, plus an optional flat `base_rate_per_litre` and the `bonus_rules` premium slabs (read since TENANT-6b-1,
paid only behind `dairy_bonus_slabs`). **Per kg, though named per litre:** the base rate and the premium are multiplied
by the weighed kilograms, not a measured litre (survey OPS-3 C-10; the unit is founder Q8). No pricing changed in HOTFIX-12.

## Rate cards — a second person and a record (PC-56 HOTFIX-12, founder Q1-A + Q1-sub, migration 0234)
There is **no version column** (0009 said "versioned"; it never was). A card is **created** by one `dairy.manage`
holder (`created_by` recorded, one `dairy.rate_card.created` audit row with the whole card), may start on the tenant's
tomorrow at the earliest, in its own zone — today is refused too (`RATE_CARD_BACKDATED`, 422), and **prices nothing** until a **second person** approves
it: `POST /v1/dairy/rate-cards/:id/approve` (Idempotency-Key, `dairy.manage`; the creator → 403
`RATE_CARD_SECOND_PERSON_REQUIRED`; already approved → 409 `RATE_CARD_ALREADY_APPROVED`; start not after today →
`RATE_CARD_BACKDATED`; another approved card for the milk type on one of its days → 409 `RATE_CARD_OVERLAP`). The
approval, in one transaction, closes the predecessor's `effective_to` the day before the new card starts, stamps
`approved_by`/`approved_at`, writes a `dairy.rate_card.approved` audit row and emits `dairy.rate_card_approved` with the
members it prices as recipients (push + in-app in her language; never SMS). Cards that existed when the rule shipped
keep pricing (`approved_before_rule`). In the database: `ck_rate_card_approver_ne_creator`, `ck_rate_card_approval_stamp`,
the guard trigger `milk_rate_cards_hf12_guard` (no approval outside the approver's own session, none starting before tomorrow, an
approved card's prices and dates frozen) and the exclusion `ex_rate_card_one_in_force` (btree_gist).

## Lifecycle (Law 5 — state machine in `domain/milk-bill.state.ts`)
`draft → previewed → approved → paid` (+ `disputed` from previewed, resolvable back). A cycle-close job
generates the draft; the member previews/disputes within the window; the cooperative approves; payout → paid.
No version columns → mutations lock the row **FOR UPDATE**. `milk_collections` is **partitioned by
`collected_on`** (auto-managed by `ensure_partitions` in migration 0014); every query carries the date so PG
prunes partitions (Law 8). `UNIQUE(membership_id, collected_on, shift)` makes a counter entry idempotent.

## Endpoints
- `POST /v1/dairy/mccs` (idempotent, `dairy.manage`) · `GET` · `GET /:id` · `POST /:id/active`
  · `POST /mccs/memberships` (enrol) · `GET /mccs/memberships/list[?box=mine|mcc|all]` · `GET /mccs/memberships/:id`.
- `POST /v1/dairy/rate-cards` (idempotent, `dairy.manage`) · `POST /:id/approve` (idempotent, `dairy.manage`, a second person — HOTFIX-12) · `GET[?activeOnly]` (active = approved and active) · `GET /:id`.
- `POST /v1/dairy/collections` (idempotent, `dairy.manage`) · `GET ?membershipId&from&to` (member-own or staff).
- `POST /v1/dairy/milk-bills/generate` (idempotent) · `GET[?box=mine|all]` · `GET /:id` · `POST /:id/{preview,approve}` · `POST /:id/pay` (idempotent, money).

## Security — threats considered
- **No cross-member IDOR.** A farmer reads only their own memberships/collections/bills (404 otherwise);
  staff (`dairy.manage`) read tenant-wide. Bill/collection ownership resolves via the membership server-side.
- **Anti-mass-assignment.** All DTOs are zod `.strict()`. Collection amount is server-computed from the
  resolved rate card (never client-supplied); the rate card is resolved by animal type + effective date.
- **AuthZ throws.** `dairy.manage` gates every operator write (MCC, rate card, enrol, collect, generate,
  approve, pay). Members have no write perm.
- **Money safety.** `milk_payment` is zero-sum + idempotent; a non-approved bill moves no money (unit-asserted);
  net can never be negative (deductions > gross rejected). Audit row on MCC create + bill pay (+ rate-card create
  and approve, HOTFIX-12). A pour has no audit row of its own: the pour row is the record (`entered_by`, append-only).
- **Tenant isolation + bounds.** `tenant_id` in every query + RLS (integration proves cross-tenant denial);
  every list is keyset-paginated with a max `LIMIT`; the cycle job is bounded + partition-pruned.

## Events (outbox, Law 4)
`dairy.mcc_created`, `dairy.membership_created`, `dairy.rate_card_created`, `dairy.rate_card_approved` (HOTFIX-12, member notice), `dairy.collection_recorded`,
`dairy.bill_generated/previewed/approved/paid/disputed`.

## Jobs
`milk-bill-cycle-close.job.ts` — per-cycle, finds memberships with unbilled collections in the window
(cross-tenant via kv_relay, bounded, partition-pruned) and generates draft bills (idempotent per period).

## Scope & deferrals
**In scope:** MCC centres, memberships, rate cards (pricing engine), collections (partitioned), milk bills + wallet payout, cycle-close job.
**Deferred (schema in 0009, not wired):** cooperative governance (share registers / resolutions / votes), D2C
subscriptions + deliveries + route planning, adulteration-pattern scan, Lactoscan analyzer ingestion
(`milk_collections.device_payload` has no writer), and **bank-disbursement payout** (`payout_id` → payments payout
path). (Corrected by HOTFIX-12, survey OPS-3 C-4: BMC units and readings are wired since TENANT-6d-1, and
`bonus_rules` is read since TENANT-6b-1.)

## Tests
- `__tests__/dairy-domain.spec.ts` — float-free pricing math (exact), bill state machine + net, collection/rate-card invariants.
- `__tests__/milk-bill.service.spec.ts` — pay() zero-sum tenant→farmer milk_payment legs; no money on a non-approved bill.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id binding, FOR UPDATE, keyset, partition-pruned date ranges).
- `__tests__/dairy.integration.spec.ts` — real Postgres: MCC→member→rate card→2 collections→bill→approve→**pay (wallet zero-sum)**→RLS.

> No Postgres in the sandbox, so the live RLS / partitioned-insert / zero-sum payout assertions run on the first CI run with a service container.
