# insurance (Agri-Insurance, PRD M19)

DEV-22 (KV-BL-051/052), Insurance Wave 1-2. Built to the `listings`/`fintech` reference-bar standard: controller
guards → Zod `.strict()` DTOs → `UnitOfWork` txn + RLS + outbox → parameterized repos → unit + integration tests.

## Scope (this batch)

- **Catalogue (read-only, global reference data):** IRDAI-gated insurer list + detail (`GET /v1/insurance/partners`,
  `GET /v1/insurance/partners/:id` — always `partner_kind='insurer'`, reuses `FintechModule`'s
  `FinancialPartnerService`, Law 11); product catalogue (`GET /v1/insurance/products`, `GET /v1/insurance/products/:id`
  — keyset-paginated, Law 11).
- **Enrolment (screens 283-285):** `POST /v1/insurance/policies` creates one `insurance_policies` row per
  subject in `dto.subjects` (screen 284's multi-animal case), status `proposed`, server-computed premium.
  `POST /v1/insurance/policies/:id/cancel` withdraws before payment. `GET /v1/insurance/policies` ("my
  policies", screen 287) + `GET /v1/insurance/policies/:id` (detail, screen 286).
- **Feature flag:** `insurance` (DB-backed, seeded OFF in `db/seeds/core/0009_feature_flags.sql`).
- **Permissions:** `insurance.enrol` (farmer/pashupalak/dairy_farmer/vyapari), `insurance.manage`
  (insurance_agent/tenant_admin) — seeded in `db/seeds/core/0004_roles_permissions.sql`.

## Explicit boundaries (out of scope, deferred to later waves)

- **Premium collection + activation (proposed→active)** — KV-BL-053/DEV-23. This module only wires the
  `premium_payment_id` socket (nullable column, set once DEV-23 collects payment via the existing payments
  module) — it never builds payment capture, never moves money.
- **Claims (insurance_claims, file→adjudicate→survey→pay)** — KV-BL-054/DEV-23.
- **Worker PMSBY mobile flow, partner console, family-member/nominee capture (screen 285)** — KV-BL-055/056,
  tracked against the already-filed `KV-BL-036` (`policy_nominees` table, explicitly deferred/POST-GA).
- **External integrations (PMFBY sync, surveyor dispatch, vet-cert, auto-debit)** — KV-BL-057/DEV-25.

## Known schema debt (flagged for founder arbitration, not fixed this batch — no new migrations)

1. No `currency_code` on `insurance_products`/`insurance_policies` (mirrors the identical, already-shipped
   `loan_products`/`loan_applications` gap in `fintech`).
2. No family-member/nominee table for the health+life bundle (screen 285) — tracked against `KV-BL-036`.

See `Development_Program/dev_specs/spec_dev22.md` / `dev22_report.md` for the full reference-chain conformance
table, endpoint list, and state-machine text.

## PC-56 PARTNER-2a (2026-10-18) — the tenant realm authors nothing

- `AuthoringController` (`/v1/insurance/authoring/*`) is behind `@FeatureFlag('insurance')` like its siblings (OFF → 404).
- `POST products` / `PATCH products/:id` → 403 `INSURANCE_PRODUCT_PLATFORM_AUTHORED` (founder Q7: the platform authors products in the
  admin realm after a signed agreement — that writer is not built yet); `POST policies/:id/issue` → 403 `INSURANCE_ISSUE_NOT_ON_PLATFORM`
  (founder Q5). Nothing is written; the repository's write methods are removed.
- `premium_calc` has ONE shape, owned by `domain/premium-calc.ts`: `{kind:'pct_of_sum_insured', bps:<integer>}` or
  `{kind:'flat_minor', amountMinor:'<digits>'}` (`isAuthorablePremiumCalc` = `parsePremiumCalc`). A float percentage and parametric terms
  are refused.
- An insurer reads its OWN products and the policy facts written on them in the partner realm (`modules/partner-console`,
  `partner.insurance.read`, migration 0228) — never a policyholder's identity.
- Stale above (survey C-9): premium collection + activation and claims settlement exist (see `insurance.module.ts`).
