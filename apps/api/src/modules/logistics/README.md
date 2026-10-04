# logistics module (PRD M07 — fulfilment & delivery)

Turns a confirmed order into a physical **shipment** and drives it to the buyer with **OTP-gated
proof-of-delivery**. A confirmed order auto-creates a shipment; ops/riders move it
`pending → assigned → … → out_for_delivery → delivered`; delivery requires the buyer's OTP; on
delivery the order is advanced to `delivered` (opening the quality/dispute window → settlement).
Built to the `listings`/`orders` bar. Gated by the `logistics` feature flag (default OFF).

## What it owns
- **Shipment lifecycle** — `pending → assigned → pickup_scheduled → picked_up → in_transit → at_hub →
  out_for_delivery → delivered`, plus `failed` (re-attemptable) / `returned` / `cancelled`. State
  machine in `domain/shipment.state.ts` (mirrors the `shipment_status` enum). Every status change
  appends an immutable `shipment_events` tracking row.
- **Auto-creation from orders** — `OrderConfirmedHandler` consumes `orders.order_confirmed` and creates
  ONE pending shipment per order (idempotent on `(tenant_id, order_id)` — index in migration 0023).
- **Dispatch & OTP** — `out_for_delivery` generates a 6-digit OTP, stores **only its HMAC hash**
  (server pepper), and hands the raw code to the (deferred) SMS relay via the internal
  `logistics.delivery_otp_issued` outbox event. The hash is the only OTP material at rest.
- **Proof-of-delivery** — `deliver` verifies the submitted OTP's hash in **constant time** (in the
  entity); optional signed POD media id is recorded. On success it emits `logistics.shipment_delivered`.
- **Order bridge** — orders' `ShipmentDeliveredHandler` consumes `logistics.shipment_delivered` and
  advances the order to `delivered` via `Order.recordCarrierDelivery()` (walks only LEGAL state-machine
  edges; idempotent). The order's manual fulfilment chain (picked_up/in_transit/out_for_delivery) is
  carrier-driven — logistics is the source of truth for physical movement.

## Security properties (threats considered)
- **Tenant isolation (Law 1)** — `tenant_id` in every query + RLS; the integration test proves tenant B
  sees zero of tenant A's shipments. Partitioned reads prune via `uuid_v7_time(id)` (Law 8).
- **OTP at rest is hashed** — the delivery code is never stored or returned in plaintext; only its
  HMAC-SHA256 hash (server pepper) lives on the shipment, compared in constant time. A DB dump reveals
  no codes. The raw code travels only in the internal SMS-relay outbox event (consumed + purged by the
  notifications relay; never logged, never in an API response).
- **Authorization that throws** — `create/assign/schedule/cancel` require `logistics.manage`;
  `pickup/in_transit/out_for_delivery/deliver/fail` are manager-OR-the-assigned-rider (a rider can only
  act on shipments where `rider_user_id` = them). Everyone else gets `SHIPMENT_FORBIDDEN`.
- **No money here** — `charge_minor`/`cod_minor` are bigint minor units carried for reference; no funds
  move in this module (COD settlement is a payments concern).
- **Concurrency** — no version column → every mutation locks the row `SELECT … FOR UPDATE`; status
  changes go only through the state machine. Lists are **keyset** (cursor, never OFFSET); all bounded.
- **Idempotency** — `create` is idempotent per `(user, endpoint)` + a one-shipment-per-order guard;
  the order-confirmed handler is idempotent on `existsForOrder`; delivery is single-shot (the entity
  state machine blocks re-delivery). Audit rows on deliver/fail/cancel.

## Fleet registry (API-W3-03) — partners · vehicles · pickup slots
The carrier/asset/pickup master-data a tenant manages so shipments can be assigned to a real carrier,
vehicle, and seller pickup window. Backed by `0007` (`logistics_partners`, `vehicles`, `pickup_slots`).
- **Logistics partners** (`domain/logistics-partner.entity.ts`) — a 3PL link, a tenant's own fleet, or
  an individual rider (`partner_kind ∈ 3pl|tenant_fleet|rider`; a `rider` requires a `rider_user_id`).
  **Hybrid-tenant**: rows with `tenant_id NULL` are **platform** 3PLs written in `apps/admin-api`
  (Law 11) and are **read-only** here; a tenant's own partners carry its `tenant_id`.
- **Vehicles** (`domain/vehicle.entity.ts`) — belong to a partner's fleet. `reg_no` is normalised
  (upper-case, spaces/dots stripped) and is **unique per partner** — a duplicate plate surfaces as a
  typed `VEHICLE_REG_EXISTS` (409). `capacity_kg` is a weight (numeric), never money. `is_refrigerated`
  flags cold-chain capable assets.
- **Pickup slots** (`domain/pickup-slot.entity.ts`) — a **seller's own** weekly pickup window
  (`weekday 0–6`, `start_time < end_time`, 24h). Ownership IS the authorization: a seller only ever
  sees/edits slots where `seller_user_id` = caller; no cross-seller visibility.

Each create/update/activate runs in one ACID tx (UoW) and writes its outbox event + audit row in the
SAME tx (Laws 1/4). Carrier/vehicle writes require `logistics.manage`; pickup slots are self-serve.
Lifecycle events: `logistics.partner_registered` / `logistics.vehicle_registered` /
`logistics.pickup_slot_created`.

## Zones, routes & cold-chain (API-W3-04)
The ops-planning layer on top of the fleet. Backed by `0007` (`delivery_zones`, `delivery_routes`,
`cold_chain_logs`).
- **Delivery zones** (`domain/delivery-zone.entity.ts`) — a tenant's serviceability + charge zoning: a
  set of 6-digit Indian PINs + geo `region_ids`, optionally linked to a `charge_definition_id` (payments
  owns the charge; a bad FK surfaces as a typed 422). `servesPincode()` powers checkout serviceability.
  Pincode/region lists are de-duped and bounded (≤5000/≤2000) in the domain AND the zod DTO.
- **Delivery routes** (`domain/delivery-route.entity.ts`) — the signature **Saturday Village Run**: a
  recurring consolidation route over a cluster of `village_region_ids`, optionally on a fixed weekday,
  served by a vehicle and dropped at a `consolidation_user_id` (often an ambassador).
- **Cold-chain logs** (`domain/cold-chain-log.entity.ts`) — **append-only** reefer/vaccine temperature
  telemetry (DB REVOKEs UPDATE/DELETE; partitioned by `recorded_at`, bigserial id). `is_breach` is
  computed at record time from the band COPIED from `cold_chain_thresholds` (never from the body — SW-e) and is
  immutable thereafter; `source` is device (signed ingest, kv_ingest) or manual (server time). Temperatures are
  decimals, never money.

Zone/route writes run in one ACID tx (UoW) with the outbox event + audit row in the SAME tx and require
`logistics.manage`. Cold-chain readings are appended (one INSERT, no per-reading outbox — telemetry
volume). Two worker jobs (apps/worker, system pool):
- ~~cold-chain-breach-alerts~~ — REMOVED in PC-56 TENANT-SW-e (it was never registered, and alerted per manual
  excursion). A breach is now opened IN THE DATABASE by the AFTER INSERT trigger on `cold_chain_logs` when two
  consecutive DEVICE readings fall outside the band copied from `cold_chain_thresholds`; the same transaction writes
  the `cold_chain_breaches` row, the `ops_fired_alerts` row and the `logistics.cold_chain_breach` outbox event. A manual
  reading is labelled and never opens one. The registered `logistics-cold-chain-watch` job (every minute, per tenant in
  kv_app's unit of work) flags a logger silent > 15 min ("alerted, not called") and offers the buyer accept /
  accept-with-test / reject on a shipment breach out of band ≥ 15 min; `logistics-slot-proposal-expiry` expires pickup-
  slot proposals unanswered for 7 days.
- **village-run-consolidation** — once per calendar date, emits one `logistics.village_run_due` per active
  route scheduled for today's weekday (→ notifications for the driver/consolidation point); idempotent per
  date via an `ops_job_runs` date-guard.

## Endpoints
Shipments: `POST /v1/shipments` (ops create) · `GET /v1/shipments?box=all|mine[&status=&orderId=]` ·
`GET /v1/shipments/:id` · `POST /v1/shipments/:id/assign` · `…/schedule-pickup` · `…/picked-up` ·
`…/in-transit` · `…/at-hub` · `…/out-for-delivery` · `…/deliver` (OTP) · `…/fail` · `…/cancel`.
Fleet: `POST|GET /v1/logistics/partners` · `GET|PATCH /v1/logistics/partners/:id` · `…/:id/active` ·
`POST|GET /v1/logistics/vehicles` · `GET|PATCH /v1/logistics/vehicles/:id` · `…/:id/active` ·
`POST|GET /v1/logistics/pickup-slots` · `GET|PATCH /v1/logistics/pickup-slots/:id` · `…/:id/active`.
Zones/routes/cold-chain: `POST|GET /v1/logistics/zones` · `GET|PATCH /v1/logistics/zones/:id` · `…/:id/active` ·
`POST|GET /v1/logistics/routes` · `GET|PATCH /v1/logistics/routes/:id` · `…/:id/active` ·
`POST|GET /v1/logistics/cold-chain/readings`
(all gated by the `logistics` flag; creates require an `Idempotency-Key`; lists are keyset/bounded).

## Tests
Unit (`shipment.service.spec.ts`): state machine + aggregate + OTP-gated delivery (match / wrong /
missing, constant-time). `tenant-isolation.spec.ts`: SQL contract (tenant_id everywhere, partition
prune, FOR UPDATE, no version, keyset, tracking events). Integration (`logistics.integration.spec.ts`,
real Postgres + RLS + relay): order_confirmed → auto-shipment (idempotent) → assign/pickup/dispatch
(OTP hashed) → wrong-OTP rejected → correct-OTP delivers → relay → order delivered → cross-tenant RLS.
Orders unit (`carrier-delivery.spec.ts`): `recordCarrierDelivery` legal-edge walk + idempotency.
Fleet unit (`fleet.spec.ts`): partner/vehicle/pickup-slot invariants (kind/rider rule, reg-no
normalisation, weekday/window validation, idempotent activate/update). Fleet integration
(`fleet.integration.spec.ts`, real Postgres + RLS): partner→vehicle→slot persist with the caller's
tenant_id + outbox event, authorization throws without `logistics.manage`, duplicate reg-no → 409,
seller-scoped slot reads, and tenant B cannot see tenant A's partner.

## Tests (zones-routing)
Unit (`zones-routing.spec.ts`): zone pincode/region validation + de-dupe + serviceability, route
weekday/region validation, cold-chain breach computation + sensor-envelope guards. Integration
(`zones-routing.integration.spec.ts`, real Postgres + RLS + jobs): zone persists with tenant_id + outbox
event; cold-chain breach recorded and the worker alerts EXACTLY once across a re-run (watermark dedup);
village-run job emits one due-event per scheduled route and is idempotent per date; tenant B cannot see
tenant A's zone.

## Fully built — no deferred sub-features
The whole logistics module is now live: shipment spine, fleet registry (API-W3-03), and zones-routing +
cold-chain (API-W3-04). The only remaining external touch-points are downstream consumers in OTHER modules
(notifications relaying `logistics.delivery_otp_issued` / `cold_chain_breach` / `village_run_due`, and the
payments COD reconciliation), which land with those modules — not here.
- **Delivery-OTP SMS dispatch** — the OTP is generated + hashed here and emitted on
  `logistics.delivery_otp_issued`; the actual SMS send lands with the communication/notifications module.
- **COD reconciliation** (cash collected → wallet) lands with the payments COD flow.
