-- =============================================================================================
-- 0152_fleet_fitness_and_route_approval.sql · PC-56 TENANT-5b — THE RC NOBODY READ, AND A RUN NOBODY APPROVED
-- =============================================================================================
-- W229's lead, printed under the fleet register's own title:
--     "Fleet register — type from the lookup (bike, tempo, truck, reefer_7mt, tractor_trolley), capacity, RC
--      on file. AN EXPIRED RC PARKS THE VEHICLE AUTOMATICALLY; SAFETY IS NOT A PREFERENCE."
-- W231's rule, printed under its own table:
--     "Route economics show before approval … APPROVE WHEN THE MATH HOLDS, NOT WHEN IT FEELS RIGHT."
-- and its restricted state, which says what the button costs:
--     "Route approval needs logistics lead (it commits a vehicle + ambassador weekly)."
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 1: NOTHING HAS EVER LOOKED AT A VEHICLE'S RC
-- ---------------------------------------------------------------------------------------------
-- `vehicles.rc_doc_id` has existed since 0007 as a FK to `kyc_documents`. `grep -rn "rc_doc\|rcDoc" apps`
-- returns: the DTO that accepts it, the entity field that holds it, the repository columns that store it, and
-- the serializer that echoes it back as a bare uuid. Not one join. Not one status check. Not one comparison
-- against `kyc_documents.valid_until` — a column whose own comment reads "expiry tracking + renewal reminders
-- (PRD §9.1)" and which even has an index built for this question (`idx_kyc_expiring … WHERE status =
-- 'verified'`), used by the identity module's job to NOTIFY a person.
--
-- So: no vehicle on this platform has ever been parked by anything, W229's RC column ("verified · valid 2028")
-- had no data path, and the sentence "safety is not a preference" described a mechanism that did not exist.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 2: THE ASSIGNMENT VALIDATED NOTHING ABOUT THE THING IT WAS ASSIGNING
-- ---------------------------------------------------------------------------------------------
-- `ShipmentService.assign` took `vehicleId` as a bare uuid straight from a `.strict()` DTO and wrote it onto
-- the shipment. It never checked that the vehicle exists, that it belongs to this tenant (or to a platform 3PL
-- this tenant may use), or that it is active — and, worst of the four, never compared
-- `shipments.requires_cold_chain` with `vehicles.is_refrigerated`. **Both columns have existed since 0007 and
-- have never been read together.** A ghee run or a vaccine box could be loaded onto an open tempo, and the
-- only thing that would ever notice is `cold_chain_logs`, after the temperature was already wrong.
--
-- Closed in code (`domain/fleet-fitness.ts` + the gate in `ShipmentService.assign`), not here. **Parking on an
-- ABSENT RC is deliberately NOT the default**: `rc_doc_id` is nullable, no form has ever asked for one, and no
-- vehicle in production has one — so refusing on absence would deactivate every fleet on the platform in a
-- single tick and call it safety. Absence is a named row on the register; a tenant that wants the strict rule
-- switches on `logistics_require_rc`.
--
-- ---------------------------------------------------------------------------------------------
-- DEFECT 3: EVERY ROUTE WAS LIVE THE INSTANT IT WAS TYPED
-- ---------------------------------------------------------------------------------------------
-- `delivery_routes` carries `is_active boolean NOT NULL DEFAULT true`; `DeliveryRoute.create` set it TRUE; the
-- only lifecycle method was `setActive`. W231 draws a `(proposed)` row with `unassigned` in the vehicle column
-- and an [Approve route] button, and says approval "commits a vehicle + ambassador weekly" — none of which
-- could be represented. The Village-Run consolidation job selects `is_active = true AND run_weekday = today`,
-- so a half-typed idea would have begun notifying a named ambassador's Thursday.
--
-- This migration gives the route ONE state machine and not a second boolean beside the first — two mechanisms
-- over one fact is on this programme's own defect list. `is_active` becomes a GENERATED column derived from
-- `status`, so every existing reader keeps working and no code can write a contradiction. The precedent is
-- 0070's `variance_minor` ("always consistent with its inputs by construction").
--
-- Existing rows migrate to `active`, not `proposed`: they were already running, and demoting live runs to
-- proposals would silently stop them.
--
-- ---------------------------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO
-- ---------------------------------------------------------------------------------------------
--   • It does not seed the `vehicle_type` vocabulary. That belongs to `db/seeds/core/0005_lookup_vocabularies.sql`,
--     which already declares the lookup TYPE and (before this wave) not one VALUE — so `vehicle_type_id` could
--     never be set to anything and W229's Type column had no source. Seeds own vocabularies (Law 6); the values
--     are added there, in the same file as every other vocabulary, and this comment records where to look.
--   • It does not resurrect `shipments.route_id` (see the COMMENT below).
--   • It invents no route-cost column: a planned run's cost is a quote for a truck for a morning and this
--     platform records no such thing, so W231's "₹28/parcel" side stays unrecorded and the console says so
--     rather than dividing an imagined lorry hire by an estimated parcel count.
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- 152.1 · delivery_routes: one state machine, with the evidence of who committed the vehicle
-- ---------------------------------------------------------------------------------------------
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS status varchar(12);

-- Backfill BEFORE the NOT NULL: a live run stays live.
UPDATE delivery_routes SET status = CASE WHEN is_active THEN 'active' ELSE 'inactive' END WHERE status IS NULL;

ALTER TABLE delivery_routes ALTER COLUMN status SET DEFAULT 'proposed';
ALTER TABLE delivery_routes ALTER COLUMN status SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_delivery_routes_status') THEN
    ALTER TABLE delivery_routes
      ADD CONSTRAINT ck_delivery_routes_status CHECK (status IN ('proposed', 'active', 'inactive'));
  END IF;
END $$;

-- The APPROVAL's evidence. A verdict with no evidence is on this programme's defect list: "approved" that
-- cannot say by whom or when is an assertion, and this one commits a named ambassador's Thursday every week.
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);
ALTER TABLE delivery_routes ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Both halves or neither — the same both-or-nothing shape 0148's grace pair uses. Written as a CHECK that
-- cannot evaluate to NULL for the rows it governs (a CHECK that is NULL passes, which this programme has been
-- caught by before): the `IS NULL` comparisons are always true or false, never unknown.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_delivery_routes_approval_pair') THEN
    ALTER TABLE delivery_routes
      ADD CONSTRAINT ck_delivery_routes_approval_pair CHECK ((approved_by IS NULL) = (approved_at IS NULL));
  END IF;
END $$;

-- `is_active` becomes DERIVED. Dropped and re-added as GENERATED because PostgreSQL has no
-- "convert this column to generated": the value is recoverable from `status` for every row (the backfill above
-- is its inverse), so nothing is lost. Every existing reader — including the Village-Run job's
-- `WHERE is_active = true AND run_weekday = $1` — keeps working unchanged, and no INSERT or UPDATE can ever
-- again set an is_active that disagrees with the status.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'delivery_routes' AND column_name = 'is_active'
                AND is_generated = 'NEVER') THEN
    ALTER TABLE delivery_routes DROP COLUMN is_active;
    ALTER TABLE delivery_routes ADD COLUMN is_active boolean GENERATED ALWAYS AS (status = 'active') STORED;
  END IF;
END $$;

-- The job's own query shape (cross-tenant, bounded, one weekday). Partial on the state that matters so the
-- index holds only live runs — proposals are read by the console, never by the clock.
CREATE INDEX IF NOT EXISTS idx_delivery_routes_live_day
  ON delivery_routes (run_weekday, id) WHERE status = 'active' AND deleted_at IS NULL;

-- W231's board: this tenant's routes, newest first, proposals included.
CREATE INDEX IF NOT EXISTS idx_delivery_routes_tenant_board
  ON delivery_routes (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;

COMMENT ON COLUMN delivery_routes.status IS
  'PC-56 TENANT-5b. The ONE lifecycle of a recurring run: proposed (typed, uncommitted — W231 draws it as "(proposed)") -> active (approved: a vehicle and a consolidation point are committed weekly) -> inactive (suspended). is_active is GENERATED from this column so the two can never disagree. New routes default to proposed; before this migration every route was is_active=true from the moment it was typed, and the Village-Run consolidation job would have started notifying a named ambassador about a run nobody approved.';
COMMENT ON COLUMN delivery_routes.approved_by IS
  'PC-56 TENANT-5b. Who committed the vehicle and the ambassador (W231: "Route approval needs logistics lead"). Paired with approved_at by ck_delivery_routes_approval_pair — both or neither.';

-- ---------------------------------------------------------------------------------------------
-- 152.2 · **`vehicles.is_active` HAS NEVER EXISTED, AND EVERY VEHICLE QUERY ON THE PLATFORM ERRORS**
-- ---------------------------------------------------------------------------------------------
-- Found by applying this migration to an empty PostgreSQL 16 and watching an index creation fail:
--     ERROR:  column "is_active" does not exist
--
-- 0007's `CREATE TABLE vehicles` has no `is_active`, `add_std_columns()` adds only the five audit columns
-- (created_at/updated_at/deleted_at/created_by/updated_by), and no later migration adds it. Its three sibling
-- tables in the same file — `logistics_partners`, `pickup_slots`, `delivery_routes` — each declare their own
-- `is_active boolean NOT NULL DEFAULT true`. `vehicles` was missed.
--
-- Meanwhile the application has always assumed it:
--   • `VehicleRepository.COLS` SELECTs `is_active` — so `getById`, `getForUpdate` and `list` all error;
--   • `insert` writes it and `update` sets it — so registering or editing a vehicle errors;
--   • `list`'s query filters `AND is_active = true`, and `QueryVehicleSchema.activeOnly` DEFAULTS TO TRUE;
--   • `Vehicle.setActive()` and `POST /v1/logistics/vehicles/:id/active` exist to toggle it.
--
-- So the ENTIRE fleet registry has been non-functional since it was written: every read, every write, every
-- activation, in the tenant console and in the 3PL partner console (whose live `/fleet/vehicles` page therefore
-- shows its degrade-never-die notice on every visit). It also explains, at the schema level, why nothing has ever
-- parked a vehicle over an expired RC: there was no column to park it in.
--
-- This is the same defect class this programme has now met three times — a query naming a column the database
-- does not have (0122's `notification_template_versions` join, TENANT-5a's `orders.deleted_at`, and this) — and
-- all three were invisible to unit tests because a mocked or source-text-asserted query is never parsed by
-- PostgreSQL. The chain gate is what finds them.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN vehicles.is_active IS
  'Whether this vehicle may be dispatched. ADDED IN 0152, having been queried by VehicleRepository since the logistics module was written and never existing: 0007 declared it on logistics_partners, pickup_slots and delivery_routes and missed vehicles, so every vehicle SELECT, INSERT, UPDATE and the POST :id/active endpoint errored at the database with "column is_active does not exist". DEFAULT true, because every existing vehicle was dispatchable in practice (nothing could set it otherwise). This is also the column W229''s "an expired RC parks the vehicle automatically" parks a vehicle IN — the sentence had no mechanism and, underneath, nowhere to record one.';

-- ---------------------------------------------------------------------------------------------
-- 152.3 · vehicles: make the RC readable at the speed a gate needs
-- ---------------------------------------------------------------------------------------------
-- The fitness gate runs on the write path of every assignment, and the RC-parking job scans cross-tenant for
-- vehicles whose document has expired. Both start from `rc_doc_id`; neither can afford a full scan of a
-- platform-wide fleet table.
CREATE INDEX IF NOT EXISTS idx_vehicles_rc_doc
  ON vehicles (rc_doc_id) WHERE rc_doc_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vehicles_tenant_active
  ON vehicles (tenant_id, is_active, created_at DESC) WHERE deleted_at IS NULL;

COMMENT ON COLUMN vehicles.rc_doc_id IS
  'Registration certificate, as a kyc_documents row (0007). PC-56 TENANT-5b: READ for the first time here — status + valid_until decide whether the vehicle may be assigned (domain/fleet-fitness.ts) and whether the RC-parking job deactivates it. From 0007 to 0152 this column was written, echoed back as a uuid and never joined to anything, so W229''s "an expired RC parks the vehicle automatically" had no mechanism at all. NULL means no RC on file: that is REPORTED on the register and does not park the vehicle by default (no vehicle in production has one, so refusing on absence would deactivate every fleet on the platform in one tick) — a tenant that wants the strict rule switches on logistics_require_rc.';

COMMENT ON COLUMN vehicles.is_refrigerated IS
  'Reefer capability (0007). PC-56 TENANT-5b: compared against shipments.requires_cold_chain for the first time here. Both columns existed from 0007 and were never read together, so a cold-chain consignment could be assigned to an open vehicle and only cold_chain_logs would notice, after the temperature was already wrong.';

-- ---------------------------------------------------------------------------------------------
-- 152.4 · `shipments.route_id` — NAMED AS DEAD, DELIBERATELY LEFT DEAD
-- ---------------------------------------------------------------------------------------------
COMMENT ON COLUMN shipments.route_id IS
  'DEAD COLUMN since 0007, and PC-56 TENANT-5b leaves it dead on purpose. Nothing in the monorepo writes or reads it: no code chooses a route for a shipment, so populating it would mean inventing that choice. W231''s "Parcels/run avg" is therefore MEASURED instead — a delivered shipment whose drop address region (addresses.region_id) is one of the route''s village_region_ids, on the route''s run_weekday, is a parcel that run carried — which is checkable against facts that already exist. If a future wave makes a dispatcher pick a route, this column is where that choice belongs; until then it is empty and says so.';

-- ---------------------------------------------------------------------------------------------
-- 152.5 · the three switches (Law 10 — default OFF, separate on purpose)
-- ---------------------------------------------------------------------------------------------
-- Separate because they fail differently: the gate refuses WRITES, the job changes STATE on its own clock, and
-- the strict rule turns a warning into a refusal for one tenant. The console tells the truth about an RC with
-- all three off — reporting reality needs no flag; refusing does.
INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_fleet_fitness',
       'PC-56 TENANT-5b: refuse to assign a vehicle that does not exist for this tenant, is parked, has an expired or rejected RC, or is not refrigerated when the shipment requires cold chain. ShipmentService.assign validated none of these and shipments.requires_cold_chain had never been compared with vehicles.is_refrigerated. OFF reproduces the pre-wave behaviour (any uuid accepted) while the fleet register still reports every unfit vehicle.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_fleet_fitness');

INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_rc_parking',
       'PC-56 TENANT-5b: the daily job behind W229''s "an expired RC parks the vehicle automatically" — deactivates vehicles whose RC document is verified-but-expired or rejected, with an audit row and an outbox event per vehicle. OFF means no vehicle is parked by the platform and the register shows the expiry as a warning instead.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_rc_parking');

INSERT INTO feature_flags (key, description, is_enabled)
SELECT 'logistics_require_rc',
       'PC-56 TENANT-5b: escalate "no RC on file" from a reported warning to a refusal, per tenant. Deliberately not the default: rc_doc_id is nullable, no form ever asked for one, and refusing on absence platform-wide would deactivate every fleet in a single tick and call it safety.',
       false
WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'logistics_require_rc');

COMMIT;
