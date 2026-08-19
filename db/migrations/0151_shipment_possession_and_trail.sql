-- =============================================================================================
-- 0151_shipment_possession_and_trail.sql · PC-56 TENANT-5a — PROOF AT BOTH ENDS, AND A READABLE TRAIL
-- =============================================================================================
-- W225's logistics philosophy, printed as three ticks on the desk's own front page:
--     ✓ OTP at pickup AND delivery — possession changes hands with proof, both directions
--     ✓ Weighbridge slips both ends — the 2-qtl dispute taught us; now it's physics
--     ✓ Village Run consolidation: one truck, one Saturday, thirty villages
-- W226's rule, printed under its own table:
--     "A shipment for a `payment_pending` order stays `pending` — wheels never turn before money clears."
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1 (THE HEADLINE): THE WHEELS TURNED BEFORE THE MONEY CLEARED
-- ---------------------------------------------------------------------------------------------
-- `ShipmentService.create` takes an `orderId`, checks only that no shipment already exists for it, and
-- inserts. **It never reads the order.** Neither does `assign`, nor `schedulePickup`, nor `markPickedUp`.
-- `grep -rn "modules/orders" apps/api/src/modules/logistics` returned nothing at all: the logistics module
-- had no connection to the orders module in any direction.
--
-- So a shipment against an unpaid order could be created, given a driver, scheduled, collected from a
-- farmer's gate and delivered — every step returning 200. The sentence W226 prints as the reason its cumin
-- row is still `pending` ("payment clears first") described a gate that did not exist, and the row's state
-- was a coincidence of nobody having clicked rather than a rule holding.
--
-- Closed in code, not here: `OrderService.transportStatus` (the orders module's own fact, read through its
-- PUBLIC service per the module blueprint) is checked INSIDE the shipment's transaction at the one choke
-- point every transition passes through, for the three actions that commit somebody — assign, schedule
-- pickup, pickup. `create` is deliberately NOT gated: a `pending` shipment for an unpaid order is what
-- W226's cumin row IS, and refusing to create it would blind the desk to work that is coming.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: `pickup_otp_hash` HAS EXISTED SINCE 0007 AND IS WRITTEN BY NOTHING
-- ---------------------------------------------------------------------------------------------
-- The column is in the original logistics migration. The entity initialises it to null. `markPickedUp()`
-- set a timestamp and moved the state. The only OTP this platform ever issued is the DELIVERY one, in
-- `markOutForDelivery`. So "possession changes hands with proof, BOTH DIRECTIONS" was true in one
-- direction, and W227's journey plan step 1 — "Pickup 16:00 · Meera Ben confirms with OTP" — described a
-- step that did not exist.
--
-- A farmer handed over twelve quintals of wheat at their own gate with nothing recording that the handover
-- happened, which is precisely the dispute W227 says the ritual prevents. The n-th instance of this
-- programme's most-found defect class, and one of the worst: not a status recording an act nobody
-- performed, but a PROOF COLUMN for an act everybody performs and nobody witnessed.
--
-- **AND IT WAS BROKEN TWICE OVER.** `ShipmentRepository.update` writes every other mutable field and does
-- NOT write `pickup_otp_hash` — so even if something had issued a pickup code, the next update would have
-- silently dropped it. Two independent reasons the same promise could never have held.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: `shipment_events` HAS TWO WRITERS AND NO READER IN ITS OWN MODULE
-- ---------------------------------------------------------------------------------------------
-- Every hop and every 90-second GPS ping appends to `shipment_events`. `grep -rln "shipment_events"
-- apps/api/src` returns exactly: the two writers in `ShipmentRepository`, one test, and
-- `modules/orders/read-models/order-tracking.read-model.ts` — a BUYER-facing feed, for ONE order, in a
-- different module.
--
-- W236 is "the ops debugging surface" over this table (date-bounded queries, failed / at_hub / door-open /
-- GPS-gap filters, keyset paging, signed export) and W235 is the single-shipment tracking view. Neither had
-- anything behind it. The table the entire logistics desk rests on could not be read by the logistics desk.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------------------------
-- **NO WEIGHBRIDGE.** W225's second tick and W227's entire dispute-prevention story rest on it: "slip #1 vs
-- slip #2 is the whole dispute-prevention system: 998 kg loaded, 998 kg landed, nobody argues." There is no
-- weighbridge anywhere in `apps/api` or `db/` — `grep -rln weighbridge` finds a web-ops i18n string and a
-- backlog note. Two weights, two slip references, a variance and a tolerance are a real design (whose slip?
-- which bridge? what variance opens a dispute automatically?) and inventing one inside a UI wave would put a
-- number on a farmer's dispute that nobody decided. NAMED, queued, not faked — and W227's journey plan
-- renders the weighbridge steps as a stated gap rather than as ticks.
--
-- **NO ETA.** W235 prints "ETA 17:30" and "traffic-adjusted ETA holds". Nothing computes an ETA: no routing
-- engine, no traffic source. `OrderTracking`'s own type already carries an earlier wave's ruling — "No ETA
-- field exists (the app shows ETA as '—' rather than fabricating one)" — and the tenant console inherits it
-- rather than quietly deciding otherwise. `last_seen` is shown instead, which is a fact.
--
-- **NO ROUTE GEOMETRY.** W235's "72% of route · 38 km remaining" is not derivable — the platform stores
-- breadcrumbs and hops, not a planned line. The view shows MILESTONE progress, which is true and checkable.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 151.1  THE ATTEMPT COUNTER — so "one free re-attempt" is a number
-- ---------------------------------------------------------------------------------------------
-- W226: "Failed deliveries auto-schedule one free re-attempt before returning."
-- W236: "a failure without a next step cannot exist in this table."
--
-- `markFailed(reason)` moved the state and counted nothing, so "one" was an adjective: a fifth failure was
-- indistinguishable from a first, and no code could decide between re-attempting and returning the goods.
-- Default 0 is right for the backfill — a pre-wave shipment's attempts are genuinely unknown, and 0 means
-- "this platform never counted", not "it never failed". A `failed` shipment that predates this wave
-- therefore gets its one free re-attempt from today, which is the generous direction and the safe one: the
-- alternative is a farmer's goods going back on a count nobody kept.
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS delivery_attempts smallint NOT NULL DEFAULT 0;
ALTER TABLE shipments DROP CONSTRAINT IF EXISTS ck_shipments_delivery_attempts;
ALTER TABLE shipments ADD CONSTRAINT ck_shipments_delivery_attempts CHECK (delivery_attempts >= 0);

COMMENT ON COLUMN shipments.delivery_attempts IS
  'PC-56 TENANT-5a: delivery attempts spent. W226 promises one free re-attempt before a shipment returns; markFailed() counted nothing, so the promise had no mechanism. 0 on pre-wave rows means "never counted", not "never failed".';

COMMENT ON COLUMN shipments.pickup_otp_hash IS
  'The SELLER''s handover code, hashed with the server pepper. Written by Shipment.schedulePickup and verified by markPickedUp (PC-56 TENANT-5a). It existed unwritten from 0007 to 0151, and ShipmentRepository.update did not persist it either — so W225''s "OTP at pickup AND delivery, both directions" held in one direction only. A NULL here on a picked-up shipment means the handover was never proven, and possessionProof() reports that rather than claiming it.';

-- ---------------------------------------------------------------------------------------------
-- 151.2  THE INDEX THE EVENT EXPLORER NEEDS — W236 IS A TENANT-WIDE, TIME-BOUNDED QUERY
-- ---------------------------------------------------------------------------------------------
-- `shipment_events` has exactly ONE index: `(shipment_id, created_at)`, which serves "the trail of this
-- shipment" and nothing else. W236 asks the opposite question — "every hop of every shipment, in this
-- window, filtered, newest first" — and on a table taking a row per hop plus one per 90-second GPS ping,
-- that is a scan of a partition per page.
--
-- `(tenant_id, created_at DESC, id DESC)` is the explorer's own access path AND its keyset cursor, which is
-- why the id rides along: the list pages on (created_at, id) exactly as every other list in this programme
-- does, and a cursor that the index cannot serve is a cursor that re-scans.
--
-- Partitioned parent → PostgreSQL creates a matching local index on every partition, existing and future.
CREATE INDEX IF NOT EXISTS idx_shipment_events_tenant_time
  ON shipment_events (tenant_id, created_at DESC, id DESC);

COMMENT ON INDEX idx_shipment_events_tenant_time IS
  'PC-56 TENANT-5a: serves W236''s tenant-wide, date-bounded event explorer and its keyset cursor. Before this the table had only (shipment_id, created_at) — the per-shipment trail — because nothing in the logistics module read the table at all.';

-- ---------------------------------------------------------------------------------------------
-- 151.3  THE FLAGS (Law 10, both OFF)
-- ---------------------------------------------------------------------------------------------
-- SEPARATE, because they fail differently and a founder must be able to stop one without the other. The
-- possession flag governs whether new pickups ISSUE a code (a change to what happens at a farmer's gate,
-- and an SMS per pickup); the explorer flag governs a read surface. Turning the explorer off costs an
-- operator a screen; turning possession off returns the platform to proving one end of the handover.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_pickup_otp',
       'PC-56 TENANT-5a: issue a PICKUP OTP when a collection is scheduled and verify it at pickup, closing W225''s "possession changes hands with proof, both directions". shipments.pickup_otp_hash existed from 0007 and was written by nothing. OFF keeps the pre-wave behaviour, in which only the delivery end is proven and possessionProof() reports delivery_only.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_pickup_otp');

INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_event_explorer',
       'PC-56 TENANT-5a: the tenant-side read plane over shipment_events — W236''s event explorer and W235''s single-shipment tracking trail. The table has had two writers and no reader in its own module since 0007; the only reader anywhere is the buyer-facing order-tracking read model in modules/orders. OFF leaves both screens saying the trail is not enabled rather than showing an empty one.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_event_explorer');
