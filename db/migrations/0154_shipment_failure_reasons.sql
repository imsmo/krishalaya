-- =============================================================================================
-- 0154_shipment_failure_reasons.sql · PC-56 TENANT-5d — THE CHART OVER A REASON NOBODY STORED
-- =============================================================================================
-- W244 (Logistics insights) draws a five-bar chart: "Failed-delivery reasons (90d, 118 events)" —
-- gate closed · reschedule · address · vehicle · weather — and hangs a decision on it: "the 30-min call-ahead
-- pilot starts Monday on the Rajkot lane; if first-attempt clears 95%, it becomes policy."
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE WAVE'S HEADLINE): THE FAILURE REASON WAS NEVER WRITTEN TO THE DATABASE
-- ---------------------------------------------------------------------------------------------
-- `POST /v1/logistics/shipments/:id/fail` has taken a `reason` since the module was written.
-- `Shipment.markFailed(reason)` puts it in a DOMAIN EVENT payload — `{ reason, attemptNo }` — which goes to the
-- outbox, and from there to webhooks. And `ShipmentRepository.update`, the only writer of a status hop into
-- `shipment_events`, calls:
--
--     if (fromStatus !== p.status) await this.recordEvent(tx, p.tenantId, p.id, p.status, null);
--                                                                                        ^^^^
-- `note` is hardcoded NULL for every state change ever recorded. So the reason a delivery failed exists in no
-- column of this database: not on `shipments`, not on `shipment_events`, not in a vocabulary. It survives only in
-- an outbox payload, which is a transport, not a record.
--
-- **A chart cannot be grouped by a column that does not exist.** This is not "free text we must bucket" — this is
-- the second variant of a class this programme keeps finding (5a: `shipment_events` had two writers and no reader;
-- 5c: two tables with an RLS spec and no code): here the WRITE ITSELF discarded the operator's answer, while the
-- screen that needed it drew five bars and a policy decision on top.
--
-- Two columns fix it, and the second one is deliberate:
--   • `reason_code` — the CODED class, resolved against a real vocabulary (below), which is what a chart can be
--     grouped by and a policy decision can rest on;
--   • `note` — already there since 0007, and now actually written on the failure hop, because the code is what you
--     count and the operator's own sentence is what tells the next person WHICH gate was closed.
-- Rows written before this migration keep NULL and are reported as `unclassified` rather than distributed across
-- the five bars: a chart that guesses is worse than a chart with a gap in it, and the gap is the honest history of
-- a platform that did not record this.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: `shipments.distance_km` HAS BEEN DEAD SINCE 0007
-- ---------------------------------------------------------------------------------------------
-- W244's first tile is "Cost per qtl-km ₹2.14 ▼ 9%". `grep -rn "distance_km\|distanceKm" apps/api/src` returns
-- NOTHING — not a writer, not a reader, not even a SELECT: the column is not in `ShipmentRepository`'s own column
-- list. There is no routing engine, no distance matrix and no odometer reading anywhere in this platform, so the
-- "km" half of that tile has no source. The "qtl" half has none either: `shipments` carries NO WEIGHT COLUMN
-- (5c established this; `vehicles.capacity_kg` is a property of a truck, not of a consignment). And the money half
-- is `shipments.charge_minor`, which nothing writes (5c, and the COMMENT there records it).
--
-- Three missing inputs, one tile. It is reported as `not_computable` with all three named, rather than divided out
-- of an imagined lane length — a cost-per-qtl-km figure is what a tenant sets next quarter's freight rates by.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION REFUSES TO INVENT
-- ---------------------------------------------------------------------------------------------
--   • **A promised delivery date.** W225's second tile is "On-time delivery (30d) 95.1%". Nothing on this platform
--     promises a delivery time: `shipments` has `scheduled_pickup_at` and no expected/promised delivery column,
--     `delivery_zones` carries no SLA, and no charge definition encodes one. "On time" against no promise is a
--     ratio with no denominator. The desk reports what IS measured — FIRST-ATTEMPT delivery (5a's
--     `delivery_attempts`, which before that wave counted nothing) and median pickup→delivery transit — and says
--     plainly that on-time cannot be computed until a promise is recorded. Adding a promised-by column is a founder
--     decision about what an FPO commits to a buyer, not a column an analytics wave may invent.
--   • **A transit-loss figure.** W225's third tile is "Transit loss (90d) ₹84,200". Nothing measures loss: there is
--     no damage record, no shortfall record, no weighbridge (5a refused it — no weighbridge exists anywhere in
--     `apps/` or `db/`). The nearest signal is a BUYER DISPUTE reasoned `damaged` ("Damaged in transit", 0005) with
--     a resolution amount — which is a claims figure rather than a measurement, lives in the disputes plane, and
--     would need a cross-module read this blueprint forbids ("no module imports another module's repositories").
--     Named on the screen, not computed.
--   • **A consolidation count.** W225's third attention row reads "13 of 32 drop-point parcels consolidated at
--     ambassadors". Nothing records a parcel arriving at a consolidation point: 5b found `logistics.village_run_due`
--     has no subscriber and `VillageRunConsolidationJob` is instantiated nowhere. The row states the run and its
--     day (both real, from 0152's route state machine) and says the consolidation count is not tracked.
--   • **"Transit is 45% of our wastage."** No wastage baseline exists on this platform at all. A percentage of an
--     unmeasured whole is decoration, and this one is the sentence that justifies the desk existing.
--   • **An async, checksummed, signed-URL export.** W2385/W2386 promise a queued job with a position and an ETA,
--     an audit-stamped receipt with a sha256 and a 15-minute signed URL. `data_export_jobs` (0015) exists and is
--     touched by exactly one plane — admin-api's DPDP/offboarding approval flow; no tenant surface enqueues one and
--     no worker produces a file. The insights export is therefore SYNCHRONOUS and BOUNDED (the tiles, the lanes and
--     the failure breakdown of one window — kilobytes), and the screen says so rather than showing a queue position
--     for a queue that does not exist.
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 154.1 · the coded reason, on the table that records the attempt
-- ---------------------------------------------------------------------------------------------
-- On `shipment_events` rather than on `shipments`, because the chart counts EVENTS ("118 events" over 90 days,
-- more than the number of shipments) and because a shipment can fail twice for two different reasons — a column on
-- `shipments` would keep only the last one and quietly under-count the first.
ALTER TABLE shipment_events ADD COLUMN IF NOT EXISTS reason_code varchar(40);

-- The chart's own query: 90 days of failure events for one tenant, grouped by code. Partial, because failure events
-- are a small minority of a table that also holds every 90-second GPS ping (5a).
CREATE INDEX IF NOT EXISTS idx_shipment_events_reason
  ON shipment_events (tenant_id, reason_code, created_at DESC)
  WHERE reason_code IS NOT NULL;

COMMENT ON COLUMN shipment_events.reason_code IS
  'PC-56 TENANT-5d. The CODED failure class for a failed-delivery attempt, resolved against the tenant-extensible `shipment_failure_reason` vocabulary (db/seeds/core/0005). Before this migration the reason a delivery failed was written to NO COLUMN AT ALL: the API accepted it, the domain put it in an outbox event payload, and ShipmentRepository.update recorded the status hop with note = NULL — so W244''s five-bar "Failed-delivery reasons (90d)" chart, and the call-ahead policy decision resting on it, had no source. NULL means the attempt was recorded before this wave (or with the desk''s flag off) and is reported as `unclassified`, never distributed across the bars.';

COMMENT ON COLUMN shipment_events.note IS
  'Free text attached to an event: the operator''s own words on a failure ("gate closed, watchman said try after 6"), or a note on a location ping. PC-56 TENANT-5d: written for the FIRST TIME on a status hop by this wave — the only writer of a state change had hardcoded NULL here since 0007. The words sit beside reason_code, never instead of it: the code is what a chart counts, and the sentence is what tells the next person which gate was closed.';

COMMENT ON COLUMN shipments.distance_km IS
  'Lane length for this consignment, kilometres. PC-56 TENANT-5d: **DEAD SINCE 0007 — nothing writes it, nothing reads it, and it is not even in ShipmentRepository''s column list.** W244''s "Cost per qtl-km" tile needs it, together with a consignment weight (this table has none) and shipments.charge_minor (nothing writes that either — see its own COMMENT), so that tile is reported as not_computable with all three inputs named. Filling this needs a distance source: a routing engine, a distance matrix, or an odometer reading at delivery. None exists on this platform.';

-- ---------------------------------------------------------------------------------------------
-- 154.2 · the window the desk reads, indexed
-- ---------------------------------------------------------------------------------------------
-- First-attempt rate and median transit are read over a 30/90-day window of DELIVERED shipments. `shipments` is
-- partitioned on `created_at` (which prunes), and inside the surviving partitions this keeps the window read off a
-- sequential scan as a tenant's history grows — the same lesson 0153 learned about `shipments.awb_no`.
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_delivered
  ON shipments (tenant_id, delivered_at DESC)
  WHERE delivered_at IS NOT NULL;

-- The overview's "2 pickups scheduled today" and its attention list read forward on the schedule.
CREATE INDEX IF NOT EXISTS idx_shipments_tenant_pickup_due
  ON shipments (tenant_id, scheduled_pickup_at)
  WHERE scheduled_pickup_at IS NOT NULL;

-- ---------------------------------------------------------------------------------------------
-- 154.3 · the switch (Law 10 — OFF)
-- ---------------------------------------------------------------------------------------------
-- One flag for both screens: W225's overview and W244's insights are two readings of the same numbers, and a tenant
-- that can see the desk but not its own lane table would be a distinction without a purpose. Recording a coded
-- failure reason is NOT behind it — a write that finally stores the operator's answer needs no permission slip, and
-- gating it would mean the chart's history starts only when somebody enables a screen.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_desk_insights',
       'PC-56 TENANT-5d: the logistics desk — W225''s overview (active shipments, what needs attention today, the mechanisms that are actually switched on) and W244''s insights (first-attempt rate, failed-delivery reasons by coded class, busiest lanes, freight recovered). OFF means neither screen exists, which is the pre-wave state. Several figures the canon draws are reported as not-computable with their missing inputs named — on-time delivery (nothing promises a delivery date), cost per qtl-km (no distance, no weight, no cost), transit loss (nothing measures loss) — and turning this flag on does not change that; it makes the honest ones visible.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_desk_insights');

COMMIT;
