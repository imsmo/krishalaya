# Livestock (M15) — animal registry + vet marketplace

The animal asset registry (Pashu Aadhaar / INAPH) and the **veterinary services marketplace**, built to the
platform laws. Gated by the **`livestock`** feature flag (default **OFF**).

## The money path (Law 2 — wallet boundary only)
Vet-fee settlement (`POST /v1/livestock/vet-bookings/:id/complete`) transfers the consultation fee
**farmer `userMain` → vet `userMain`**, `txnType = 'service_fee'`, as a **zero-sum, idempotent** ledger txn
(`vetfee:<bookingId>`). The fee is **snapshotted** from the vet's `vet_services.price_minor` at booking time
(never client-supplied). The **farmer** (the payer) initiates completion+payment; the wallet's no-overdraw
rule means the farmer must hold the balance. Livestock never touches the ledger directly. (Commission split
on the vet fee is deferred — currently the full fee flows to the vet.)

## Lifecycle (Law 5 — state machines in `domain/*.state.ts`)
- **Animal**: `active → sold | deceased | lost` (terminal). Husbandry edits refused once retired.
- **Vet booking**: `requested → accepted → en_route → in_consult → prescribed → completed` (+ farmer cancel
  from requested/accepted; vet `no_show`). The **vet** drives accept→…→prescribed; the **farmer** confirms
  completion (only from `in_consult`/`prescribed`), which settles the fee in the same tx.
- No version columns on these tables → mutations lock the row **FOR UPDATE**.

## Endpoints
- `GET /v1/livestock/species` · `GET /v1/livestock/breeds?speciesId=` — seeded taxonomy browse.
- `POST /v1/livestock/animals` (idempotent, `animal.manage`) · `GET /animals[?box=mine|all]` · `GET /animals/:id`
  · `PATCH /animals/:id` · `POST /animals/:id/retire`.
- `POST /v1/livestock/vets` (idempotent, `vet.manage`) · `POST /vets/services` · `GET /vets/me` · `GET /vets[/:id]`.
- `POST /v1/livestock/vet-bookings` (idempotent, `vet.book`) · `GET` (?box=farmer|vet) · `GET /:id`
  · `POST /:id/progress` (vet, `vet.manage`) · `POST /:id/cancel` (farmer) · `POST /:id/complete` (idempotent, `vet.book`).

## Security — threats considered
- **No cross-owner/cross-party IDOR.** Animal reads 404 for non-owners (a `booking.manage` holder still reads any animal — recorded,
  PC-56 OPS-4b); vet-booking reads 404 unless the caller is the farmer or the assigned vet; `animalId` on a booking is ownership-checked.
- **[PC-56 OPS-4b] Her animal, her word.** Editing and retiring an animal are its OWNER's acts only — the administrator escape is gone.
- **[PC-56 HOTFIX-13 — CORRECTED, survey C-11] The health file is party-only.** `GET/POST /animals/:id/health-events` open to the animal's
  owner and to a vet who has accepted a booking on that animal; everyone else (every other farmer and vet) gets 404; every write recorded.
  Prescriptions: the farmer and the vet of record only.
- **[PC-56 OPS-4b · founder Q4-A applied] A tag reveals nothing.** Registering a Pashu Aadhaar that any organisation already holds answers
  409 `PASHU_AADHAAR_EXISTS` with the same words everywhere — "This tag number cannot be registered." — and no tenant, owner or animal. The
  409 still shows the number is taken somewhere (the tag is unique across all organisations, 0009); closing that needs ownership transfer
  (OPS4-B13, a migration).
- **Anti-mass-assignment.** All DTOs are zod `.strict()`. The fee and `service_type_id` are server-resolved
  (the latter from the platform `vet_service` lookup, `tenant_id IS NULL`) — never trusted from the client.
- **AuthZ throws.** `animal.manage` (owner), `vet.book` (farmer/payer), `vet.manage` (the owning vet); the
  vet-lifecycle guard resolves the caller's vet profile and matches it to the booking.
- **Tenant isolation.** `tenant_id` in every query + RLS; the integration test proves cross-tenant denial.
- **Money safety.** `service_fee` is zero-sum + idempotent; failure moves no money (asserted in unit tests).
- **Bounded + keyset.** Every list has a max `LIMIT` and keyset (never OFFSET) pagination.

## Events (outbox, Law 4)
`livestock.animal_registered/updated/retired`, `livestock.vet_registered`, `livestock.vet_service_set`,
`livestock.vet_booking_requested/accepted/progressed/completed/cancelled/no_show`, `livestock.vet_fee_paid`.

## Scope & deferrals
**In scope:** species/breeds (master data), animals (registry), vet profiles + service catalog, vet bookings + fee settlement.
**[PC-56 OPS-4b — CORRECTED, survey C-10/C-11]** animal health events ARE wired (PC-54 W54-4, `services/health.service.ts`; party-only
since HOTFIX-13). **Ownership transfer does NOT exist:** `animal_ownership_transfers` (0009) has no writer, no route and no client — nothing
changes who owns an animal, and a sold animal's tag can never be registered again (UNIQUE over all rows). No route looks an animal up by tag
but the `booking.manage` list filter (`GET /animals?box=all&pashuAadhaar=`).
**Deferred (schema in 0009, not wired):** ownership transfers
(INAPH re-registration), animal attribute EAV, livestock-for-sale listings, prescriptions + items, semen
catalog + insemination/AI records, disease-outbreak geofence alerts, vaccination/PD reminder + INAPH-sync jobs,
vet-fee commission split. **All DAIRY tables (MCC/milk/coop/D2C) belong to module #16.**

## Tests
- `__tests__/livestock-domain.spec.ts` — animal + vet-booking state machines, aggregates, completion gate, price invariant.
- `__tests__/vet-booking.service.spec.ts` — fee snapshot, service↔vet anti-IDOR, completeAndPay zero-sum wallet legs, no-money-on-failure.
- `__tests__/tenant-isolation.spec.ts` — SQL contract (tenant_id binding, FOR UPDATE, keyset, platform-scoped lookup).
- `__tests__/livestock.integration.spec.ts` — real Postgres: register animal → vet + service → book → lifecycle → **complete+pay (wallet zero-sum)** → RLS cross-tenant.

> No Postgres in the sandbox, so the live RLS / zero-sum fee-settlement assertions run on the first CI run with a service container.
