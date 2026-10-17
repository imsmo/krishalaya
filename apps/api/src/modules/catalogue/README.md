# catalogue module (PRD M02)

The dynamic catalogue: the category taxonomy, typed attributes, and the product master
("the thing") that `listings` ("the offer") references. Built to the `listings`/`identity` bar.

## What it owns (tenant-facing surface)
- **Categories** — browse the global 5-level taxonomy (ltree), and enable/disable branches for
  the tenant's own storefront (`tenant_categories`).
- **Attributes** — resolve the typed attributes (with options) that apply to a category,
  **including inherited ones from ancestor categories** (ltree `path @>`), for forms + search facets.
- **EAV read engine** (API-W3-01) — standalone reads the storefront + listing-create consume:
  an attribute's dropdown **options** (`GET /v1/attributes/options?attributeId=`), the raw
  **category-attribute bindings** incl. inherited (`GET /v1/attributes/bindings?categoryId=`),
  clonable **attribute templates** (`GET /v1/attribute-templates[/:code]`), and the global
  **brands** picker (`GET /v1/brands[/:id]`). `AttributeTemplate.resolveItems()` validates the
  master payload (malformed → 422, never 500); `CategoryAttribute.appliesWhen/conditionalRequired`
  evaluate `{if/then}` conditionals (e.g. organic ⇒ cert fields required) — pure + unit-tested.
- **Products** — browse/search (platform-master + the tenant's own), and create/update/deactivate
  the tenant's **own private** products with validated typed attribute values.
- **Product batches** — regulated-input store inventory (expiry, FIFO consume, recalls), gated by
  the `product_batches` feature flag.
- **Certificates** (API-W3-02) — organic/GI/lab certs attached to a product/farm/listing/tenant. A tenant
  submits (status `pending`, idempotent), a moderator verifies/rejects (`certificate.verify`), and a worker job
  expires verified certs past their validity window. State machine `pending→verified→expired|rejected` (Law 5);
  proof is a `media_assets` id (never raw bytes); events to the outbox; audit on the decision.
  `GET /v1/certificates`, `POST /v1/certificates` (Idempotency-Key), `POST /v1/certificates/:id/decision`.
- **Regulated-input rules** (API-W3-02) — read resolver for `regulated_product_rules` (banned-state /
  prescription / license / safety-label) applying to a product or its category branch, effective today, by region
  — the listing-time compliance hook. `GET /v1/certificates/regulated-rules?productId=…&categoryId=…`. Rules are
  GLOBAL master (written in apps/admin-api, Law 11) — read-only here.
- **Worker jobs** — `certificate-expiry-alerts` (verified→expired past validity) and `batch-expiry-alerts`
  (`catalogue.batch_expiring` reminders for in-stock batches expiring within 30 days); both claim across tenants
  with `FOR UPDATE SKIP LOCKED`, bounded per tick, idempotent.

## Security properties (threats considered)
- **Tenant isolation**: products are hybrid — `tenant_id NULL` = platform master (read-only here),
  set = tenant-private. RLS enforces `tenant_id IS NULL OR tenant_id = current_tenant_id()`, and
  every query also binds it (Law 1). Writes only ever touch the caller's OWN products
  (`getForUpdate` is tenant-scoped + `FOR UPDATE`). Proven by the integration test (tenant B cannot
  see tenant A's private product; both see the platform master).
- **No platform escalation (Law 11)**: GLOBAL taxonomy writes (categories, attribute defs/options,
  platform products, brands, templates, regulated rules) are **NOT** exposed here — they belong to
  apps/admin-api. This module only does reads + tenant-scoped writes.
- **Input validation**: zod `.strict()` DTOs; submitted attribute values are validated against their
  definitions (type, min/max, regex, allowed option ids) before persistence — an attacker can't
  inject an out-of-range or unknown-option value.
- **Idempotent** create (per-user scoped key); **audit** on batch recall; **metrics** on every
  use-case; **cursor** (keyset) pagination only; **bounded** lists; reads on the **replica** (CQRS).
- Money (`mrp_minor`) is `bigint` minor units; never float.

## Endpoints
`GET /v1/categories` (tree) · `POST /v1/categories/tenant-toggle` (configure) ·
`GET /v1/attributes?categoryId=` · `GET /v1/products` (search) · `GET /v1/products/:id` ·
`POST/PATCH /v1/products[/:id]` · `POST /v1/products/:id/deactivate` ·
`GET/POST /v1/product-batches`, `POST /v1/product-batches/:id/recall` (flag: `product_batches`).

## Tests
Unit: product invariants + lifecycle, attribute typed validation, batch consume/recall/expiry,
tenant-isolation SQL contract. Integration (`catalogue.integration.spec.ts`, real Postgres + RLS):
create tenant product → outbox + search visibility, platform-master visibility, idempotency,
batch recall + audit, cross-tenant RLS denial. The integration DB is built from the REAL
`db/migrations` + `db/seeds` (via `test/integration-global-setup.js`); the spec inserts only its
own fixtures (`test/helpers/fixtures.ts`).

## Deferred (flagged, not faked) — Phase 2 / admin-api
Global taxonomy CRUD (admin-api), certificates (organic/GI — overlaps KYC, organic phase),
regulated-product-rule enforcement at listing time (Phase 2 hook), attribute templates & brands
write, OpenSearch relevance search (Phase 2; current search is replica `search_tsv` + ILIKE).


## PC-56 STORE-5b (2026-10-17) — supersedes the claims above where they disagree
- **`certificate-expiry` is registered** (`CertificateExpiryClock`, daily, flag-independent) — it was never registered (survey C-5). Nothing needs
  to consume `catalogue.certificate_expired`: the listing badge is read from the certificate at READ time (`listings/read-models/certified.sql.ts`).
- **The `cert_type` vocabulary exists** (0219: npop · pgs_india · usda_organic · gi_tag · lab_report · gap · halal, hi/gu; `meta.organic` marks the
  organic schemes); `certTypeId` outside it → 422 `CERTIFICATE_TYPE_UNKNOWN`.
- `verify` stamps `verified_at`; `reject` stores `rejection_reason` (≤ 500).
- **The public certificate** `GET /v1/certificates/public/:id` and `GET /v1/certificates/public?no=` (the request's organisation) — SECURITY DEFINER
  `public_certificate*`, NULL unless the organisation is live; behind `certificates_public` (seeded OFF) → `CERTIFICATE_NOT_PUBLISHED`. "Checked
  by <organisation> (<the verifier's role>)" — the organisation's check, never the person, never "platform-verified".
