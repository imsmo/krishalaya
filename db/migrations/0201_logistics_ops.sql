-- ==================================================================================================================
-- 0201 · PC-56 TENANT-SW-e · LOGISTICS OPS
--        canon W228 + W2378–W2384 (carriers) · W230 + W2399–W2401 (pickup slots) · W232 + W2814–W2820 (Village Run)
--        · W234 / W239 / W240 + W2534–W2538 (cold chain, breaches, the unsigned export)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction. NEVER edit an applied migration (fix forward).
-- MONEY (Law 9, founder review owed): the ambassador's per-parcel fee (§201.4) is a 10a EARNING written by the database
-- when a handover is collected with BOTH OTPs verified; it is PAID only by SW-b's weekly run (tenant Main → ambassador Main
-- under SW-b's checker). Nothing in this file moves money.
--
-- Founder decisions (2026-10-04), built as decided:
--   • DEVICE-AUTHENTICATED INGEST + SERVER BANDS — `cold_chain_thresholds` is the ONLY source of a band; a reading's band and
--     its time of record are written by the database, never taken from a body; a device reading arrives on the kv_ingest
--     role path signed with a per-device HMAC key (`device_keys`, encrypted at rest, shown once — 13a's envelope); a BREACH is
--     2 CONSECUTIVE DEVICE readings outside the band, opened at write by `cold_chain_breach_on_reading` (AFTER INSERT trigger,
--     same transaction), closed by the first in-band device reading. A manual reading never opens one.
--   • VILLAGE RUN DROP POINTS + OTP HANDOVER + THE AMBASSADOR'S PER-PARCEL FEE AS A 10a EARNING PAID THROUGH SW-b's RUN.
--   • SLOT PROPOSALS THE MEMBER ACCEPTS — nothing is written to a seller's `pickup_slots` until the seller (in the app, or
--     through the OTP link) accepts; the trigger compares `app.user_id` with the seller.
--
--   201.1  identity helper `kv_db_actor()`; permissions; flags; settings (fee + floor); the cold-chain logger device kind
--   201.2  carriers: `logistics_partners.contact_phone`, rider = a delivery_partner role holder (trigger)
--   201.3  pickup_slot_proposals (+ trigger) and the pickup_slots owner wall (+ trigger)
--   201.4  Village Run: route_drop_points, route_runs (checker ≠ drafter), parcel_handovers (both OTPs), parcel_handover_fees,
--          the `parcel_handover` earning (platform plan row, guard trigger on ambassador_earnings, accrual function)
--   201.5  cold chain: cold_chain_thresholds (append-only), cold_chain_logs gains source / device / server time / band /
--          sequence, cold_chain_breaches, device_keys, cold_chain_ingest_nonces, cold_chain_device_silences, the BEFORE
--          and AFTER reading triggers, the bmc_units → thresholds trigger (+ backfill), kv_ingest's lookup function
--   201.6  ops_fired_alerts.rule_id nullable (a breach alert is not a rule's); retention rows (24 months, archive — no delete)
--   201.7  notification catalogue (4 events; copy in seed core/0007 above the backfill)
--   201.8  RLS (the 0175 split) + grants (kv_app; kv_ingest only what the ingest route needs) + indexes
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 201.1  HELPERS · PERMISSIONS · FLAGS · SETTINGS · DEVICE KIND
-- ------------------------------------------------------------------------------------------------------------------
-- Who is writing, as the ROLE the statement runs under: SET ROLE when one is in force (a fixture's `SET LOCAL ROLE kv_app`),
-- else the login. Inside a SECURITY DEFINER function `current_user` is the definer, so the walls below ask this instead.
CREATE OR REPLACE FUNCTION kv_db_actor() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN coalesce(current_setting('role', true), 'none') NOT IN ('none', '') THEN current_setting('role', true) ELSE session_user::text END
$$;
COMMENT ON FUNCTION kv_db_actor() IS
  'PC-56 TENANT-SW-e (0201): the role a statement runs as — SET ROLE if in force, else the login. Used by walls that must tell kv_app / kv_ingest / kv_relay apart from inside SECURITY DEFINER trigger functions (where current_user is the owner).';

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('logistics.devices.manage', 'Cold-chain loggers: register a logger and issue / revoke its signing key (shown once)', 'M07')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE p.code = 'logistics.devices.manage' AND r.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules) VALUES
  ('logistics_slot_proposals', 'PC-56 TENANT-SW-e: the pickup desk proposes slots, the member accepts in the app or through an OTP link (W230) — OFF = members set their own slots only', false, 100, '{}'),
  ('logistics_village_run', 'PC-56 TENANT-SW-e: Village Run drop points, loading plans (checker), OTP handovers and the ambassador per-parcel fee (W232) — OFF = routes only', false, 100, '{}'),
  ('cold_chain_device_ingest', 'PC-56 TENANT-SW-e: cold-chain logger readings over the device-signed ingest route, server bands, breach = 2 consecutive (W234) — OFF = the ingest route answers 404', false, 100, '{}')
ON CONFLICT (key) DO NOTHING;

-- THE FEE. The platform floor is ₹5 (500 paise): the smallest amount that is honestly a fee for a person's time at a drop point
-- (a handover, a phone check, an OTP read back), set by the platform; a cooperative may RAISE it (never lower it) under 13b's
-- maker-checker. The tenant key is money_path, so 13b's `trg_tenant_settings_gate` demands a confirmed two-person proposal.
INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class) VALUES
  ('platform.parcel_handover_fee_floor_minor', 'int', '500', 'platform',
   'PC-56 TENANT-SW-e (0201): the platform FLOOR of the Village Run per-parcel fee an ambassador earns for a handover collected with both OTPs (minor units; 500 = ₹5). A cooperative''s own value below it is raised to it at accrual.', 'money_path')
ON CONFLICT (key) DO NOTHING;
INSERT INTO setting_definitions (key, value_type, default_value, scope, description, risk_class, tenant_min, tenant_max, floor_note) VALUES
  ('logistics.parcel_handover_fee_minor', 'int', '500', 'tenant',
   'PC-56 TENANT-SW-e (0201): what this cooperative pays its drop-point ambassador per parcel collected by the member with both OTPs verified (minor units). Accrued as a 10a earning, paid by the weekly ambassador run.', 'money_path',
   '500', '100000', 'The platform floor is ₹5 per parcel (platform.parcel_handover_fee_floor_minor); a cooperative may raise it to ₹1,000 under maker-checker.')
ON CONFLICT (key) DO NOTHING;

-- The logger is a device of 12's registry (twin_devices) — one registry, one serial space per tenant. The type is 0190's; guaranteed
-- here as 0190 guarantees it (4d-5's rule: a migration that extends a lookup type guarantees the type in its own file).
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('twin_device_kind', 'Digital twin field device kind', false)
ON CONFLICT (code) DO NOTHING;
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT 'twin_device_kind', NULL, 'cold_chain_logger', 'Cold-chain temperature logger (reefer, cooler, chamber or vaccine box)', '{"module":"logistics"}'::jsonb, 3
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values WHERE type_code = 'twin_device_kind' AND code = 'cold_chain_logger' AND tenant_id IS NULL AND deleted_at IS NULL);

-- ------------------------------------------------------------------------------------------------------------------
-- 201.2  CARRIERS (W228, W2378–W2384)
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE logistics_partners ADD COLUMN IF NOT EXISTS contact_phone varchar(20);
ALTER TABLE logistics_partners ADD COLUMN IF NOT EXISTS status_reason text;
ALTER TABLE logistics_partners DROP CONSTRAINT IF EXISTS ck_lp_contact_phone;
ALTER TABLE logistics_partners ADD CONSTRAINT ck_lp_contact_phone CHECK (contact_phone IS NULL OR contact_phone ~ '^\+[1-9][0-9]{7,14}$');
COMMENT ON COLUMN logistics_partners.contact_phone IS
  'PC-56 TENANT-SW-e (0201, W2378 "contact"): the carrier''s business contact, E.164. Every read in the tenant console prints it masked (1b); a rider''s contact is the rider user''s own phone, never copied here.';

CREATE OR REPLACE FUNCTION assert_logistics_partner_rider() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.partner_kind = 'rider' AND NEW.tenant_id IS NOT NULL AND kv_db_actor() IN ('kv_app', 'kv_relay')
     AND (TG_OP = 'INSERT' OR NEW.rider_user_id IS DISTINCT FROM OLD.rider_user_id) THEN
    IF NEW.rider_user_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM user_tenant_roles utr JOIN roles r ON r.id = utr.role_id
       WHERE utr.tenant_id = NEW.tenant_id AND utr.user_id = NEW.rider_user_id AND r.code = 'delivery_partner'
         AND utr.is_active AND utr.deleted_at IS NULL) THEN
      RAISE EXCEPTION '[RIDER_NOT_DELIVERY_PARTNER] a rider carrier is a person holding the delivery-partner role in this organisation — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.partner_kind <> OLD.partner_kind THEN
    RAISE EXCEPTION '[CARRIER_KIND_FINAL] a carrier''s kind is fixed — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_lp_rider ON logistics_partners;
CREATE TRIGGER trg_lp_rider BEFORE INSERT OR UPDATE ON logistics_partners FOR EACH ROW EXECUTE FUNCTION assert_logistics_partner_rider();

-- ------------------------------------------------------------------------------------------------------------------
-- 201.3  PICKUP SLOTS (W230, W2399–W2401) — the desk proposes, the member accepts
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pickup_slot_proposals (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  seller_user_id   uuid NOT NULL REFERENCES users(id),
  proposed_by      uuid NOT NULL REFERENCES users(id),
  slots            jsonb NOT NULL,
  reason           text NOT NULL,
  status           varchar(10) NOT NULL DEFAULT 'proposed',
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  decided_at       timestamptz,
  decided_by       uuid REFERENCES users(id),
  channel          varchar(10),
  decline_reason   text,
  withdrawn_by     uuid REFERENCES users(id),
  withdrawn_at     timestamptz,
  withdraw_reason  text,
  applied_slot_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_psp_status CHECK (status IN ('proposed', 'accepted', 'declined', 'expired', 'withdrawn')),
  CONSTRAINT ck_psp_channel CHECK (channel IS NULL OR channel IN ('app', 'otp_link')),
  CONSTRAINT ck_psp_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  CONSTRAINT ck_psp_slots CHECK (jsonb_typeof(slots) = 'array' AND jsonb_array_length(slots) BETWEEN 1 AND 14),
  CONSTRAINT ck_psp_decided CHECK ((status IN ('accepted', 'declined')) = (decided_at IS NOT NULL AND decided_by IS NOT NULL AND channel IS NOT NULL)),
  CONSTRAINT ck_psp_withdrawn CHECK ((status = 'withdrawn') = (withdrawn_at IS NOT NULL AND withdrawn_by IS NOT NULL AND char_length(btrim(coalesce(withdraw_reason, ''))) >= 10))
);
COMMENT ON TABLE pickup_slot_proposals IS
  'PC-56 TENANT-SW-e (0201, W230 "Help him set slots" — founder decision: the desk proposes, the member accepts): weekly windows the pickup desk proposes for ONE seller. Nothing reaches the seller''s pickup_slots until the SELLER accepts — in the app (POST /me/pickup-slot-proposals/:id/accept) or through the OTP link (the code goes to the seller''s own phone). trg_psp_moves compares app.user_id with the seller: a desk accept is refused. Unanswered for 7 days → expired.';

CREATE OR REPLACE FUNCTION kv_slot_windows_valid(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e jsonb;
BEGIN
  IF jsonb_typeof(p) <> 'array' THEN RETURN false; END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(p) LOOP
    IF jsonb_typeof(e) <> 'object' OR NOT (e ? 'weekday' AND e ? 'start' AND e ? 'end') THEN RETURN false; END IF;
    IF jsonb_typeof(e->'weekday') <> 'number' OR (e->>'weekday') !~ '^[0-6]$' THEN RETURN false; END IF;
    IF (e->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR (e->>'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN RETURN false; END IF;
    IF (e->>'start') >= (e->>'end') THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE OR REPLACE FUNCTION assert_pickup_slot_proposal_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[SLOT_PROPOSAL_APPEND_ONLY] a slot proposal is a record — PC-56 TENANT-SW-e' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'proposed' OR NEW.decided_at IS NOT NULL OR NEW.channel IS NOT NULL OR NEW.applied_slot_ids <> '[]'::jsonb THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_BORN_PROPOSED] a slot proposal is born proposed — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NOT kv_slot_windows_valid(NEW.slots) THEN
      RAISE EXCEPTION '[SLOT_WINDOWS_INVALID] each window is {weekday 0–6, start HH:MM < end HH:MM} — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.proposed_by = NEW.seller_user_id THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_SELF] a member sets their own slots directly; a proposal is the desk''s, for another member — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.proposed_by <> me THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_NOT_YOURS] a proposal is made in the proposer''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    NEW.expires_at := now() + interval '7 days';
    RETURN NEW;
  END IF;
  -- UPDATE: what was proposed is final
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.seller_user_id <> OLD.seller_user_id OR NEW.proposed_by <> OLD.proposed_by
     OR NEW.slots <> OLD.slots OR NEW.reason <> OLD.reason OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[SLOT_PROPOSAL_FINAL] what a proposal proposed is final — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.applied_slot_ids IS DISTINCT FROM OLD.applied_slot_ids AND NOT (OLD.status = 'accepted' AND OLD.applied_slot_ids = '[]'::jsonb) THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_FINAL] the applied windows are recorded once — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decided_by IS DISTINCT FROM OLD.decided_by OR NEW.channel IS DISTINCT FROM OLD.channel THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_FINAL] a decision is final — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'proposed' THEN
    RAISE EXCEPTION '[SLOT_PROPOSAL_CLOSED] this proposal is already % — PC-56 TENANT-SW-e', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status IN ('accepted', 'declined') THEN
    -- THE WALL: only the SELLER decides. The app path runs in the seller's session; the OTP-link path sets app.user_id to the
    -- seller only after the code sent to the seller's own phone verified. A desk session (app.user_id = the desk) is refused.
    IF me IS NULL OR me <> OLD.seller_user_id OR NEW.decided_by IS DISTINCT FROM OLD.seller_user_id THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_NOT_SELLER] only the member the proposal is for can accept or decline it — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF now() >= OLD.expires_at THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_EXPIRED] this proposal expired on % — PC-56 TENANT-SW-e', OLD.expires_at USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'withdrawn' THEN
    IF me IS NULL OR me = OLD.seller_user_id THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_WITHDRAW_BY_DESK] a proposal is withdrawn by the desk, in a person''s session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.withdrawn_by IS DISTINCT FROM me THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_NOT_YOURS] a withdrawal is made in the withdrawer''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'expired' THEN
    IF now() < OLD.expires_at THEN
      RAISE EXCEPTION '[SLOT_PROPOSAL_NOT_DUE] a proposal expires only after its 7 days — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '[SLOT_PROPOSAL_MOVE] % → % is not a proposal move — PC-56 TENANT-SW-e', OLD.status, NEW.status USING ERRCODE = 'check_violation';
END $$;
DROP TRIGGER IF EXISTS trg_psp_moves ON pickup_slot_proposals;
CREATE TRIGGER trg_psp_moves BEFORE INSERT OR UPDATE OR DELETE ON pickup_slot_proposals FOR EACH ROW EXECUTE FUNCTION assert_pickup_slot_proposal_moves();

-- THE OWNER WALL. A seller's pickup windows are written in the seller's own session (the seller's own CRUD, or their acceptance
-- of a proposal) — never by a desk session. Fixture / admin-realm writes (superuser, kv_admin) are not the request tier.
CREATE OR REPLACE FUNCTION assert_pickup_slot_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF kv_db_actor() IN ('kv_app', 'kv_relay') AND kv_session_user() IS DISTINCT FROM NEW.seller_user_id THEN
    RAISE EXCEPTION '[PICKUP_SLOT_NOT_YOURS] a member''s pickup windows are set by the member — the desk proposes, the member accepts — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_pickup_slots_owner ON pickup_slots;
CREATE TRIGGER trg_pickup_slots_owner BEFORE INSERT OR UPDATE ON pickup_slots FOR EACH ROW EXECUTE FUNCTION assert_pickup_slot_owner();

-- The OTP link is answered without a session: this definer read gives the link page what it needs to start (the tenant, the
-- status, the windows) and NOTHING about the seller beyond a masked phone tail.
CREATE OR REPLACE FUNCTION kv_slot_proposal_link(p_id uuid)
RETURNS TABLE (tenant_id uuid, status varchar, slots jsonb, expires_at timestamptz, phone_tail text, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.tenant_id, p.status, p.slots, p.expires_at, right(u.phone, 4), coalesce(t.display_name, t.legal_name)::text
    FROM pickup_slot_proposals p JOIN users u ON u.id = p.seller_user_id JOIN tenants t ON t.id = p.tenant_id
   WHERE p.id = p_id
$$;
REVOKE ALL ON FUNCTION kv_slot_proposal_link(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kv_slot_proposal_link(uuid) TO kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 201.4  VILLAGE RUN (W232, W2814–W2820) · drop points · runs under a checker · OTP handovers · the per-parcel fee (MONEY)
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS route_drop_points (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  route_id            uuid NOT NULL REFERENCES delivery_routes(id),
  sequence            smallint NOT NULL,
  region_id           uuid NOT NULL REFERENCES admin_regions(id),
  name                varchar(120) NOT NULL,
  ambassador_user_id  uuid NOT NULL REFERENCES users(id),
  window_start        time,
  window_end          time,
  active              boolean NOT NULL DEFAULT true,
  created_by          uuid REFERENCES users(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deactivated_by      uuid REFERENCES users(id),
  deactivated_at      timestamptz,
  deactivate_reason   text,
  CONSTRAINT ck_rdp_sequence CHECK (sequence BETWEEN 1 AND 99),
  CONSTRAINT ck_rdp_name CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT ck_rdp_window CHECK ((window_start IS NULL) = (window_end IS NULL) AND (window_start IS NULL OR window_start < window_end)),
  CONSTRAINT ck_rdp_deactivated CHECK (active = (deactivated_at IS NULL) AND (active OR (deactivated_by IS NOT NULL AND char_length(btrim(coalesce(deactivate_reason, ''))) >= 10)))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rdp_route_sequence ON route_drop_points (route_id, sequence) WHERE active;
COMMENT ON TABLE route_drop_points IS
  'PC-56 TENANT-SW-e (0201, W232 "Drop points (ambassador consolidation)"): a stop on a Village Run route — a village of the route, a sequence, a window, and the AMBASSADOR who keeps the drop point (must hold the ambassador role and an active ambassador profile in this organisation — trg_rdp_keeper). The keeper receives parcels from the driver against an OTP sent to the keeper''s phone, and hands them to the member against the member''s OTP; each such collected parcel earns the keeper the per-parcel fee.';

CREATE OR REPLACE FUNCTION assert_route_drop_point() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  SELECT tenant_id, village_region_ids INTO r FROM delivery_routes WHERE id = NEW.route_id AND deleted_at IS NULL;
  IF r.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION '[DROP_POINT_ROUTE_UNKNOWN] the route is not this organisation''s — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.route_id <> OLD.route_id OR NEW.tenant_id <> OLD.tenant_id) THEN
    RAISE EXCEPTION '[DROP_POINT_FINAL] a drop point stays on its route — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT OLD.active AND NEW.active THEN
    RAISE EXCEPTION '[DROP_POINT_FINAL] a deactivated drop point is final — add a new one — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF NOT (r.village_region_ids ? NEW.region_id::text) THEN
    RAISE EXCEPTION '[DROP_POINT_NOT_ON_ROUTE] a drop point is in one of the route''s villages — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.active AND (TG_OP = 'INSERT' OR NEW.ambassador_user_id <> OLD.ambassador_user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM user_tenant_roles utr JOIN roles ro ON ro.id = utr.role_id
                    WHERE utr.tenant_id = NEW.tenant_id AND utr.user_id = NEW.ambassador_user_id AND ro.code = 'ambassador' AND utr.is_active AND utr.deleted_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM ambassador_profiles a WHERE a.tenant_id = NEW.tenant_id AND a.user_id = NEW.ambassador_user_id AND a.is_active AND a.deleted_at IS NULL) THEN
      RAISE EXCEPTION '[DROP_POINT_KEEPER_NOT_AMBASSADOR] a drop point is kept by a member holding the ambassador role with an active ambassador profile — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rdp_keeper ON route_drop_points;
CREATE TRIGGER trg_rdp_keeper BEFORE INSERT OR UPDATE ON route_drop_points FOR EACH ROW EXECUTE FUNCTION assert_route_drop_point();

CREATE TABLE IF NOT EXISTS route_runs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id),
  route_id         uuid NOT NULL REFERENCES delivery_routes(id),
  run_date         date NOT NULL,
  status           varchar(12) NOT NULL DEFAULT 'draft',
  loading_plan     jsonb NOT NULL DEFAULT '[]'::jsonb,
  partner_id       uuid REFERENCES logistics_partners(id),
  vehicle_id       uuid REFERENCES vehicles(id),
  drafted_by       uuid NOT NULL REFERENCES users(id),
  drafted_at       timestamptz NOT NULL DEFAULT now(),
  draft_reason     text NOT NULL,
  confirmed_by     uuid REFERENCES users(id),
  confirmed_at     timestamptz,
  loading_at       timestamptz,
  departed_at      timestamptz,
  completed_at     timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  cancelled_at     timestamptz,
  cancel_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_rr_status CHECK (status IN ('draft', 'confirmed', 'loading', 'in_transit', 'completed', 'cancelled')),
  CONSTRAINT ck_rr_plan CHECK (jsonb_typeof(loading_plan) = 'array' AND jsonb_array_length(loading_plan) <= 500),
  CONSTRAINT ck_rr_reason CHECK (char_length(btrim(draft_reason)) BETWEEN 10 AND 500),
  CONSTRAINT ck_rr_checker CHECK (confirmed_by IS NULL OR confirmed_by <> drafted_by),
  CONSTRAINT ck_rr_confirmed CHECK ((status IN ('confirmed', 'loading', 'in_transit', 'completed')) <= (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)),
  CONSTRAINT ck_rr_cancelled CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND char_length(btrim(coalesce(cancel_reason, ''))) >= 10))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rr_route_date ON route_runs (route_id, run_date) WHERE status <> 'cancelled';
COMMENT ON TABLE route_runs IS
  'PC-56 TENANT-SW-e (0201, W232 "Draft loading plan (Thu)"): one Village Run of a route on its run day (the route''s IST run_weekday). The loading plan (parcels → drop points) is drafted by one person and CONFIRMED BY ANOTHER (ck_rr_checker + trg_rr_moves: RUN_CHECKER_IS_DRAFTER), then loaded, departed and completed — or cancelled with a reason. The plan is frozen once confirmed.';

CREATE OR REPLACE FUNCTION assert_route_run_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); rt record; e jsonb; s record; dp record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[RUN_APPEND_ONLY] a run is a record — cancel it with a reason — PC-56 TENANT-SW-e' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'draft' OR NEW.confirmed_by IS NOT NULL OR NEW.loading_at IS NOT NULL OR NEW.departed_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION '[RUN_BORN_DRAFT] a run is born a draft — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.drafted_by <> me THEN
      RAISE EXCEPTION '[RUN_NOT_YOURS] a run is drafted in the drafter''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_id, run_weekday, status INTO rt FROM delivery_routes WHERE id = NEW.route_id AND deleted_at IS NULL;
    IF rt.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION '[RUN_ROUTE_UNKNOWN] the route is not this organisation''s — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF rt.status <> 'active' THEN
      RAISE EXCEPTION '[RUN_ROUTE_NOT_ACTIVE] a run is planned on an approved, active route — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF rt.run_weekday IS NOT NULL AND extract(dow FROM NEW.run_date)::int <> rt.run_weekday THEN
      RAISE EXCEPTION '[RUN_DATE_NOT_RUN_DAY] the run date is not the route''s run day — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.run_date < kv_ist_today() THEN
      RAISE EXCEPTION '[RUN_DATE_PAST] a run is planned for today or later (IST) — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.route_id <> OLD.route_id OR NEW.run_date <> OLD.run_date
       OR NEW.drafted_by <> OLD.drafted_by OR NEW.drafted_at <> OLD.drafted_at OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION '[RUN_FINAL] a run''s route, day and drafter are fixed — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION '[RUN_CLOSED] this run is already % — PC-56 TENANT-SW-e', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status <> 'draft' AND (NEW.loading_plan <> OLD.loading_plan OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
       OR NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR NEW.draft_reason <> OLD.draft_reason) THEN
      RAISE EXCEPTION '[RUN_PLAN_FROZEN] a confirmed loading plan is frozen — cancel the run and draft again — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.confirmed_by IS NOT NULL AND (NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at) THEN
      RAISE EXCEPTION '[RUN_FINAL] a confirmation is final — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status THEN
      IF NOT ((OLD.status = 'draft' AND NEW.status IN ('confirmed', 'cancelled'))
           OR (OLD.status = 'confirmed' AND NEW.status IN ('loading', 'cancelled'))
           OR (OLD.status = 'loading' AND NEW.status IN ('in_transit', 'cancelled'))
           OR (OLD.status = 'in_transit' AND NEW.status = 'completed')) THEN
        RAISE EXCEPTION '[RUN_MOVE] % → % is not a run move — PC-56 TENANT-SW-e', OLD.status, NEW.status USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.status = 'confirmed' THEN
        -- THE CHECKER WALL. The person who drafted the loading plan cannot also confirm it.
        IF NEW.confirmed_by IS NULL OR NEW.confirmed_by = OLD.drafted_by THEN
          RAISE EXCEPTION '[RUN_CHECKER_IS_DRAFTER] the person who drafted this loading plan cannot also confirm it — a second person must — PC-56 TENANT-SW-e maker-checker' USING ERRCODE = 'check_violation';
        END IF;
        IF me IS NOT NULL AND NEW.confirmed_by <> me THEN
          RAISE EXCEPTION '[RUN_NOT_YOURS] a confirmation is made in the confirmer''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
        END IF;
        IF jsonb_array_length(NEW.loading_plan) = 0 THEN
          RAISE EXCEPTION '[RUN_PLAN_EMPTY] a loading plan with no parcels cannot be confirmed — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      IF NEW.status = 'cancelled' AND (me IS NOT NULL AND NEW.cancelled_by IS DISTINCT FROM me) THEN
        RAISE EXCEPTION '[RUN_NOT_YOURS] a cancellation is made in the canceller''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
  END IF;
  -- the plan: each element {shipmentId, dropPointId}; the parcel is this organisation's, not delivered/cancelled/returned; the
  -- drop point is ON THIS ROUTE and active; no parcel twice.
  IF TG_OP = 'INSERT' OR NEW.loading_plan <> OLD.loading_plan THEN
    IF (SELECT count(*) FROM jsonb_array_elements(NEW.loading_plan) x) <> (SELECT count(DISTINCT x->>'shipmentId') FROM jsonb_array_elements(NEW.loading_plan) x) THEN
      RAISE EXCEPTION '[RUN_PLAN_DUPLICATE] a parcel is planned once — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    FOR e IN SELECT * FROM jsonb_array_elements(NEW.loading_plan) LOOP
      IF jsonb_typeof(e) <> 'object' OR coalesce(e->>'shipmentId', '') !~* '^[0-9a-f-]{36}$' OR coalesce(e->>'dropPointId', '') !~* '^[0-9a-f-]{36}$' THEN
        RAISE EXCEPTION '[RUN_PLAN_SHAPE] each plan line is {shipmentId, dropPointId} — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
      END IF;
      SELECT tenant_id, status INTO s FROM shipments WHERE id = (e->>'shipmentId')::uuid AND tenant_id = NEW.tenant_id;
      IF s.tenant_id IS NULL OR s.status IN ('delivered', 'cancelled', 'returned') THEN
        RAISE EXCEPTION '[RUN_PLAN_PARCEL] parcel % is not an open shipment of this organisation — PC-56 TENANT-SW-e', e->>'shipmentId' USING ERRCODE = 'check_violation';
      END IF;
      SELECT route_id, active INTO dp FROM route_drop_points WHERE id = (e->>'dropPointId')::uuid AND tenant_id = NEW.tenant_id;
      IF dp.route_id IS DISTINCT FROM NEW.route_id OR NOT dp.active THEN
        RAISE EXCEPTION '[RUN_PLAN_DROP_POINT] drop point % is not an active stop of this route — PC-56 TENANT-SW-e', e->>'dropPointId' USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_rr_moves ON route_runs;
CREATE TRIGGER trg_rr_moves BEFORE INSERT OR UPDATE OR DELETE ON route_runs FOR EACH ROW EXECUTE FUNCTION assert_route_run_moves();

CREATE TABLE IF NOT EXISTS parcel_handovers (
  id                         uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id                  uuid NOT NULL REFERENCES tenants(id),
  run_id                     uuid NOT NULL REFERENCES route_runs(id),
  shipment_id                uuid NOT NULL,
  drop_point_id              uuid NOT NULL REFERENCES route_drop_points(id),
  handed_by                  uuid NOT NULL REFERENCES users(id),
  received_by                uuid NOT NULL REFERENCES users(id),
  otp_verified_at            timestamptz NOT NULL,
  recipient_user_id          uuid NOT NULL REFERENCES users(id),
  recipient_otp_verified_at  timestamptz,
  status                     varchar(14) NOT NULL DEFAULT 'at_drop_point',
  collected_at               timestamptz,
  returned_at                timestamptz,
  return_reason              text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ph_status CHECK (status IN ('at_drop_point', 'collected', 'returned')),
  CONSTRAINT ck_ph_collected CHECK ((status = 'collected') = (collected_at IS NOT NULL AND recipient_otp_verified_at IS NOT NULL)),
  CONSTRAINT ck_ph_returned CHECK ((status = 'returned') = (returned_at IS NOT NULL AND char_length(btrim(coalesce(return_reason, ''))) >= 10)),
  CONSTRAINT ck_ph_people CHECK (handed_by <> received_by)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ph_run_shipment ON parcel_handovers (run_id, shipment_id);
COMMENT ON TABLE parcel_handovers IS
  'PC-56 TENANT-SW-e (0201, W232 "every handover OTP-confirmed at the drop point"): a parcel of a run handed by the DRIVER to the drop-point AMBASSADOR (otp_verified_at: the code sent to the keeper''s phone, read back) and later collected by the MEMBER (recipient_otp_verified_at: the code sent to the member''s phone, read back). No code is stored — the existing OTP service holds it hashed in the cache. A collected handover with both stamps earns the keeper the per-parcel fee (parcel_handover_fees) exactly once.';

CREATE OR REPLACE FUNCTION assert_parcel_handover_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user(); r record; dp record; planned boolean; buyer uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION '[HANDOVER_APPEND_ONLY] a handover is a record — PC-56 TENANT-SW-e' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'at_drop_point' OR NEW.recipient_otp_verified_at IS NOT NULL OR NEW.collected_at IS NOT NULL THEN
      RAISE EXCEPTION '[HANDOVER_BORN_AT_DROP_POINT] a handover is born at the drop point — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF me IS NOT NULL AND NEW.handed_by <> me THEN
      RAISE EXCEPTION '[HANDOVER_NOT_YOURS] the driver records the handover in their own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_id, status, loading_plan INTO r FROM route_runs WHERE id = NEW.run_id;
    IF r.tenant_id IS DISTINCT FROM NEW.tenant_id OR r.status <> 'in_transit' THEN
      RAISE EXCEPTION '[HANDOVER_RUN_NOT_IN_TRANSIT] parcels are handed over while the run is on the road — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(r.loading_plan) x WHERE x->>'shipmentId' = NEW.shipment_id::text AND x->>'dropPointId' = NEW.drop_point_id::text) INTO planned;
    IF NOT planned THEN
      RAISE EXCEPTION '[HANDOVER_NOT_PLANNED] this parcel is not planned for this drop point on this run — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    SELECT ambassador_user_id, active INTO dp FROM route_drop_points WHERE id = NEW.drop_point_id AND tenant_id = NEW.tenant_id;
    IF dp.ambassador_user_id IS DISTINCT FROM NEW.received_by THEN
      RAISE EXCEPTION '[HANDOVER_KEEPER] the parcel is received by the drop point''s own ambassador — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    SELECT o.buyer_user_id INTO buyer FROM shipments s JOIN orders o ON o.id = s.order_id AND o.tenant_id = s.tenant_id
     WHERE s.id = NEW.shipment_id AND s.tenant_id = NEW.tenant_id;
    IF buyer IS DISTINCT FROM NEW.recipient_user_id THEN
      RAISE EXCEPTION '[HANDOVER_RECIPIENT] the member who collects is the order''s buyer — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.run_id <> OLD.run_id OR NEW.shipment_id <> OLD.shipment_id
     OR NEW.drop_point_id <> OLD.drop_point_id OR NEW.handed_by <> OLD.handed_by OR NEW.received_by <> OLD.received_by
     OR NEW.otp_verified_at <> OLD.otp_verified_at OR NEW.recipient_user_id <> OLD.recipient_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION '[HANDOVER_FINAL] what was handed over, by whom, to whom, is final — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status <> 'at_drop_point' THEN
    RAISE EXCEPTION '[HANDOVER_CLOSED] this handover is already % — PC-56 TENANT-SW-e', OLD.status USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'collected' THEN
    -- the keeper records the member's collection, in the keeper's own session, with the member's OTP verified
    IF me IS NOT NULL AND me <> OLD.received_by THEN
      RAISE EXCEPTION '[HANDOVER_COLLECT_BY_KEEPER] the drop point''s ambassador records the member''s collection — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.status = 'returned' THEN
    NULL;
  ELSIF NEW.status = OLD.status AND (NEW.recipient_otp_verified_at IS DISTINCT FROM OLD.recipient_otp_verified_at OR NEW.collected_at IS DISTINCT FROM OLD.collected_at) THEN
    RAISE EXCEPTION '[HANDOVER_FINAL] the member''s OTP is stamped with the collection — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ph_moves ON parcel_handovers;
CREATE TRIGGER trg_ph_moves BEFORE INSERT OR UPDATE OR DELETE ON parcel_handovers FOR EACH ROW EXECUTE FUNCTION assert_parcel_handover_moves();

-- THE FEE LEDGER OF RECORD: one row per collected handover (PRIMARY KEY handover_id) — the earning it wrote, at what amount and
-- from which source. Written ONLY by kv_accrue_parcel_handover_fee (SECURITY DEFINER); kv_app reads it.
CREATE TABLE IF NOT EXISTS parcel_handover_fees (
  handover_id            uuid PRIMARY KEY REFERENCES parcel_handovers(id),
  tenant_id              uuid NOT NULL REFERENCES tenants(id),
  route_id               uuid NOT NULL REFERENCES delivery_routes(id),
  ambassador_id          uuid NOT NULL REFERENCES ambassador_profiles(id),
  ambassador_user_id     uuid NOT NULL REFERENCES users(id),
  earning_id             uuid NOT NULL,
  amount_minor           bigint NOT NULL,
  fee_source             varchar(16) NOT NULL,
  floor_minor            bigint NOT NULL,
  accrued_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_phf_amount CHECK (amount_minor > 0 AND amount_minor >= floor_minor),
  CONSTRAINT ck_phf_source CHECK (fee_source IN ('tenant_setting', 'platform_floor'))
);
COMMENT ON TABLE parcel_handover_fees IS
  'PC-56 TENANT-SW-e (0201, MONEY · founder decision): the per-parcel fee each collected handover earned its drop-point ambassador — ONCE (PRIMARY KEY handover_id) — and the 10a earning it wrote (ambassador_earnings, event parcel_handover). Amount = the cooperative''s logistics.parcel_handover_fee_minor raised to the platform floor (platform.parcel_handover_fee_floor_minor, ₹5). Paid by SW-b''s weekly run like every other earning.';

-- the platform plan row the earning names (10a ambassador_earnings.plan_id is NOT NULL). It carries NO amount: the amount is the
-- setting above, resolved at accrual and written on the earning. `conditions` is empty — 10a's evaluator never sees this event.
INSERT INTO commission_plans_ambassador (tenant_id, event_code, amount_minor, rate_bps, conditions, effective_from)
SELECT NULL, 'parcel_handover', NULL, NULL, '{}'::jsonb, DATE '2026-10-04'
 WHERE NOT EXISTS (SELECT 1 FROM commission_plans_ambassador WHERE tenant_id IS NULL AND event_code = 'parcel_handover' AND deleted_at IS NULL);

-- THE GUARD on ambassador_earnings: a parcel_handover earning names a collected handover with both OTPs, is the drop point's own
-- ambassador's, is the resolved fee, and exists at most ONCE per handover — whoever writes it (kv_app included).
CREATE OR REPLACE FUNCTION assert_parcel_handover_earning() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h record; amb uuid;
BEGIN
  IF NEW.event_code IS DISTINCT FROM 'parcel_handover' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('parcel_handover_fee:' || coalesce(NEW.reference_id::text, '-')));
  IF EXISTS (SELECT 1 FROM ambassador_earnings e WHERE e.tenant_id = NEW.tenant_id AND e.event_code = 'parcel_handover' AND e.reference_id = NEW.reference_id) THEN
    RAISE EXCEPTION '[PARCEL_FEE_ONCE] the per-parcel fee for this handover is already earned — PC-56 TENANT-SW-e' USING ERRCODE = 'unique_violation';
  END IF;
  SELECT ph.tenant_id, ph.status, ph.otp_verified_at, ph.recipient_otp_verified_at, ph.received_by INTO h
    FROM parcel_handovers ph WHERE ph.id = NEW.reference_id;
  SELECT a.id INTO amb FROM ambassador_profiles a WHERE a.tenant_id = NEW.tenant_id AND a.user_id = h.received_by;
  IF NEW.reference_type IS DISTINCT FROM 'parcel_handover' OR h.tenant_id IS DISTINCT FROM NEW.tenant_id OR h.status <> 'collected'
     OR h.otp_verified_at IS NULL OR h.recipient_otp_verified_at IS NULL OR amb IS DISTINCT FROM NEW.ambassador_id
     OR NEW.amount_minor <> kv_parcel_handover_fee_minor(NEW.tenant_id) THEN
    RAISE EXCEPTION '[PARCEL_FEE_NOT_EARNED] a per-parcel fee is earned by the drop point''s ambassador, at the resolved fee, for a handover the member collected with both OTPs verified — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION kv_parcel_handover_fee_minor(p_tenant uuid) RETURNS bigint
LANGUAGE sql STABLE AS $$
  SELECT greatest(
    coalesce((SELECT (s.value #>> '{}')::bigint FROM tenant_settings s WHERE s.tenant_id = p_tenant AND s.key = 'logistics.parcel_handover_fee_minor' AND s.deleted_at IS NULL),
             (SELECT (d.default_value #>> '{}')::bigint FROM setting_definitions d WHERE d.key = 'logistics.parcel_handover_fee_minor')),
    coalesce((kv_platform_setting('platform.parcel_handover_fee_floor_minor') #>> '{}')::bigint, 500))
$$;
COMMENT ON FUNCTION kv_parcel_handover_fee_minor(uuid) IS
  'PC-56 TENANT-SW-e (0201): the per-parcel fee in force for a cooperative — its own logistics.parcel_handover_fee_minor (else the registry default), never below the platform floor platform.parcel_handover_fee_floor_minor. INVOKER rights: under kv_app it reads through RLS (its own tenant only); inside the accrual it runs as the definer.';

DROP TRIGGER IF EXISTS trg_ae_parcel_handover ON ambassador_earnings;
CREATE TRIGGER trg_ae_parcel_handover BEFORE INSERT ON ambassador_earnings FOR EACH ROW EXECUTE FUNCTION assert_parcel_handover_earning();

-- THE ACCRUAL: called by the handover trigger when a handover becomes collected. Idempotent: a second call finds the fee row and
-- returns it; the guard above refuses any second earning for the same handover from anywhere.
CREATE OR REPLACE FUNCTION kv_accrue_parcel_handover_fee(p_handover uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE h record; rt uuid; amb uuid; plan uuid; fee bigint; flr bigint; tenant_value bigint; earning uuid; existing uuid;
BEGIN
  SELECT earning_id INTO existing FROM parcel_handover_fees WHERE handover_id = p_handover;
  IF existing IS NOT NULL THEN RETURN existing; END IF;
  SELECT ph.*, r.route_id INTO h FROM parcel_handovers ph JOIN route_runs r ON r.id = ph.run_id WHERE ph.id = p_handover FOR UPDATE OF ph;
  IF h.id IS NULL OR h.status <> 'collected' OR h.otp_verified_at IS NULL OR h.recipient_otp_verified_at IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT a.id INTO amb FROM ambassador_profiles a WHERE a.tenant_id = h.tenant_id AND a.user_id = h.received_by;
  SELECT p.id INTO plan FROM commission_plans_ambassador p WHERE p.tenant_id IS NULL AND p.event_code = 'parcel_handover' AND p.deleted_at IS NULL ORDER BY p.created_at LIMIT 1;
  IF amb IS NULL OR plan IS NULL THEN
    RAISE EXCEPTION '[PARCEL_FEE_NO_AMBASSADOR] the drop point''s keeper has no ambassador profile here, or the parcel_handover plan row is missing — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  flr := coalesce((kv_platform_setting('platform.parcel_handover_fee_floor_minor') #>> '{}')::bigint, 500);
  SELECT (s.value #>> '{}')::bigint INTO tenant_value FROM tenant_settings s WHERE s.tenant_id = h.tenant_id AND s.key = 'logistics.parcel_handover_fee_minor' AND s.deleted_at IS NULL;
  fee := kv_parcel_handover_fee_minor(h.tenant_id);
  earning := uuid_generate_v7();
  INSERT INTO ambassador_earnings (id, tenant_id, ambassador_id, plan_id, event_code, reference_type, reference_id, amount_minor, subject_user_id)
  VALUES (earning, h.tenant_id, amb, plan, 'parcel_handover', 'parcel_handover', h.id, fee, h.recipient_user_id);
  INSERT INTO parcel_handover_fees (handover_id, tenant_id, route_id, ambassador_id, ambassador_user_id, earning_id, amount_minor, fee_source, floor_minor)
  VALUES (h.id, h.tenant_id, h.route_id, amb, h.received_by, earning, fee,
          CASE WHEN tenant_value IS NOT NULL AND tenant_value >= flr THEN 'tenant_setting' ELSE 'platform_floor' END, flr);
  RETURN earning;
END $$;
REVOKE ALL ON FUNCTION kv_accrue_parcel_handover_fee(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION parcel_handover_after() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status = 'collected' AND OLD.status <> 'collected' THEN
    PERFORM kv_accrue_parcel_handover_fee(NEW.id);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_ph_after ON parcel_handovers;
CREATE TRIGGER trg_ph_after AFTER UPDATE OF status ON parcel_handovers FOR EACH ROW EXECUTE FUNCTION parcel_handover_after();

-- ------------------------------------------------------------------------------------------------------------------
-- 201.5  COLD CHAIN (W234, W239, W240, W2534–W2538) · server bands · device ingest · breach = 2 consecutive
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cold_chain_thresholds (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  subject_type    varchar(40) NOT NULL,
  subject_id      uuid NOT NULL,
  min_c           numeric(5,2) NOT NULL,
  max_c           numeric(5,2) NOT NULL,
  set_by          uuid REFERENCES users(id),
  reason          text NOT NULL,
  effective_from  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_cct_subject CHECK (subject_type IN ('shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box')),
  CONSTRAINT ck_cct_band CHECK (min_c >= -60 AND max_c <= 80 AND min_c <= max_c),
  CONSTRAINT ck_cct_reason CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500)
);
CREATE INDEX IF NOT EXISTS idx_cct_subject ON cold_chain_thresholds (tenant_id, subject_type, subject_id, effective_from DESC, created_at DESC);
COMMENT ON TABLE cold_chain_thresholds IS
  'PC-56 TENANT-SW-e (0201, F-13 — founder decision SERVER BANDS): THE ONLY SOURCE of a cold-chain subject''s band. Append-only (a new row supersedes; the history stays). Every reading copies the band in force at write (band_min_c / band_max_c on cold_chain_logs, set by trg_ccl_before) — a body never supplies one. A cooler''s band follows its bmc_units row (trg_bmc_units_threshold).';
CREATE OR REPLACE FUNCTION cold_chain_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '[COLD_CHAIN_APPEND_ONLY] % is append-only — PC-56 TENANT-SW-e', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_cct_append_only ON cold_chain_thresholds;
CREATE TRIGGER trg_cct_append_only BEFORE UPDATE OR DELETE ON cold_chain_thresholds FOR EACH ROW EXECUTE FUNCTION cold_chain_append_only();

CREATE OR REPLACE FUNCTION kv_cold_chain_band(p_tenant uuid, p_type varchar, p_subject uuid)
RETURNS TABLE (min_c numeric, max_c numeric, threshold_id uuid)
LANGUAGE sql STABLE AS $$
  SELECT t.min_c, t.max_c, t.id FROM cold_chain_thresholds t
   WHERE t.tenant_id = p_tenant AND t.subject_type = p_type AND t.subject_id = p_subject AND t.effective_from <= now()
   ORDER BY t.effective_from DESC, t.created_at DESC LIMIT 1
$$;

-- the cooler's band IS its threshold: every band the cooperative sets on a bmc_units row is appended to the store
CREATE OR REPLACE FUNCTION bmc_units_threshold() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.min_temp_c IS DISTINCT FROM OLD.min_temp_c OR NEW.target_temp_c IS DISTINCT FROM OLD.target_temp_c OR NEW.tolerance_c IS DISTINCT FROM OLD.tolerance_c THEN
    INSERT INTO cold_chain_thresholds (tenant_id, subject_type, subject_id, min_c, max_c, set_by, reason)
    VALUES (NEW.tenant_id, 'bmc_unit', NEW.id, NEW.min_temp_c, NEW.target_temp_c + NEW.tolerance_c, coalesce(NEW.updated_by, NEW.created_by),
            format('the cooler''s band (bmc_units: min %s °C, target %s °C + tolerance %s °C)', NEW.min_temp_c, NEW.target_temp_c, NEW.tolerance_c));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_bmc_units_threshold ON bmc_units;
CREATE TRIGGER trg_bmc_units_threshold AFTER INSERT OR UPDATE OF min_temp_c, target_temp_c, tolerance_c ON bmc_units FOR EACH ROW EXECUTE FUNCTION bmc_units_threshold();
-- backfill: every existing cooler's band, once
INSERT INTO cold_chain_thresholds (tenant_id, subject_type, subject_id, min_c, max_c, set_by, reason)
SELECT b.tenant_id, 'bmc_unit', b.id, b.min_temp_c, b.target_temp_c + b.tolerance_c, NULL,
       format('backfilled at 0201 from the cooler''s band (bmc_units: min %s °C, target %s °C + tolerance %s °C)', b.min_temp_c, b.target_temp_c, b.tolerance_c)
  FROM bmc_units b
 WHERE b.deleted_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM cold_chain_thresholds t WHERE t.tenant_id = b.tenant_id AND t.subject_type = 'bmc_unit' AND t.subject_id = b.id);

CREATE TABLE IF NOT EXISTS device_keys (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  device_id       uuid NOT NULL REFERENCES twin_devices(id),
  subject_type    varchar(40) NOT NULL,
  subject_id      uuid NOT NULL,
  key_enc         text NOT NULL,
  key_hint        varchar(8) NOT NULL,
  status          varchar(10) NOT NULL DEFAULT 'active',
  issued_by       uuid NOT NULL REFERENCES users(id),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issue_reason    text NOT NULL,
  revoked_by      uuid REFERENCES users(id),
  revoked_at      timestamptz,
  revoke_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_dk_subject CHECK (subject_type IN ('shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box')),
  CONSTRAINT ck_dk_status CHECK (status IN ('active', 'revoked')),
  CONSTRAINT ck_dk_enc CHECK (key_enc ~ '^v2\.'),
  CONSTRAINT ck_dk_reason CHECK (char_length(btrim(issue_reason)) BETWEEN 10 AND 500),
  CONSTRAINT ck_dk_revoked CHECK ((status = 'revoked') = (revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND char_length(btrim(coalesce(revoke_reason, ''))) >= 10))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dk_one_active ON device_keys (device_id) WHERE status = 'active';
COMMENT ON TABLE device_keys IS
  'PC-56 TENANT-SW-e (0201, founder decision DEVICE-AUTHENTICATED INGEST): the HMAC-SHA256 key a cold-chain logger (a twin_devices row of kind cold_chain_logger) signs its readings with, and the subject the logger is mounted on — one ACTIVE key per device. The key is sealed with 13a''s envelope (AES-256-GCM data key under the platform KEK, additional data device_key:<id>) and SHOWN ONCE when issued; kv_app cannot read key_enc (column grant), only the kv_ingest lookup function returns it, and the API opens it. Issuing a new key revokes the old one in the same transaction.';
CREATE OR REPLACE FUNCTION assert_device_key_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE d record;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '[DEVICE_KEY_APPEND_ONLY] a key is revoked, never deleted — PC-56 TENANT-SW-e' USING ERRCODE = '42501'; END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT tenant_id, kind_code, status INTO d FROM twin_devices WHERE id = NEW.device_id;
    IF d.tenant_id IS DISTINCT FROM NEW.tenant_id OR d.kind_code <> 'cold_chain_logger' OR d.status <> 'registered' THEN
      RAISE EXCEPTION '[DEVICE_KEY_DEVICE] a key is issued to a registered cold-chain logger of this organisation — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> 'active' THEN RAISE EXCEPTION '[DEVICE_KEY_BORN_ACTIVE] a key is born active — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'revoked' OR NEW.key_enc <> OLD.key_enc OR NEW.device_id <> OLD.device_id OR NEW.tenant_id <> OLD.tenant_id
     OR NEW.subject_type <> OLD.subject_type OR NEW.subject_id <> OLD.subject_id OR NEW.issued_by <> OLD.issued_by OR NEW.issued_at <> OLD.issued_at THEN
    RAISE EXCEPTION '[DEVICE_KEY_FINAL] a key is only ever revoked — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_dk_moves ON device_keys;
CREATE TRIGGER trg_dk_moves BEFORE INSERT OR UPDATE OR DELETE ON device_keys FOR EACH ROW EXECUTE FUNCTION assert_device_key_moves();

-- the replay wall: one row per (device, nonce); the ingest route inserts it in the reading's own transaction
CREATE TABLE IF NOT EXISTS cold_chain_ingest_nonces (
  device_id     uuid NOT NULL REFERENCES twin_devices(id),
  nonce         varchar(64) NOT NULL,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  signed_at     timestamptz NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, nonce),
  CONSTRAINT ck_ccn_nonce CHECK (nonce ~ '^[A-Za-z0-9_-]{16,64}$')
);
COMMENT ON TABLE cold_chain_ingest_nonces IS
  'PC-56 TENANT-SW-e (0201): the replay wall of the device ingest route — a signed request''s nonce, once per device (PRIMARY KEY). A replayed request (same nonce) fails on this key and is refused; a request whose signed timestamp is more than 5 minutes from the server clock is refused before it reaches here.';

ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS source varchar(8) NOT NULL DEFAULT 'manual';
ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS device_id uuid REFERENCES twin_devices(id);
ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS server_recorded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS band_min_c numeric(5,2);
ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS band_max_c numeric(5,2);
ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS sequence_no bigint;
ALTER TABLE cold_chain_logs ADD COLUMN IF NOT EXISTS threshold_id uuid;
ALTER TABLE cold_chain_logs DROP CONSTRAINT IF EXISTS ck_ccl_source;
ALTER TABLE cold_chain_logs ADD CONSTRAINT ck_ccl_source CHECK (source IN ('device', 'manual') AND ((source = 'device') = (device_id IS NOT NULL)));
ALTER TABLE cold_chain_logs DROP CONSTRAINT IF EXISTS ck_ccl_band;
ALTER TABLE cold_chain_logs ADD CONSTRAINT ck_ccl_band CHECK ((band_min_c IS NULL) = (band_max_c IS NULL) AND (band_min_c IS NULL OR band_min_c <= band_max_c));
COMMENT ON COLUMN cold_chain_logs.source IS 'PC-56 TENANT-SW-e (0201): device = signed by a registered logger on the kv_ingest route; manual = typed on the console (logistics.manage) or sent by the dairy desk route. A manual reading never opens a breach — it is labelled.';
COMMENT ON COLUMN cold_chain_logs.server_recorded_at IS 'PC-56 TENANT-SW-e (0201): the time of RECORD — the database''s clock at write, never a body''s. recorded_at is the device''s own time (buffered readings keep it); a manual reading''s recorded_at must be the server''s now().';
COMMENT ON COLUMN cold_chain_logs.band_min_c IS 'PC-56 TENANT-SW-e (0201): the band in force at write, COPIED from cold_chain_thresholds by trg_ccl_before — never from the body. NULL = no threshold was set for the subject (the reading is kept; no excursion can be judged and the console says so).';
COMMENT ON COLUMN cold_chain_logs.is_breach IS 'Since PC-56 TENANT-SW-e (0201): THIS READING is outside the band copied at write (an excursion). A BREACH is cold_chain_breaches: two consecutive DEVICE readings outside the band.';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccl_device_seq ON cold_chain_logs (device_id, sequence_no, recorded_at) WHERE device_id IS NOT NULL AND sequence_no IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ccl_device_time ON cold_chain_logs (tenant_id, subject_type, subject_id, source, recorded_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS cold_chain_breaches (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id),
  subject_type            varchar(40) NOT NULL,
  subject_id              uuid NOT NULL,
  device_id               uuid REFERENCES twin_devices(id),
  band_min_c              numeric(5,2) NOT NULL,
  band_max_c              numeric(5,2) NOT NULL,
  direction               varchar(5) NOT NULL,
  first_out_at            timestamptz NOT NULL,
  first_log_id            bigint NOT NULL,
  opened_at               timestamptz NOT NULL DEFAULT now(),
  opened_log_id           bigint NOT NULL,
  peak_c                  numeric(5,2) NOT NULL,
  readings_out            integer NOT NULL DEFAULT 2,
  last_out_at             timestamptz NOT NULL,
  closed_at               timestamptz,
  closed_log_id           bigint,
  duration_seconds        integer,
  alert_id                uuid,
  alert_state             varchar(14) NOT NULL,
  alert_recipients        integer NOT NULL DEFAULT 0,
  playbook_run_id         uuid,
  acknowledged_at         timestamptz,
  acknowledged_by         uuid REFERENCES users(id),
  action_at               timestamptz,
  action_by               uuid REFERENCES users(id),
  action_note             text,
  outcome                 varchar(20),
  outcome_at              timestamptz,
  outcome_by              uuid REFERENCES users(id),
  outcome_reason          text,
  loss_minor              bigint,
  loss_currency           char(3) REFERENCES currencies(code),
  buyer_user_id           uuid REFERENCES users(id),
  buyer_offer_state       varchar(8) NOT NULL DEFAULT 'none',
  buyer_offered_at        timestamptz,
  buyer_decision          varchar(18),
  buyer_decided_at        timestamptz,
  buyer_decision_reason   text,
  dispute_id              uuid,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ccb_subject CHECK (subject_type IN ('shipment', 'bmc_unit', 'warehouse_chamber', 'vaccine_box')),
  CONSTRAINT ck_ccb_direction CHECK (direction IN ('above', 'below')),
  CONSTRAINT ck_ccb_alert_state CHECK (alert_state IN ('alerted', 'no_recipient')),
  CONSTRAINT ck_ccb_closed CHECK ((closed_at IS NULL) = (closed_log_id IS NULL) AND (closed_at IS NULL) = (duration_seconds IS NULL)),
  CONSTRAINT ck_ccb_ack CHECK ((acknowledged_at IS NULL) = (acknowledged_by IS NULL)),
  CONSTRAINT ck_ccb_action CHECK ((action_at IS NULL) = (action_by IS NULL) AND (action_at IS NULL OR char_length(btrim(coalesce(action_note, ''))) >= 10)),
  CONSTRAINT ck_ccb_outcome CHECK (outcome IS NULL OR outcome IN ('accepted', 'accepted_with_test', 'rejected', 'loss_recorded', 'none')),
  CONSTRAINT ck_ccb_outcome_who CHECK ((outcome IS NULL) = (outcome_at IS NULL AND outcome_by IS NULL) AND (outcome IS NULL OR char_length(btrim(coalesce(outcome_reason, ''))) >= 10)),
  CONSTRAINT ck_ccb_loss CHECK ((loss_minor IS NOT NULL) = (outcome = 'loss_recorded') AND (loss_minor IS NULL OR (loss_minor > 0 AND loss_currency IS NOT NULL))),
  CONSTRAINT ck_ccb_offer CHECK (buyer_offer_state IN ('none', 'offered', 'decided') AND ((buyer_offer_state = 'none') = (buyer_offered_at IS NULL))),
  CONSTRAINT ck_ccb_decision CHECK ((buyer_offer_state = 'decided') = (buyer_decision IS NOT NULL AND buyer_decided_at IS NOT NULL)
                                    AND (buyer_decision IS NULL OR buyer_decision IN ('accept', 'accept_with_test', 'reject')))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccb_one_open ON cold_chain_breaches (tenant_id, subject_type, subject_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ccb_feed ON cold_chain_breaches (tenant_id, created_at DESC, id DESC);
COMMENT ON TABLE cold_chain_breaches IS
  'PC-56 TENANT-SW-e (0201, W239 "breach = 2 consecutive readings above", W240): one breach of a subject — opened by the database when a DEVICE reading outside the band follows another device reading outside the band (cold_chain_breach_on_reading, same transaction as the second reading), closed by the first in-band device reading. Carries its alert (ops_fired_alerts + the logistics.cold_chain_breach notification to the subject''s responsible operators), the buyer''s accept-with-test offer (a shipment breach above 15 minutes) and decision, and the operator''s acts — acknowledge, action, outcome (loss only with a reason). No row is ever deleted; only the acts update it (trg_ccb_moves + column grants).';

CREATE OR REPLACE FUNCTION assert_cold_chain_breach_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE me uuid := kv_session_user();
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION '[BREACH_APPEND_ONLY] breach records are append-only — PC-56 TENANT-SW-e' USING ERRCODE = '42501'; END IF;
  -- `current_user` (not kv_db_actor): this trigger is INVOKER, so inside the SECURITY DEFINER reading trigger (the close / peak
  -- path) it runs as the definer and is skipped; a request-tier UPDATE runs as kv_app and is judged.
  IF current_user::text NOT IN ('kv_app', 'kv_relay', 'kv_ingest') THEN RETURN NEW; END IF;
  IF NEW.subject_type <> OLD.subject_type OR NEW.subject_id <> OLD.subject_id OR NEW.first_out_at <> OLD.first_out_at OR NEW.opened_at <> OLD.opened_at
     OR NEW.peak_c <> OLD.peak_c OR NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.band_min_c <> OLD.band_min_c OR NEW.band_max_c <> OLD.band_max_c THEN
    RAISE EXCEPTION '[BREACH_FACT_FINAL] what the readings recorded is final — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.acknowledged_at IS NOT NULL AND (NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at OR NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by) THEN
    RAISE EXCEPTION '[BREACH_ACT_ONCE] already acknowledged — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.action_at IS NOT NULL AND (NEW.action_at IS DISTINCT FROM OLD.action_at OR NEW.action_by IS DISTINCT FROM OLD.action_by OR NEW.action_note IS DISTINCT FROM OLD.action_note) THEN
    RAISE EXCEPTION '[BREACH_ACT_ONCE] the action is already recorded — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.outcome IS NOT NULL AND (NEW.outcome IS DISTINCT FROM OLD.outcome OR NEW.loss_minor IS DISTINCT FROM OLD.loss_minor OR NEW.outcome_reason IS DISTINCT FROM OLD.outcome_reason) THEN
    RAISE EXCEPTION '[BREACH_ACT_ONCE] the outcome is already recorded — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.acknowledged_by IS DISTINCT FROM OLD.acknowledged_by AND me IS NOT NULL AND NEW.acknowledged_by <> me THEN
    RAISE EXCEPTION '[BREACH_NOT_YOURS] an act is recorded in the actor''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.action_by IS DISTINCT FROM OLD.action_by AND me IS NOT NULL AND NEW.action_by <> me THEN
    RAISE EXCEPTION '[BREACH_NOT_YOURS] an act is recorded in the actor''s own session — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.outcome IS NOT NULL AND OLD.outcome IS NULL AND OLD.closed_at IS NULL THEN
    RAISE EXCEPTION '[BREACH_STILL_OPEN] an outcome is recorded once the readings are back in range — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
  END IF;
  -- the buyer's offer: only on a shipment breach that was (or still is) out of range for 15 minutes or more
  IF OLD.buyer_offer_state = 'none' AND NEW.buyer_offer_state = 'offered' THEN
    IF OLD.subject_type <> 'shipment' OR NEW.buyer_user_id IS NULL
       OR NOT (coalesce(OLD.closed_at, now()) - OLD.first_out_at >= interval '15 minutes') THEN
      RAISE EXCEPTION '[BREACH_OFFER_NOT_DUE] the buyer is offered accept-with-test after 15 minutes out of range on a shipment — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF OLD.buyer_offer_state = 'offered' AND NEW.buyer_offer_state = 'decided' THEN
    IF me IS NULL OR me <> OLD.buyer_user_id THEN
      RAISE EXCEPTION '[BREACH_DECISION_NOT_BUYER] only the buyer decides on the offer — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW.buyer_offer_state <> OLD.buyer_offer_state OR NEW.buyer_decision IS DISTINCT FROM OLD.buyer_decision OR NEW.buyer_user_id IS DISTINCT FROM OLD.buyer_user_id THEN
    RAISE EXCEPTION '[BREACH_OFFER_MOVE] % → % is not an offer move — PC-56 TENANT-SW-e', OLD.buyer_offer_state, NEW.buyer_offer_state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ccb_moves ON cold_chain_breaches;
CREATE TRIGGER trg_ccb_moves BEFORE UPDATE OR DELETE ON cold_chain_breaches FOR EACH ROW EXECUTE FUNCTION assert_cold_chain_breach_moves();

CREATE TABLE IF NOT EXISTS cold_chain_device_silences (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  device_id         uuid NOT NULL REFERENCES twin_devices(id),
  subject_type      varchar(40) NOT NULL,
  subject_id        uuid NOT NULL,
  last_reading_at   timestamptz NOT NULL,
  flagged_at        timestamptz NOT NULL DEFAULT now(),
  alert_id          uuid,
  alert_state       varchar(14) NOT NULL,
  alert_recipients  integer NOT NULL DEFAULT 0,
  resolved_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_ccds_alert_state CHECK (alert_state IN ('alerted', 'no_recipient'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ccds_one_open ON cold_chain_device_silences (device_id) WHERE resolved_at IS NULL;
COMMENT ON TABLE cold_chain_device_silences IS
  'PC-56 TENANT-SW-e (0201, W234 "15-min silence"): a registered logger with an active key that has not reported for more than 15 minutes, flagged ONCE per silence by the registered job logistics-cold-chain-watch (kv_app unit of work) and alerted to the operators (ops feed + logistics.cold_chain_device_silent). The canon''s "auto-calls the operator" is REFUSED BY NAME: the platform has no voice channel — the operator is alerted, not called. Resolved by the device''s next reading.';

-- BEFORE INSERT on a reading: the band from the store, the server's clock, the excursion flag — never the body's.
CREATE OR REPLACE FUNCTION cold_chain_reading_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE b record; actor text := kv_db_actor(); d record;
BEGIN
  IF NEW.source = 'device' THEN
    -- a DEVICE reading arrives only on the signed ingest route (kv_ingest). The admin realm / fixtures (superuser) may write one.
    IF actor IN ('kv_app', 'kv_relay', 'kv_readonly', 'kv_admin') THEN
      RAISE EXCEPTION '[COLD_CHAIN_DEVICE_SOURCE_INGEST_ONLY] a device reading arrives signed on the device ingest route — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    SELECT tenant_id, kind_code, status INTO d FROM twin_devices WHERE id = NEW.device_id;
    IF d.tenant_id IS DISTINCT FROM NEW.tenant_id OR d.kind_code <> 'cold_chain_logger' THEN
      RAISE EXCEPTION '[COLD_CHAIN_DEVICE_UNKNOWN] the logger is not this organisation''s — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.recorded_at > now() + interval '1 minute' OR NEW.recorded_at < now() - interval '24 hours' THEN
      RAISE EXCEPTION '[COLD_CHAIN_DEVICE_TIME] a device reading is no later than now and no more than 24 hours old (buffered) — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF actor IN ('kv_app', 'kv_relay', 'kv_ingest') AND NEW.recorded_at <> now() THEN
      RAISE EXCEPTION '[COLD_CHAIN_MANUAL_TIME_IS_SERVER] a manual reading is recorded at the server''s time — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
    IF actor = 'kv_ingest' THEN
      RAISE EXCEPTION '[COLD_CHAIN_INGEST_IS_DEVICE] the ingest route writes device readings only — PC-56 TENANT-SW-e' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  NEW.server_recorded_at := now();
  -- THE BAND: copied from the store, whatever the statement carried
  SELECT * INTO b FROM kv_cold_chain_band(NEW.tenant_id, NEW.subject_type, NEW.subject_id);
  NEW.band_min_c := b.min_c;
  NEW.band_max_c := b.max_c;
  NEW.threshold_id := b.threshold_id;
  NEW.is_breach := b.min_c IS NOT NULL AND (NEW.temp_c < b.min_c OR NEW.temp_c > b.max_c);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ccl_before ON cold_chain_logs;
CREATE TRIGGER trg_ccl_before BEFORE INSERT ON cold_chain_logs FOR EACH ROW EXECUTE FUNCTION cold_chain_reading_before();

-- AFTER INSERT on a reading: THE BREACH RULE (device readings only) — 2 consecutive out-of-band readings open a breach; the first
-- in-band reading closes it. Same transaction as the reading. Also: a logger's last reading, and the end of its silence.
CREATE OR REPLACE FUNCTION cold_chain_breach_on_reading() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE open_b record; prev record; recips jsonb; rider uuid; bid uuid; aid uuid; dir text; pk numeric;
BEGIN
  IF NEW.source <> 'device' THEN RETURN NULL; END IF;
  UPDATE twin_devices SET last_reading_at = greatest(coalesce(last_reading_at, NEW.server_recorded_at), NEW.server_recorded_at) WHERE id = NEW.device_id;
  UPDATE cold_chain_device_silences SET resolved_at = NEW.server_recorded_at WHERE device_id = NEW.device_id AND resolved_at IS NULL;
  IF NEW.band_min_c IS NULL THEN RETURN NULL; END IF;   -- no threshold: nothing can be judged (the console says so)
  PERFORM pg_advisory_xact_lock(hashtext('cold_chain_breach:' || NEW.tenant_id::text || ':' || NEW.subject_type || ':' || NEW.subject_id::text));
  SELECT * INTO open_b FROM cold_chain_breaches
   WHERE tenant_id = NEW.tenant_id AND subject_type = NEW.subject_type AND subject_id = NEW.subject_id AND closed_at IS NULL FOR UPDATE;
  IF NOT NEW.is_breach THEN
    IF open_b.id IS NOT NULL THEN
      UPDATE cold_chain_breaches SET closed_at = NEW.recorded_at, closed_log_id = NEW.id,
             duration_seconds = greatest(0, floor(extract(epoch FROM (NEW.recorded_at - open_b.first_out_at)))::int), updated_at = now()
       WHERE id = open_b.id;
    END IF;
    RETURN NULL;
  END IF;
  dir := CASE WHEN NEW.temp_c > NEW.band_max_c THEN 'above' ELSE 'below' END;
  IF open_b.id IS NOT NULL THEN
    UPDATE cold_chain_breaches SET readings_out = readings_out + 1, last_out_at = greatest(last_out_at, NEW.recorded_at),
           peak_c = CASE WHEN direction = 'above' THEN greatest(peak_c, NEW.temp_c) ELSE least(peak_c, NEW.temp_c) END, updated_at = now()
     WHERE id = open_b.id;
    RETURN NULL;
  END IF;
  -- the reading before this one, from a device, on this subject (24 h look-back bounds the partitions)
  SELECT l.id, l.recorded_at, l.temp_c, l.is_breach, l.band_min_c INTO prev FROM cold_chain_logs l
   WHERE l.tenant_id = NEW.tenant_id AND l.subject_type = NEW.subject_type AND l.subject_id = NEW.subject_id AND l.source = 'device'
     AND l.recorded_at >= NEW.recorded_at - interval '24 hours' AND l.recorded_at <= NEW.recorded_at
     AND (l.recorded_at < NEW.recorded_at OR l.id < NEW.id) AND l.id <> NEW.id
   ORDER BY l.recorded_at DESC, l.id DESC LIMIT 1;
  -- BREACH = 2 CONSECUTIVE device readings outside the band. One is an excursion, logged and labelled — not a breach.
  IF prev.id IS NULL OR NOT prev.is_breach THEN RETURN NULL; END IF;
  pk := CASE WHEN dir = 'above' THEN greatest(NEW.temp_c, prev.temp_c) ELSE least(NEW.temp_c, prev.temp_c) END;
  -- who is told: the operators named on this organisation's active cold-chain alert rules, and the driver when the subject is a shipment
  SELECT coalesce(jsonb_agg(DISTINCT x), '[]'::jsonb) INTO recips FROM (
    SELECT jsonb_array_elements_text(r.recipient_user_ids) AS x FROM ops_alert_rules r
     WHERE r.tenant_id = NEW.tenant_id AND r.kind = 'cold_chain_breach' AND r.is_active AND r.deleted_at IS NULL
    UNION
    SELECT s.rider_user_id::text FROM shipments s WHERE NEW.subject_type = 'shipment' AND s.id = NEW.subject_id AND s.tenant_id = NEW.tenant_id AND s.rider_user_id IS NOT NULL
  ) q WHERE x IS NOT NULL;
  bid := uuid_generate_v7();
  aid := uuid_generate_v7();
  INSERT INTO cold_chain_breaches (id, tenant_id, subject_type, subject_id, device_id, band_min_c, band_max_c, direction, first_out_at, first_log_id,
                                   opened_at, opened_log_id, peak_c, readings_out, last_out_at, alert_id, alert_state, alert_recipients)
  VALUES (bid, NEW.tenant_id, NEW.subject_type, NEW.subject_id, NEW.device_id, NEW.band_min_c, NEW.band_max_c, dir, prev.recorded_at, prev.id,
          now(), NEW.id, pk, 2, NEW.recorded_at, aid, CASE WHEN jsonb_array_length(recips) > 0 THEN 'alerted' ELSE 'no_recipient' END, jsonb_array_length(recips));
  -- the existing alert feed (W54-12 / PC-55): the row is the breach's own, not a rule's (rule_id NULL)
  INSERT INTO ops_fired_alerts (id, tenant_id, rule_id, kind, severity, subject_type, subject_ref, detail, recipients, dedupe_key, notified)
  VALUES (aid, NEW.tenant_id, NULL, 'cold_chain_breach', 'critical', NEW.subject_type, NEW.subject_id::text,
          jsonb_build_object('breachId', bid, 'peakC', pk::text, 'bandMinC', NEW.band_min_c::text, 'bandMaxC', NEW.band_max_c::text, 'direction', dir,
                             'firstOutAt', prev.recorded_at, 'deviceId', NEW.device_id),
          recips, 'cold_chain_breach:' || bid::text, jsonb_array_length(recips) > 0);
  IF jsonb_array_length(recips) > 0 THEN
    INSERT INTO outbox_events (tenant_id, aggregate_type, aggregate_id, event_type, payload)
    VALUES (NEW.tenant_id, 'cold_chain_breach', bid, 'logistics.cold_chain_breach',
            jsonb_build_object('v', 1, 'breachId', bid, 'subjectType', NEW.subject_type, 'subjectId', NEW.subject_id,
                               'subjectRef', upper(left(replace(NEW.subject_id::text, '-', ''), 8)), 'peakC', pk::text,
                               'bandMinC', NEW.band_min_c::text, 'bandMaxC', NEW.band_max_c::text, 'recipientUserIds', recips));
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_ccl_breach ON cold_chain_logs;
CREATE TRIGGER trg_ccl_breach AFTER INSERT ON cold_chain_logs FOR EACH ROW EXECUTE FUNCTION cold_chain_breach_on_reading();

-- kv_ingest's ONE read: which tenant, key ciphertext and subject a device id has. Nothing else about any tenant is reachable.
CREATE OR REPLACE FUNCTION kv_ingest_device_key(p_device uuid)
RETURNS TABLE (tenant_id uuid, key_id uuid, key_enc text, subject_type varchar, subject_id uuid, device_status varchar, device_kind varchar)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.tenant_id, k.id, k.key_enc, k.subject_type, k.subject_id, d.status, d.kind_code
    FROM device_keys k JOIN twin_devices d ON d.id = k.device_id AND d.tenant_id = k.tenant_id
   WHERE k.device_id = p_device AND k.status = 'active'
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION kv_ingest_device_key(uuid) FROM PUBLIC;
COMMENT ON FUNCTION kv_ingest_device_key(uuid) IS
  'PC-56 TENANT-SW-e (0201): the kv_ingest role''s one read — for a device id, its active key''s tenant, sealed ciphertext (opened by the API with the platform KEK) and mounted subject. EXECUTE to kv_ingest only.';

-- ------------------------------------------------------------------------------------------------------------------
-- 201.6  THE ALERT FEED · RETENTION
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE ops_fired_alerts ALTER COLUMN rule_id DROP NOT NULL;
COMMENT ON COLUMN ops_fired_alerts.rule_id IS
  'The rule that fired, or NULL (PC-56 TENANT-SW-e, 0201) when the alert is a cold-chain BREACH or a logger SILENCE recorded by the database / the watch job — those carry their own object (cold_chain_breaches / cold_chain_device_silences) and are told to the operators named on the tenant''s rules.';

-- W239 "trails keep 24 months for audit": a REGISTERED rule. `archive` is left to the archive pipeline — the retention enforcer
-- deletes only `delete` rules, so nothing is deleted today (13a's enforcer, read for this wave).
INSERT INTO data_retention_policies (table_name, active_months, legal_basis, action) VALUES
  ('cold_chain_logs', 24, 'W239 — cold-chain trails keep 24 months for audit (buyer quality claims, vet audits of a vaccine round)', 'archive'),
  ('cold_chain_breaches', 24, 'W240 — breach records travel with their trail: 24 months, then the archive pipeline', 'archive')
ON CONFLICT (table_name) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 201.7  NOTIFICATION CATALOGUE (copy: seed core/0007, push + in-app × en/hi/gu, ABOVE the version backfill)
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO notification_events (code, default_name, priority, default_channels, user_can_opt_out, batchable) VALUES
  ('logistics.slot_proposed', 'The pickup desk proposed pickup windows for you', 'informational', '["inapp","push"]', true, false),
  ('logistics.cold_chain_breach', 'Cold-chain breach: two readings in a row out of range', 'critical', '["inapp","push"]', false, false),
  ('logistics.cold_chain_buyer_offer', 'Your shipment left its temperature range — your decision', 'important', '["inapp","push"]', false, false),
  ('logistics.cold_chain_device_silent', 'A cold-chain logger stopped reporting', 'important', '["inapp","push"]', false, false)
ON CONFLICT (code) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 201.8  RLS (the 0175 split) · GRANTS · INDEXES
-- ------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['pickup_slot_proposals', 'route_drop_points', 'route_runs', 'parcel_handovers', 'parcel_handover_fees',
                           'cold_chain_thresholds', 'cold_chain_breaches', 'device_keys', 'cold_chain_ingest_nonces', 'cold_chain_device_silences'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_insert_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_update_own', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_admin_realm', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly, kv_ingest', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON pickup_slot_proposals TO kv_app;
GRANT UPDATE (status, decided_at, decided_by, channel, decline_reason, withdrawn_by, withdrawn_at, withdraw_reason, applied_slot_ids, updated_at) ON pickup_slot_proposals TO kv_app;
GRANT SELECT, INSERT ON route_drop_points TO kv_app;
GRANT UPDATE (name, window_start, window_end, active, deactivated_by, deactivated_at, deactivate_reason, updated_at) ON route_drop_points TO kv_app;
GRANT SELECT, INSERT ON route_runs TO kv_app;
GRANT UPDATE (status, loading_plan, partner_id, vehicle_id, draft_reason, confirmed_by, confirmed_at, loading_at, departed_at, completed_at,
              cancelled_by, cancelled_at, cancel_reason, updated_at) ON route_runs TO kv_app;
GRANT SELECT, INSERT ON parcel_handovers TO kv_app;
GRANT UPDATE (status, recipient_otp_verified_at, collected_at, returned_at, return_reason, updated_at) ON parcel_handovers TO kv_app;
GRANT SELECT ON parcel_handover_fees TO kv_app;
GRANT SELECT, INSERT ON cold_chain_thresholds TO kv_app;
GRANT SELECT ON cold_chain_breaches TO kv_app;
GRANT UPDATE (acknowledged_at, acknowledged_by, action_at, action_by, action_note, outcome, outcome_at, outcome_by, outcome_reason, loss_minor, loss_currency,
              buyer_user_id, buyer_offer_state, buyer_offered_at, buyer_decision, buyer_decided_at, buyer_decision_reason, dispute_id, updated_at) ON cold_chain_breaches TO kv_app;
-- kv_app never reads a key's ciphertext: every column but key_enc
GRANT SELECT (id, tenant_id, device_id, subject_type, subject_id, key_hint, status, issued_by, issued_at, issue_reason, revoked_by, revoked_at, revoke_reason, created_at) ON device_keys TO kv_app;
GRANT INSERT ON device_keys TO kv_app;
GRANT UPDATE (status, revoked_by, revoked_at, revoke_reason) ON device_keys TO kv_app;
GRANT SELECT ON cold_chain_ingest_nonces TO kv_app;
GRANT SELECT, INSERT ON cold_chain_device_silences TO kv_app;
GRANT SELECT ON pickup_slot_proposals, route_drop_points, route_runs, parcel_handovers, parcel_handover_fees, cold_chain_thresholds, cold_chain_breaches,
                cold_chain_device_silences TO kv_readonly;

-- cold_chain_logs: kv_app writes ONLY what a manual reading may carry — never a band, a server time, an excursion flag, a device
-- or a sequence (the trigger would overwrite them anyway; the grant makes the attempt a 42501 first).
REVOKE INSERT ON cold_chain_logs FROM kv_app;
GRANT INSERT (tenant_id, subject_type, subject_id, temp_c, humidity_pct, device_ref, recorded_at, source) ON cold_chain_logs TO kv_app;

-- kv_ingest: exactly what the device route needs — its one lookup, the nonce, the reading (device columns, no band / time of record)
GRANT USAGE ON SCHEMA public TO kv_ingest;
GRANT EXECUTE ON FUNCTION kv_ingest_device_key(uuid) TO kv_ingest;
GRANT EXECUTE ON FUNCTION current_tenant_id() TO kv_ingest;
GRANT INSERT ON cold_chain_ingest_nonces TO kv_ingest;
GRANT INSERT (tenant_id, subject_type, subject_id, temp_c, humidity_pct, device_ref, recorded_at, source, device_id, sequence_no) ON cold_chain_logs TO kv_ingest;
GRANT USAGE ON SEQUENCE cold_chain_logs_id_seq TO kv_ingest;

CREATE INDEX IF NOT EXISTS idx_psp_seller_open ON pickup_slot_proposals (tenant_id, seller_user_id) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS idx_psp_feed ON pickup_slot_proposals (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_rdp_route ON route_drop_points (tenant_id, route_id, sequence);
CREATE INDEX IF NOT EXISTS idx_rr_route ON route_runs (tenant_id, route_id, run_date DESC);
CREATE INDEX IF NOT EXISTS idx_ph_run ON parcel_handovers (tenant_id, run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_phf_route ON parcel_handover_fees (tenant_id, route_id);
CREATE INDEX IF NOT EXISTS idx_dk_tenant ON device_keys (tenant_id, device_id);
CREATE INDEX IF NOT EXISTS idx_ccds_tenant ON cold_chain_device_silences (tenant_id, flagged_at DESC);
CREATE INDEX IF NOT EXISTS idx_ccn_received ON cold_chain_ingest_nonces (received_at);
CREATE INDEX IF NOT EXISTS idx_shipments_partner_created ON shipments (tenant_id, partner_id, created_at DESC) WHERE partner_id IS NOT NULL;
