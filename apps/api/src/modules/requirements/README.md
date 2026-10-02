# requirements module (PRD M12 — reverse marketplace / demand)

Buyers **post a requirement** (a demand: product/category, quantity, budget band, need-by); sellers
**quote** against it (a `requirement_response`); the buyer **shortlists** and **accepts** one quote,
which **fulfils** the requirement and creates the order downstream. The mirror image of `listings`
(supply): here demand comes first. Built to the `listings`/`offers` bar. Gated by the `requirements`
feature flag (default OFF).

## What it owns
- **Requirement lifecycle** — `open -> partially_matched -> fulfilled`, plus terminal `expired`
  (need-by passed, worker job) / `closed` (buyer withdraws). State machine in
  `domain/requirement.state.ts` (mirrors the `requirement_status` enum).
- **Quote (response) lifecycle** — `submitted -> shortlisted -> accepted`, plus `rejected` (buyer
  declines / seller withdraws) / `expired` (valid-until passed). One quote per `(requirement, seller)`
  (DB `UNIQUE`). State machine in `domain/requirement-response.state.ts`.
- **Post** — `POST /v1/requirements` (`requirement.post`, Idempotency-Key).
- **Quote** — `POST /v1/requirements/:id/responses` (`requirement.quote`, Idempotency-Key). A quote may
  name the seller's own **published** listing; naming someone else's, or an unpublished one, is rejected.
- **Buyer decisions** — `POST /v1/responses/:id/shortlist|accept|reject`. Accepting (one ACID tx) marks
  the quote `accepted` and adds its accepted quantity to the requirement (11d: fulfilled by QUANTITY), and emits `requirements.quote_accepted` (buyer,
  seller, listing, quoted price, qty) via the **outbox**.
- **Order from an accepted quote** — the orders module's `QuoteAcceptedHandler` consumes
  `requirements.quote_accepted` and creates the order (`source='requirement'`, `requirement_id` set —
  the provenance link; requirements has no order_id column, so `orders.requirement_id` IS the link).
  Since 11d: ONE order per accepted RESPONSE, idempotent on `requirement_responses.order_id` (see below).
- **Expiry** — the `expire-requirements` worker lapses requirements past `need_by` and quotes past
  `valid_until` (kv_relay pool, `FOR UPDATE SKIP LOCKED`, bounded, idempotent).

## Security properties (threats considered)
- **Tenant isolation (Law 1)** — `tenant_id` in every query + RLS (auto-applied by migration 0014;
  the integration test proves tenant B sees zero of tenant A's requirements).
- **No self-deal** — a buyer cannot quote on their own requirement (`REQUIREMENT_SELF_QUOTE`); a seller
  can only quote their **own** published listing (seller/listing resolved via ListingService — Law 11).
- **Authorization that throws** — only the requirement's buyer (or a moderator) may shortlist/accept/
  close; a quote's seller may withdraw their own; everyone else gets `REQUIREMENT_FORBIDDEN`.
- **No competitor leakage (anti-IDOR)** — a seller listing a requirement's quotes sees **only their
  own**; the full quote list is the buyer's view. A non-party cannot read a quote.
- **No money here** — a requirement/quote moves no funds; the wallet is untouched until the order
  (downstream) goes through payments. Quote prices are `bigint` minor units.
- **Concurrency** — neither table has a version column (add_std_columns), so every mutation locks the
  row `SELECT ... FOR UPDATE`; accept locks both the quote and its requirement in one tx. Lists are
  **keyset** (cursor, never OFFSET).
- **Write-amplification bound** — accepting does NOT bulk-reject the other (possibly thousands of)
  quotes; the requirement simply becomes `fulfilled`. Losing quotes lapse via `valid_until`.
- **Idempotency** — `post` and `quote` are idempotent per `(user, endpoint)`; the `(requirement,
  seller)` uniqueness stops duplicate quotes; lifecycle actions are guarded by FOR UPDATE + the state
  machine. The downstream order is idempotent on `orders.requirement_id`.
- **Audit** — accepting a quote writes an append-only `audit_log` row in the same tx.

## Endpoints
`POST /v1/requirements` · `GET /v1/requirements?box=open|mine` · `GET /v1/requirements/:id` ·
`POST /v1/requirements/:id/close` · `POST /v1/requirements/:id/responses` (quote) ·
`GET /v1/requirements/:id/responses` · `GET /v1/responses/:id` ·
`POST /v1/responses/:id/shortlist|accept|reject`.

## Tests
Unit (`requirement.service.spec.ts`): both state machines + aggregates. `tenant-isolation.spec.ts`:
SQL contract (tenant_id everywhere, FOR UPDATE, no version clause, keyset, SKIP LOCKED, ON CONFLICT).
Integration (`requirements.integration.spec.ts`, real Postgres + RLS): post -> two quotes ->
self-quote blocked -> duplicate blocked -> seller sees only own quote -> shortlist -> accept
(fulfilled + quote_accepted in outbox) -> cross-tenant RLS denial. `quote-to-order.integration.spec.ts`:
accepted quote relays to an order (`source='requirement'`) and is idempotent.

## PC-56 TENANT-11d — linked responses, one order per member, per-member consent before send
- **Buyer desk** (`requirement.desk`: tenant_admin, fpo_coordinator) posts AS a named buyer (`onBehalf { buyerUserId, consent }`;
  `requirement_consents` act=post; `posted_by` = the desk; the buyer is the member). It decides on the buyer's quotes only with
  the buyer's consent for THAT act (shortlist / accept / reject). Moderators read and close (with a reason); they no longer decide.
- **Pooled quote** (`requirement_response_groups` + `requirement_group_lines`, 0189): draft → lines from member stock (published,
  same unit, available ≥ quantity, one per member, never the buyer) → each member's consent to exactly their figures (an edit
  clears it, DB trigger) → send (refused `CONSENT_MISSING`, naming the member, while any line lacks it) writes one
  `requirement_responses` row per line (`group_id`, `consent_id`, valid 48 h) in one transaction; `requirement.group_quoted`
  reaches the buyer. Blended price = floor(Σ qty×price ÷ Σ qty) in integer thousandths, remainder shown.
- **Accept by quantity**: `POST /v1/responses/:id/accept { quantity? }` or `POST /v1/responses/groups/:gid/accept`; the
  requirement's `fulfilled_quantity` grows; `partially_matched` / `fulfilled` follow the quantity. Each accepted response becomes
  ONE order (orders' `QuoteAcceptedHandler` → `RequirementOrderService`, kv_app UoW, `requirement_responses.order_id`).
- **Member stock** `GET /v1/requirements/:id/matches` — rule-based (same product, else category; same unit; price ascending,
  then distance when both pincodes carry coordinates). `ai_match_score` stays unwritten: "AI score not yet available".
- **Jobs**: `ExpireRequirementsJob` + `MatchNotificationsJob` (need-by reminder) are registered in `SCHEDULED_JOB_REGISTRY` and
  claim per tenant in kv_app's unit of work (the only kv_relay read is `tenants`).
- Every act is audited (actor · reason · before/after · ip); cursors are µs; `REQ-<mmdd>-<nn>` by trigger.

## Deferred (flagged, not faked) — next wave
- **AI match scoring** — the `ai_match_score` column is reserved for an AI ranking service; nothing writes it (11d).

## Async glue (API-W4-01)
- **Buyer edit** — `UpdateRequirementSchema` (zod .strict) + `Requirement.editDetails` (OPEN/partially_matched only,
  invariants re-validated, emits `requirements.requirement_updated`) + `PATCH /v1/requirements/:id` (buyer or moderator,
  FOR UPDATE-locked, audited).
- **`ListingPublishedHandler`** (`listing.published`) — on a new published listing, matches OPEN requirements by
  product/category (the listing's matchable attrs travel in the event — no listings read, Law 11), excludes the
  seller's own requirements, and emits `requirements.requirement_matched` per match (bounded LIMIT 50 → caps
  write-amplification). Communication fans it out to the buyer.
- **`MatchNotificationsJob`** (worker) — the periodic backstop: since Law 11 forbids reading listings, the
  self-contained role is a need-by **reminder** for OPEN requirements (`requirements.requirement_reminder`),
  gated by `reminded_at` (migration 0044) so a re-run never re-nudges. Cross-tenant, SKIP LOCKED, bounded.
