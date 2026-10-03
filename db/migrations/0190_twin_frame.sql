-- ==================================================================================================================
-- MIGRATION 0190 — PC-56 TENANT-12 · DIGITAL TWIN, IoT & ADVISORY — THE HONEST FRAME (NO MODEL)
-- Runner: db/scripts/migrate.js wraps this file in ONE transaction and records it in schema_migrations.
-- NEVER edit an applied migration — add a new numbered one. (0005, 0010, 0013, 0014, 0060, 0061, 0124, 0175, 0182 are
-- applied; nothing here edits them.)
-- ==================================================================================================================
--
-- FOUNDER DECISIONS (brief_t12.md, 2026-10-03): HONEST FRAME, NO MODEL · DEVICE REGISTRY ONLY, READINGS REFUSED ·
-- LICENSED BY FEATURE FLAG PER PLAN.
--
-- THE LAW OF THIS FILE (F-1): no figure that no registered model and recorded run produced — ever. A twin band may exist
-- only where (a) a model code + version is registered in `ai_models` at production/canary, (b) a `twin_runs` row records
-- the input snapshot hash, the assumption values with their cited sources, the pinned model version and the seed, (c) the
-- outputs are stored with that row and an `ai_inferences` row points at it. The DATABASE refuses the other shapes:
--   • `ck_twin_runs_refused` — a refused attempt carries its refusal code and NO outputs, NO inference;
--   • `ck_twin_runs_outputs` — outputs only on a `done` row that names model, version, input hash, seed and inference;
--   • `trg_twin_runs_gate`   — any non-refused row must pin a model REGISTERED at production/canary (code + version);
--   • kv_app holds SELECT, INSERT on `twin_runs` — no UPDATE: nothing in the tenant realm can turn a refusal into a band.
-- No model is registered this wave (ai_models: 0 rows; apps/ai-services has no yield / rainfall / adoption / income model),
-- so the only row the API ever writes here is `refused / TWIN_NO_MODEL_REGISTERED` — the honest record of the attempt.
--
-- WHAT THIS FILE DOES
--   190.1  LOOKUPS (F-16) — dedupe the platform `irrigation` and `weather_alert` vocabularies (keep the lowest id, repoint
--          `land_parcels.irrigation_type_id` and `weather_alerts.alert_type_id`, retire the duplicates by soft delete — nothing
--          is deleted), partial unique indexes for irrigation / weather_alert / twin_assumption_key / twin_device_kind /
--          twin_scenario_template; the three twin vocabularies (keys with their units, device kinds, templates with their keys
--          and NO values). Seed 0005 mirrors them for a fresh install (it runs before this file in both bootstraps, so it
--          guards with NOT EXISTS + a target-less ON CONFLICT, which the partial indexes catch once they exist).
--   190.2  THE TWIN TABLES — twin_scenarios · twin_assumptions (+ twin_assumption_history, append-only, written by trigger) ·
--          twin_runs (the gate) · twin_devices (registry; `last_reading_at` has NO writer — ingestion is refused by name) ·
--          twin_feeds (platform registry; the as-of is computed on read from the real tables, never typed) ·
--          twin_access_requests (one idempotent "ask your account desk" row per tenant — never a repeated nag, F-15).
--          RLS ENABLE + FORCE, the 0175 split (SELECT / INSERT / UPDATE on the current tenant only, never NULL; kv_admin
--          realm policy); kv_relay holds nothing.
--   190.3  PERMISSIONS (F-12) — twin.view · twin.run · twin.devices.manage · land.admin · ai.inference.read.
--   190.4  THE FLAG — `digital_twin`, default OFF (licensed per plan / tenant allowlist through the flag engine, F-3).
--   190.5  THE SETTING — `twin.min_group_size` (platform, default 5): the floor under any member-level aggregate.
--   190.6  F-3  — REVOKE INSERT, UPDATE ON plan_features, tenant_features, subscription_addons FROM kv_app.
--   190.7  F-4  — mandi provenance: `mandi_prices.tenant_id` + `entered_by`; RLS (the NULL-tenant platform row is not
--          writable by kv_app); `tenant_manual` rows are tenant-scoped; kv_app loses UPDATE on mandi_prices and INSERT /
--          UPDATE on price_predictions (the tenant API refuses a typed band, 409).
--   190.8  F-5  — weather_alerts: REVOKE INSERT, UPDATE FROM kv_app (kv_ingest is the writer; ingestion itself is refused
--          by name — IMD/Skymet are not connected).
--   190.9  F-7  — ai_models: REVOKE INSERT, UPDATE FROM kv_app; the 0175 split on ai_inferences and ai_review_queue.
--   190.10 F-8  — crop_calendars: the 0175 split + REVOKE kv_app writes (admin-api is the writer).
--   190.11 F-9  — crop_seasons.yield_unit_code (FK units) — existing rows that carry a yield are BACKFILLED to 'quintal'.
--          THAT IS AN ASSUMPTION, stated here and in the column comment: before 0190 no unit was ever recorded, the DTO said
--          only "yield, up to 3 decimals", and quintal is the unit every Gujarat/Maharashtra mandi and every canon screen
--          uses. New rows carry the unit the farmer gives; a yield without a unit is refused (CHECK + DTO).
--   190.12 F-14 — coop_resolutions.source_ref (nullable jsonb `{kind:'twin_run', id}`) — validated against a DONE run of
--          the same tenant; nothing writes it this wave ("no run to cite").
--   190.13 PARTITIONS — `sync_partition_rls` copies a partitioned parent's RLS + policies onto its children, and
--          `ensure_partitions` now calls it, so a new monthly partition of a tenant table is never policy-less.
--   190.14 INDEXES.
-- ==================================================================================================================

-- ------------------------------------------------------------------------------------------------------------------
-- 190.1  LOOKUPS — F-16: dedupe, partial unique indexes, the twin vocabularies
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO lookup_types (code, default_name, is_tenant_extendable) VALUES
  ('twin_assumption_key',    'Digital twin assumption key', false),
  ('twin_device_kind',       'Digital twin field device kind', false),
  ('twin_scenario_template', 'Digital twin scenario template', false)
ON CONFLICT (code) DO NOTHING;

-- The duplicates of the two vocabularies this wave reads, keeper = the lowest id per (type, code).
CREATE TEMP TABLE _t12_lv_dupes ON COMMIT DROP AS
SELECT s.id AS dup_id, s.keep_id
  FROM (SELECT id, first_value(id) OVER (PARTITION BY type_code, code ORDER BY id) AS keep_id
          FROM lookup_values
         WHERE tenant_id IS NULL AND deleted_at IS NULL AND type_code IN ('irrigation', 'weather_alert')) s
 WHERE s.id <> s.keep_id;

-- Repoint the references the platform has to these two vocabularies: `land_parcels.irrigation_type_id` (the one FK the map —
-- pg_constraint, confrelid = lookup_values — names for them) and `weather_alerts.alert_type_id` (a partitioned table that
-- references the vocabulary by convention, with no FK). No generic scan of every FK column is run here on purpose: that would be
-- a full read of the ledger tables inside a migration, and it is unnecessary — the duplicates below are RETIRED, never deleted,
-- so any reference this file does not repoint stays valid and resolves to its keeper through `meta.duplicate_of`.
UPDATE land_parcels lp SET irrigation_type_id = d.keep_id FROM _t12_lv_dupes d WHERE lp.irrigation_type_id = d.dup_id;
UPDATE weather_alerts wa SET alert_type_id = d.keep_id FROM _t12_lv_dupes d WHERE wa.alert_type_id = d.dup_id;

-- Retired, not deleted (programme rule): the duplicate row stays, inactive, soft-deleted, and says what it duplicated.
UPDATE lookup_values lv
   SET is_active = false, deleted_at = now(), updated_at = now(),
       meta = lv.meta || jsonb_build_object('duplicate_of', d.keep_id::text, 'retired_by', '0190_twin_frame')
  FROM _t12_lv_dupes d
 WHERE lv.id = d.dup_id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_irrigation_platform    ON lookup_values (type_code, code) WHERE tenant_id IS NULL AND deleted_at IS NULL AND type_code = 'irrigation';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_weather_alert_platform ON lookup_values (type_code, code) WHERE tenant_id IS NULL AND deleted_at IS NULL AND type_code = 'weather_alert';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_twin_key_platform      ON lookup_values (type_code, code) WHERE tenant_id IS NULL AND deleted_at IS NULL AND type_code = 'twin_assumption_key';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_twin_device_platform   ON lookup_values (type_code, code) WHERE tenant_id IS NULL AND deleted_at IS NULL AND type_code = 'twin_device_kind';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lookup_values_twin_template_platform ON lookup_values (type_code, code) WHERE tenant_id IS NULL AND deleted_at IS NULL AND type_code = 'twin_scenario_template';

-- The twin vocabularies. Keys carry the unit their value is entered in; templates carry their keys and NO VALUES — the
-- canon's "source defaults" (IMD baseline −20 %, input cost index +4 %) have no recorded source in this platform, so a
-- scenario starts empty and every value is typed WITH its citation and as-of (twin_assumptions CHECKs).
-- ALSO INSERTED BY SEED core/0005, identically and idempotently (this file is what an existing database gets).
INSERT INTO lookup_values (type_code, tenant_id, code, default_name, meta, sort_order)
SELECT v.type_code, NULL, v.code, v.default_name, v.meta::jsonb, v.sort_order
  FROM (VALUES
 ('twin_assumption_key','rainfall_delta_pct','Rainfall change vs the cited baseline','{"unit":"pct","min":-100,"max":300}',1),
 ('twin_assumption_key','price_delta_pct','Crop price change vs the cited baseline','{"unit":"pct","min":-100,"max":300}',2),
 ('twin_assumption_key','input_cost_delta_pct','Input cost change vs the cited baseline','{"unit":"pct","min":-100,"max":300}',3),
 ('twin_assumption_key','drip_adoption_pct','Share of member area under drip','{"unit":"pct","min":0,"max":100}',4),
 ('twin_assumption_key','member_profile_area_ha','Area of the member profile the scenario describes','{"unit":"hectare","min":0.01,"max":1000}',5),
 ('twin_device_kind','soil_pod','Soil pod (in-field soil sensor)','{}',1),
 ('twin_device_kind','weather_mast','Weather mast (field weather station)','{}',2),
 ('twin_scenario_template','rainfall_shock','Monsoon rainfall shock','{"keys":["rainfall_delta_pct","member_profile_area_ha"]}',1),
 ('twin_scenario_template','price_shock','Crop price shock','{"keys":["price_delta_pct","member_profile_area_ha"]}',2),
 ('twin_scenario_template','input_cost_shock','Input cost shock','{"keys":["input_cost_delta_pct","member_profile_area_ha"]}',3),
 ('twin_scenario_template','drip_adoption','Drip adoption uptake','{"keys":["drip_adoption_pct","rainfall_delta_pct","member_profile_area_ha"]}',4)
  ) AS v(type_code, code, default_name, meta, sort_order)
 WHERE NOT EXISTS (SELECT 1 FROM lookup_values x WHERE x.type_code = v.type_code AND x.tenant_id IS NULL AND x.code = v.code AND x.deleted_at IS NULL);

-- A twin vocabulary code must exist as an ACTIVE PLATFORM row (the tables below store the code, never a client id).
CREATE OR REPLACE FUNCTION twin_lookup_exists(p_type text, p_code text) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM lookup_values WHERE type_code = p_type AND code = p_code AND tenant_id IS NULL AND is_active AND deleted_at IS NULL)
$$;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.2  THE TWIN TABLES
-- ------------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS twin_scenarios (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id),
  name           varchar(120) NOT NULL,
  template_code  varchar(40),
  product_id     uuid REFERENCES products(id),
  status         varchar(12) NOT NULL DEFAULT 'draft',
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users(id),
  archived_at    timestamptz,
  archived_by    uuid REFERENCES users(id),
  archive_reason text,
  CONSTRAINT ck_twin_scenarios_status  CHECK (status IN ('draft', 'ready', 'archived')),
  CONSTRAINT ck_twin_scenarios_name    CHECK (char_length(btrim(name)) BETWEEN 3 AND 120),
  CONSTRAINT ck_twin_scenarios_archive CHECK ((status = 'archived') = (archived_at IS NOT NULL AND archived_by IS NOT NULL AND char_length(btrim(COALESCE(archive_reason, ''))) >= 3))
);
COMMENT ON TABLE twin_scenarios IS
  'PC-56 TENANT-12 (0190, W421): a cooperative''s what-if — a name, an optional template (twin_scenario_template) and crop, and its assumptions (twin_assumptions), each typed with a cited source and as-of. draft → ready (every template key set) → archived (reason). Running one is refused by name while no twin model is registered (twin_runs).';

CREATE OR REPLACE FUNCTION twin_scenarios_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.template_code IS NOT NULL AND NOT twin_lookup_exists('twin_scenario_template', NEW.template_code) THEN
    RAISE EXCEPTION 'twin_scenarios: unknown template %', NEW.template_code USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'archived' THEN
      RAISE EXCEPTION 'twin_scenarios: an archived scenario is final (PC-56 TENANT-12, 0190)' USING ERRCODE = '23514';
    END IF;
    IF NEW.template_code IS DISTINCT FROM OLD.template_code OR NEW.created_by <> OLD.created_by OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'twin_scenarios: template, author and tenant are fixed at creation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_twin_scenarios_guard ON twin_scenarios;
CREATE TRIGGER trg_twin_scenarios_guard BEFORE INSERT OR UPDATE ON twin_scenarios FOR EACH ROW EXECUTE FUNCTION twin_scenarios_guard();

CREATE TABLE IF NOT EXISTS twin_assumptions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  scenario_id     uuid NOT NULL REFERENCES twin_scenarios(id),
  key_code        varchar(40) NOT NULL,
  value           numeric(14,4) NOT NULL,
  unit_code       varchar(20) NOT NULL,
  source_citation text NOT NULL,
  source_asof     date NOT NULL,
  set_by          uuid NOT NULL REFERENCES users(id),
  set_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_twin_assumption_key UNIQUE (scenario_id, key_code),
  CONSTRAINT ck_twin_assumption_citation CHECK (char_length(btrim(source_citation)) BETWEEN 10 AND 500),
  CONSTRAINT ck_twin_assumption_unit CHECK (unit_code IN ('pct', 'hectare'))
);
COMMENT ON TABLE twin_assumptions IS
  'PC-56 TENANT-12 (0190, W421): one assumption of a scenario — a key from twin_assumption_key, the value typed in that key''s unit, and WHERE IT CAME FROM: source_citation (NOT NULL, ≥ 10 characters) and source_asof (NOT NULL, not in the future). There are no platform "source defaults": no IMD series, no input-cost index exists here. Every change lands in twin_assumption_history by trigger.';
COMMENT ON COLUMN twin_assumptions.source_asof IS 'The date the cited source''s figure is as of (never in the future; never typed by the platform).';

CREATE OR REPLACE FUNCTION twin_assumptions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  IF NOT twin_lookup_exists('twin_assumption_key', NEW.key_code) THEN
    RAISE EXCEPTION 'twin_assumptions: unknown assumption key %', NEW.key_code USING ERRCODE = '23514';
  END IF;
  IF NEW.source_asof > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN
    RAISE EXCEPTION 'twin_assumptions: a source cannot be as of a future date' USING ERRCODE = '23514';
  END IF;
  SELECT tenant_id, status INTO s FROM twin_scenarios WHERE id = NEW.scenario_id;
  IF s.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'twin_assumptions: scenario belongs to another tenant' USING ERRCODE = '23514';
  END IF;
  IF s.status = 'archived' THEN
    RAISE EXCEPTION 'twin_assumptions: the scenario is archived' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.key_code <> OLD.key_code OR NEW.scenario_id <> OLD.scenario_id OR NEW.tenant_id <> OLD.tenant_id) THEN
    RAISE EXCEPTION 'twin_assumptions: key, scenario and tenant are fixed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_twin_assumptions_guard ON twin_assumptions;
CREATE TRIGGER trg_twin_assumptions_guard BEFORE INSERT OR UPDATE ON twin_assumptions FOR EACH ROW EXECUTE FUNCTION twin_assumptions_guard();

CREATE TABLE IF NOT EXISTS twin_assumption_history (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  scenario_id     uuid NOT NULL REFERENCES twin_scenarios(id),
  assumption_id   uuid NOT NULL REFERENCES twin_assumptions(id),
  key_code        varchar(40) NOT NULL,
  old_value       numeric(14,4),
  old_unit_code   varchar(20),
  old_citation    text,
  old_asof        date,
  new_value       numeric(14,4) NOT NULL,
  new_unit_code   varchar(20) NOT NULL,
  new_citation    text NOT NULL,
  new_asof        date NOT NULL,
  set_by          uuid NOT NULL REFERENCES users(id),
  set_at          timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE twin_assumption_history IS
  'PC-56 TENANT-12 (0190, W421 "Edited by"): every value an assumption ever held, with its citation, as-of, who and when. Written ONLY by trg_twin_assumptions_history (the service cannot skip it); append-only (UPDATE / DELETE / TRUNCATE → 42501).';

CREATE OR REPLACE FUNCTION twin_assumptions_history_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.value = OLD.value AND NEW.unit_code = OLD.unit_code AND NEW.source_citation = OLD.source_citation AND NEW.source_asof = OLD.source_asof THEN
    RETURN NEW;
  END IF;
  INSERT INTO twin_assumption_history (tenant_id, scenario_id, assumption_id, key_code, old_value, old_unit_code, old_citation, old_asof,
                                       new_value, new_unit_code, new_citation, new_asof, set_by, set_at)
  VALUES (NEW.tenant_id, NEW.scenario_id, NEW.id, NEW.key_code,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.value END, CASE WHEN TG_OP = 'UPDATE' THEN OLD.unit_code END,
          CASE WHEN TG_OP = 'UPDATE' THEN OLD.source_citation END, CASE WHEN TG_OP = 'UPDATE' THEN OLD.source_asof END,
          NEW.value, NEW.unit_code, NEW.source_citation, NEW.source_asof, NEW.set_by, NEW.set_at);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_twin_assumptions_history ON twin_assumptions;
CREATE TRIGGER trg_twin_assumptions_history AFTER INSERT OR UPDATE ON twin_assumptions FOR EACH ROW EXECUTE FUNCTION twin_assumptions_history_write();

CREATE OR REPLACE FUNCTION twin_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only — a recorded row is never edited or removed (PC-56 TENANT-12, 0190)', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_twin_ah_append_only ON twin_assumption_history;
CREATE TRIGGER trg_twin_ah_append_only BEFORE UPDATE OR DELETE ON twin_assumption_history FOR EACH ROW EXECUTE FUNCTION twin_append_only();
DROP TRIGGER IF EXISTS trg_twin_ah_no_truncate ON twin_assumption_history;
CREATE TRIGGER trg_twin_ah_no_truncate BEFORE TRUNCATE ON twin_assumption_history FOR EACH STATEMENT EXECUTE FUNCTION twin_append_only();

CREATE TABLE IF NOT EXISTS twin_runs (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id),
  scenario_id         uuid NOT NULL REFERENCES twin_scenarios(id),
  status              varchar(10) NOT NULL,
  model_code          varchar(80),
  model_version       varchar(40),
  model_id            uuid REFERENCES ai_models(id),
  input_snapshot_hash char(64) NOT NULL,
  assumption_snapshot jsonb NOT NULL,
  seed                bigint,
  requested_by        uuid NOT NULL REFERENCES users(id),
  refusal_code        varchar(40),
  outputs             jsonb,
  ai_inference_id     bigint,
  idempotency_key     varchar(200) NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_twin_runs_status  CHECK (status IN ('refused', 'queued', 'done', 'failed')),
  CONSTRAINT ck_twin_runs_hash    CHECK (input_snapshot_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT ck_twin_runs_snapshot CHECK (jsonb_typeof(assumption_snapshot) = 'array'),
  -- a refused attempt: its code, and nothing a screen could print as a figure
  CONSTRAINT ck_twin_runs_refused CHECK (status <> 'refused' OR (refusal_code IN ('TWIN_NO_MODEL_REGISTERED', 'TWIN_NO_RUNNER') AND outputs IS NULL AND ai_inference_id IS NULL AND seed IS NULL)),
  CONSTRAINT ck_twin_runs_not_refused CHECK (status = 'refused' OR (refusal_code IS NULL AND model_code IS NOT NULL AND model_version IS NOT NULL AND model_id IS NOT NULL AND seed IS NOT NULL)),
  -- outputs exist only on a DONE run that names everything a replay needs and the inference that governs it
  CONSTRAINT ck_twin_runs_outputs CHECK (outputs IS NULL OR (status = 'done' AND ai_inference_id IS NOT NULL)),
  CONSTRAINT ck_twin_runs_done    CHECK (status <> 'done' OR (outputs IS NOT NULL AND ai_inference_id IS NOT NULL)),
  CONSTRAINT uq_twin_runs_idem UNIQUE (tenant_id, requested_by, idempotency_key)
);
COMMENT ON TABLE twin_runs IS
  'PC-56 TENANT-12 (0190, F-1 — THE GATE): every attempt to run a scenario. A band exists only on a DONE row that pins a model REGISTERED at production/canary (code + version + id), the input snapshot hash, the assumption snapshot with citations, the seed, the outputs and the ai_inferences row that governs them (CHECKs + trg_twin_runs_gate). No model is registered this wave: the API writes only status = refused / TWIN_NO_MODEL_REGISTERED — the honest record that a run was asked for and why none happened. kv_app holds SELECT, INSERT only.';
COMMENT ON COLUMN twin_runs.input_snapshot_hash IS 'sha256 of the canonical assumption snapshot the attempt was made with (keys, values, units, citations, as-ofs) — the replay key a future run is pinned by. On a refused row it records what was asked, not a result.';
COMMENT ON COLUMN twin_runs.outputs IS 'P10/P50/P90 bands of a DONE run only (ck_twin_runs_outputs). NULL on every row this wave writes.';

CREATE OR REPLACE FUNCTION twin_runs_gate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  SELECT tenant_id INTO s FROM twin_scenarios WHERE id = NEW.scenario_id;
  IF s.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'twin_runs: scenario belongs to another tenant' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'refused' AND NOT EXISTS (
       SELECT 1 FROM ai_models m
        WHERE m.id = NEW.model_id AND m.code = NEW.model_code AND m.version = NEW.model_version
          AND m.status IN ('production', 'canary') AND m.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'twin_runs: TWIN_NO_MODEL_REGISTERED — a run that is not a refusal must pin a model registered at production/canary (PC-56 TENANT-12, 0190)'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_twin_runs_gate ON twin_runs;
CREATE TRIGGER trg_twin_runs_gate BEFORE INSERT ON twin_runs FOR EACH ROW EXECUTE FUNCTION twin_runs_gate();
DROP TRIGGER IF EXISTS trg_twin_runs_append_only ON twin_runs;
CREATE TRIGGER trg_twin_runs_append_only BEFORE UPDATE OR DELETE ON twin_runs FOR EACH ROW EXECUTE FUNCTION twin_append_only();
DROP TRIGGER IF EXISTS trg_twin_runs_no_truncate ON twin_runs;
CREATE TRIGGER trg_twin_runs_no_truncate BEFORE TRUNCATE ON twin_runs FOR EACH STATEMENT EXECUTE FUNCTION twin_append_only();

CREATE TABLE IF NOT EXISTS twin_devices (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  kind_code       varchar(40) NOT NULL,
  serial          varchar(80) NOT NULL,
  label           varchar(120),
  parcel_id       uuid REFERENCES land_parcels(id),
  status          varchar(10) NOT NULL DEFAULT 'registered',
  registered_by   uuid NOT NULL REFERENCES users(id),
  registered_at   timestamptz NOT NULL DEFAULT now(),
  retired_by      uuid REFERENCES users(id),
  retired_at      timestamptz,
  retire_reason   text,
  last_reading_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_twin_devices_serial UNIQUE (tenant_id, serial),
  CONSTRAINT ck_twin_devices_status CHECK (status IN ('registered', 'retired')),
  CONSTRAINT ck_twin_devices_serial CHECK (serial ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{2,79}$'),
  CONSTRAINT ck_twin_devices_retired CHECK ((status = 'retired') = (retired_at IS NOT NULL AND retired_by IS NOT NULL AND char_length(btrim(COALESCE(retire_reason, ''))) >= 3))
);
COMMENT ON TABLE twin_devices IS
  'PC-56 TENANT-12 (0190, DELTA-046 — founder decision DEVICE REGISTRY ONLY, READINGS REFUSED): a cooperative''s registered soil pods and weather masts (kind from twin_device_kind, serial unique per tenant, optional parcel). There is NO readings table and NO ingestion topic: a registered device is a fact; a reading is not, and the console says "readings: none — ingestion not built".';
COMMENT ON COLUMN twin_devices.last_reading_at IS 'NO WRITER (PC-56 TENANT-12, 0190): reserved for a future ingestion path; kv_app holds no UPDATE on it. Always NULL today — never typed, never faked.';

CREATE OR REPLACE FUNCTION twin_devices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  IF NOT twin_lookup_exists('twin_device_kind', NEW.kind_code) THEN
    RAISE EXCEPTION 'twin_devices: unknown device kind %', NEW.kind_code USING ERRCODE = '23514';
  END IF;
  IF NEW.parcel_id IS NOT NULL THEN
    SELECT tenant_id INTO p FROM land_parcels WHERE id = NEW.parcel_id AND deleted_at IS NULL;
    IF p.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'twin_devices: the parcel is not this tenant''s' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'retired' THEN RAISE EXCEPTION 'twin_devices: a retired device is final' USING ERRCODE = '23514'; END IF;
    IF NEW.serial <> OLD.serial OR NEW.kind_code <> OLD.kind_code OR NEW.tenant_id <> OLD.tenant_id THEN
      RAISE EXCEPTION 'twin_devices: serial, kind and tenant are fixed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_twin_devices_guard ON twin_devices;
CREATE TRIGGER trg_twin_devices_guard BEFORE INSERT OR UPDATE ON twin_devices FOR EACH ROW EXECUTE FUNCTION twin_devices_guard();

CREATE TABLE IF NOT EXISTS twin_feeds (
  code             varchar(40) PRIMARY KEY,
  as_of_query_key  varchar(60) NOT NULL,
  source_tables    text[] NOT NULL,
  sort_order       smallint NOT NULL DEFAULT 100,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_twin_feeds_code CHECK (code IN ('parcel_register', 'soil_tests', 'devices', 'mandi_prices', 'weather_forecast')),
  CONSTRAINT ck_twin_feeds_query CHECK (as_of_query_key ~ '^[a-z_]{3,60}$')
);
COMMENT ON TABLE twin_feeds IS
  'PC-56 TENANT-12 (0190, W420 "Feed freshness"): the PLATFORM registry of what the twin reads. No tenant column; kv_app SELECT only (the admin realm owns it). There is NO as-of column on purpose: the as-of is computed on every read from the real table the row names (as_of_query_key → a fixed, whitelisted read in the twin module), so it can never be typed — "a number without an as-of date is not shown".';

INSERT INTO twin_feeds (code, as_of_query_key, source_tables, sort_order) VALUES
  ('parcel_register',  'parcel_register_asof',  ARRAY['land_parcels'], 1),
  ('soil_tests',       'soil_tests_asof',       ARRAY['soil_tests'], 2),
  ('devices',          'devices_asof',          ARRAY['twin_devices'], 3),
  ('mandi_prices',     'mandi_platform_asof',   ARRAY['mandi_prices'], 4),
  ('weather_forecast', 'weather_forecast_asof', ARRAY['weather_alerts'], 5)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS twin_access_requests (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  requested_by  uuid NOT NULL REFERENCES users(id),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_twin_access_requests_tenant UNIQUE (tenant_id)
);
COMMENT ON TABLE twin_access_requests IS
  'PC-56 TENANT-12 (0190, W420 Locked "Ask your account desk", F-15): ONE row per tenant — the cooperative asked the account desk for the Twin. UNIQUE (tenant_id): asking again returns the same row; the locked page never nags, never counts down, never repeats. The admin realm reads it; nothing in the tenant realm edits or removes it.';
DROP TRIGGER IF EXISTS trg_twin_ar_append_only ON twin_access_requests;
CREATE TRIGGER trg_twin_ar_append_only BEFORE UPDATE OR DELETE ON twin_access_requests FOR EACH ROW EXECUTE FUNCTION twin_append_only();

-- RLS: ENABLE + FORCE, the 0175 split (never a NULL arm), the admin realm by name.
DO $$
DECLARE t text; p text;
BEGIN
  FOREACH t IN ARRAY ARRAY['twin_scenarios', 'twin_assumptions', 'twin_assumption_history', 'twin_runs', 'twin_devices', 'twin_access_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    FOREACH p IN ARRAY ARRAY['read', 'insert_own', 'update_own', 'admin_realm'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_' || p, t);
    END LOOP;
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT USING (tenant_id = current_tenant_id())', t || '_read', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR INSERT WITH CHECK (tenant_id = current_tenant_id())', t || '_insert_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())', t || '_update_own', t);
    EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO kv_admin USING (true) WITH CHECK (true)', t || '_admin_realm', t);
    EXECUTE format('REVOKE ALL ON %I FROM kv_app, kv_relay, kv_readonly', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_readonly', t);
    EXECUTE format('GRANT SELECT ON %I TO kv_admin', t);
  END LOOP;
END $$;
GRANT SELECT, INSERT ON twin_scenarios TO kv_app;
GRANT UPDATE (name, product_id, status, updated_at, updated_by, archived_at, archived_by, archive_reason) ON twin_scenarios TO kv_app;
GRANT SELECT, INSERT ON twin_assumptions TO kv_app;
GRANT UPDATE (value, unit_code, source_citation, source_asof, set_by, set_at) ON twin_assumptions TO kv_app;
GRANT SELECT, INSERT ON twin_assumption_history TO kv_app;
GRANT SELECT, INSERT ON twin_runs TO kv_app;                          -- NO UPDATE: a refusal can never become a band
GRANT SELECT, INSERT ON twin_devices TO kv_app;
GRANT UPDATE (label, parcel_id, status, retired_by, retired_at, retire_reason, updated_at) ON twin_devices TO kv_app;   -- never last_reading_at
GRANT SELECT, INSERT ON twin_access_requests TO kv_app;

REVOKE ALL ON twin_feeds FROM kv_app, kv_relay, kv_readonly;
GRANT SELECT ON twin_feeds TO kv_app, kv_readonly;
GRANT SELECT, INSERT, UPDATE ON twin_feeds TO kv_admin;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.3  PERMISSIONS — rows here AND in seed 0004. No `analyst` role is created (founder decision): the canon's "analyst" is
-- tenant_admin and fpo_coordinator. `land.admin` replaces the `booking.manage` ride for the land registry's tenant-wide
-- reach (box=all, a cross-owner edit with a reason): `land.manage` is the FARMER's own-land permission and cannot double as
-- the desk's without making every farmer an administrator of every parcel.
-- ------------------------------------------------------------------------------------------------------------------
-- The two roles these grants bind that 0056a does not guarantee (the 7d-money / 0174 shape: guaranteed HERE, before the binding,
-- with seed 0004's exact definitions — on a database where they exist this inserts nothing; where the seed has not run yet, the
-- grants below still land instead of silently granting nothing).
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT 'fpo_coordinator', 'FPO Coordinator', 'tenant', true, true, NULL WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = 'fpo_coordinator');
INSERT INTO roles (code, default_name, scope, requires_kyc, requires_approval, module_code)
SELECT 'tenant_staff', 'Tenant Staff', 'tenant', false, true, 'M01' WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = 'tenant_staff');

INSERT INTO permissions (code, default_name, module_code) VALUES
  ('twin.view', 'Digital twin: read the overview, feeds, scenarios and results (no figure without a registered model and a recorded run)', 'M24'),
  ('twin.run', 'Digital twin: create scenarios, set cited assumptions, archive, and ask for a run (refused by name until a model is registered)', 'M24'),
  ('twin.devices.manage', 'Digital twin: register and retire field devices (soil pods, weather masts) — registry only, no readings', 'M24'),
  ('land.admin', 'Land registry desk: read every parcel of the tenant and correct another member''s parcel with a recorded reason', 'M24'),
  ('ai.inference.read', 'Read this tenant''s own AI inference records (model, version, confidence) — the registry stays read-only', NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p
 WHERE (p.code = 'twin.view'           AND r.code IN ('tenant_admin', 'fpo_coordinator', 'tenant_staff'))
    OR (p.code = 'twin.run'            AND r.code IN ('tenant_admin', 'fpo_coordinator'))
    OR (p.code = 'twin.devices.manage' AND r.code IN ('tenant_admin'))
    OR (p.code = 'land.admin'          AND r.code IN ('tenant_admin', 'fpo_coordinator'))
    OR (p.code = 'ai.inference.read'   AND r.code IN ('tenant_admin'))
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.4  THE FLAG (also seed 0009) — default OFF; the Locked page is what a tenant without it sees.
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO feature_flags (key, description, is_enabled, rollout_pct, rules)
SELECT 'digital_twin',
       'PC-56 TENANT-12. The digital twin (W420 overview, W421 scenarios, W422 results) — licensed per plan / tenant allowlist through rules.plans / rules.tenant_ids. OFF until enabled. No figure prints without a registered model and a recorded run.',
       false, 100, '{}'
 WHERE NOT EXISTS (SELECT 1 FROM feature_flags WHERE key = 'digital_twin');

-- ------------------------------------------------------------------------------------------------------------------
-- 190.5  THE SETTING (also seed 0008) — the aggregate floor W422 states on screen.
-- ------------------------------------------------------------------------------------------------------------------
INSERT INTO setting_definitions (key, value_type, scope, risk_class, default_value, description, lock_note)
VALUES ('twin.min_group_size', 'int', 'platform', 'security', '5'::jsonb,
        'The smallest number of distinct members behind any member-level aggregate the digital twin prints (W422 "aggregate bands only — no member-level figures, ever"). Below it the twin says "fewer than N members — not shown".',
        'Lowering this narrows the crowd a member hides in. Two administrators.')
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.6  F-3 — the plan / licence tables are the admin realm's. No tenant route writes them (survey: none).
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON plan_features FROM kv_app;
REVOKE INSERT, UPDATE ON tenant_features FROM kv_app;
REVOKE INSERT, UPDATE ON subscription_addons FROM kv_app;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.13 (first, the tools the partitioned sections use) — a partitioned parent's RLS + policies, copied to its children.
-- Accessed through the parent, Postgres applies the PARENT's policies only; a child carries its own for direct access, and
-- the RLS gate (v_tables_without_rls) lists every child with a tenant_id and no policy. `ensure_partitions` now calls this
-- for every partition it creates, so a new month of a tenant table is never policy-less.
-- ------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE PROCEDURE sync_partition_rls(p_parent text, p_child text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE par regclass := p_parent::regclass; chi regclass := p_child::regclass; pol record; roles text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = par) THEN RETURN; END IF;
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', chi);
  IF (SELECT relforcerowsecurity FROM pg_class WHERE oid = par) THEN EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', chi); END IF;
  FOR pol IN SELECT * FROM pg_policy WHERE polrelid = par LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = chi AND polname = pol.polname) THEN
      SELECT CASE WHEN pol.polroles = '{0}'::oid[] THEN 'public' ELSE string_agg(quote_ident(rolname), ', ') END
        INTO roles FROM pg_roles WHERE oid = ANY (pol.polroles);
      EXECUTE format('CREATE POLICY %I ON %s AS %s FOR %s TO %s%s%s', pol.polname, chi,
        CASE WHEN pol.polpermissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
        CASE pol.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
        COALESCE(roles, 'public'),
        CASE WHEN pol.polqual IS NOT NULL THEN ' USING (' || pg_get_expr(pol.polqual, par) || ')' ELSE '' END,
        CASE WHEN pol.polwithcheck IS NOT NULL THEN ' WITH CHECK (' || pg_get_expr(pol.polwithcheck, par) || ')' ELSE '' END);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE PROCEDURE ensure_partitions(p_months_ahead integer DEFAULT 3)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $procedure$
DECLARE r record; m date; part_name text; parent_bare text;
BEGIN
  FOR r IN
    SELECT c.oid::regclass::text AS tbl,
           (SELECT attname FROM pg_attribute
             WHERE attrelid = c.oid
               AND attnum = (SELECT unnest(partattrs) FROM pg_partitioned_table WHERE partrelid = c.oid LIMIT 1)) AS keycol
    FROM pg_class c
    JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
    WHERE c.relnamespace = 'public'::regnamespace
  LOOP
    parent_bare := replace(r.tbl, 'public.', '');
    FOR i IN 0..(11 + p_months_ahead) LOOP
      m := (date_trunc('month', now()) + (i || ' months')::interval)::date;
      part_name := parent_bare || '_' || to_char(m, 'YYYY_MM');
      EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L);',
                     part_name, r.tbl, m, (m + interval '1 month')::date);
      CALL sync_partition_privileges(parent_bare, part_name);
      CALL sync_partition_rls(parent_bare, part_name);            -- PC-56 TENANT-12 (0190)
    END LOOP;
    part_name := parent_bare || '_default';
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %s DEFAULT;', part_name, r.tbl);
    CALL sync_partition_privileges(parent_bare, part_name);
    CALL sync_partition_rls(parent_bare, part_name);              -- PC-56 TENANT-12 (0190)
  END LOOP;
END $procedure$;

-- Re-sync every child of a parent: drop the child's own copies of the given policy names, then copy the parent's set.
CREATE OR REPLACE PROCEDURE t12_resync_children(p_parent text, p_drop_prefix text) LANGUAGE plpgsql AS $$
DECLARE c record; pol record;
BEGIN
  FOR c IN SELECT inhrelid::regclass::text AS child FROM pg_inherits WHERE inhparent = p_parent::regclass LOOP
    FOR pol IN SELECT polname FROM pg_policy WHERE polrelid = c.child::regclass LOOP
      IF pol.polname LIKE p_drop_prefix || '%' OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = p_parent::regclass AND polname = pol.polname) THEN
        EXECUTE format('DROP POLICY %I ON %s', pol.polname, c.child);
      END IF;
    END LOOP;
    CALL sync_partition_privileges(p_parent, c.child);
    CALL sync_partition_rls(p_parent, c.child);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.7  F-4 — MANDI PROVENANCE. A price a tenant types is a TENANT OBSERVATION: tenant-scoped, source 'tenant_manual'
-- (forced by the API), with who entered it. A platform row (tenant NULL, source agmarknet|enam) is written only by kv_ingest
-- (an ingestion path — none is connected today) or the admin realm; kv_app's INSERT WITH CHECK refuses a NULL tenant.
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
ALTER TABLE mandi_prices ADD COLUMN IF NOT EXISTS entered_by uuid REFERENCES users(id);
COMMENT ON COLUMN mandi_prices.tenant_id IS
  'PC-56 TENANT-12 (0190, F-4): NULL = a PLATFORM observation (written by kv_ingest / the admin realm, read by every tenant); set = a TENANT OBSERVATION (source tenant_manual, typed on that tenant''s desk, read by that tenant only, labelled as such). kv_app cannot insert a NULL-tenant row (RLS WITH CHECK).';
COMMENT ON COLUMN mandi_prices.entered_by IS 'PC-56 TENANT-12 (0190): the user who typed a tenant observation (required when tenant_id is set).';
ALTER TABLE mandi_prices DROP CONSTRAINT IF EXISTS ck_mandi_prices_tenant_observation;
ALTER TABLE mandi_prices ADD CONSTRAINT ck_mandi_prices_tenant_observation CHECK (
  (tenant_id IS NULL AND source <> 'tenant_manual') OR (tenant_id IS NOT NULL AND source = 'tenant_manual' AND entered_by IS NOT NULL));

ALTER TABLE mandi_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE mandi_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mp_read ON mandi_prices;
DROP POLICY IF EXISTS mp_insert_own ON mandi_prices;
DROP POLICY IF EXISTS mp_ingest_insert ON mandi_prices;
DROP POLICY IF EXISTS mp_admin_realm ON mandi_prices;
CREATE POLICY mp_read          ON mandi_prices FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY mp_insert_own    ON mandi_prices FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY mp_ingest_insert ON mandi_prices FOR INSERT TO kv_ingest WITH CHECK (tenant_id IS NULL AND source <> 'tenant_manual');
CREATE POLICY mp_admin_realm   ON mandi_prices FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE UPDATE ON mandi_prices FROM kv_app;                 -- the anomaly decision is the admin realm's (market-ops); no tenant writer
CALL t12_resync_children('mandi_prices', 'tenant_isolation_');

REVOKE INSERT, UPDATE ON price_predictions FROM kv_app;    -- POST /market/predictions is refused (409): a typed band is the F-1 class
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT inhrelid::regclass::text AS child FROM pg_inherits WHERE inhparent = 'price_predictions'::regclass LOOP
    CALL sync_partition_privileges('price_predictions', c.child);
  END LOOP;
END $$;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.8  F-5 — the platform's weather advisories are read-only to the tenant role (kv_ingest is the intended writer).
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON weather_alerts FROM kv_app;
DO $$ DECLARE c record; BEGIN
  FOR c IN SELECT inhrelid::regclass::text AS child FROM pg_inherits WHERE inhparent = 'weather_alerts'::regclass LOOP
    CALL sync_partition_privileges('weather_alerts', c.child);
  END LOOP;
END $$;
COMMENT ON TABLE weather_alerts IS
  'Regional weather advisories (global, partitioned). PC-56 TENANT-12 (0190, F-5): READ-ONLY to kv_app; written by kv_ingest — and NO ingestion path (IMD / Skymet) is connected, which the twin overview says by name ("alerts: no ingestion yet").';

-- ------------------------------------------------------------------------------------------------------------------
-- 190.9  F-7 — the model registry is the admin realm's (Law 11); inferences and the review queue get the 0175 split.
-- ------------------------------------------------------------------------------------------------------------------
REVOKE INSERT, UPDATE ON ai_models FROM kv_app;

ALTER TABLE ai_inferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_inferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_inferences ON ai_inferences;
DROP POLICY IF EXISTS ai_inferences_read ON ai_inferences;
DROP POLICY IF EXISTS ai_inferences_insert_own ON ai_inferences;
DROP POLICY IF EXISTS ai_inferences_update_own ON ai_inferences;
DROP POLICY IF EXISTS ai_inferences_admin_realm ON ai_inferences;
CREATE POLICY ai_inferences_read        ON ai_inferences FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY ai_inferences_insert_own  ON ai_inferences FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ai_inferences_update_own  ON ai_inferences FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY ai_inferences_admin_realm ON ai_inferences FOR ALL TO kv_admin USING (true) WITH CHECK (true);
CALL t12_resync_children('ai_inferences', 'tenant_isolation_');

ALTER TABLE ai_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_review_queue FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_ai_review_queue ON ai_review_queue;
DROP POLICY IF EXISTS arq_read ON ai_review_queue;
DROP POLICY IF EXISTS arq_insert_own ON ai_review_queue;
DROP POLICY IF EXISTS arq_update_own ON ai_review_queue;
DROP POLICY IF EXISTS arq_admin_realm ON ai_review_queue;
CREATE POLICY arq_read        ON ai_review_queue FOR SELECT USING (tenant_id = current_tenant_id());
CREATE POLICY arq_insert_own  ON ai_review_queue FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY arq_update_own  ON ai_review_queue FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY arq_admin_realm ON ai_review_queue FOR ALL TO kv_admin USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------------------------------------------
-- 190.10 F-8 — platform crop calendars: every tenant reads them; only the admin realm writes them.
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE crop_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE crop_calendars FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_crop_calendars ON crop_calendars;
DROP POLICY IF EXISTS cc_read ON crop_calendars;
DROP POLICY IF EXISTS cc_insert_own ON crop_calendars;
DROP POLICY IF EXISTS cc_update_own ON crop_calendars;
DROP POLICY IF EXISTS cc_admin_realm ON crop_calendars;
CREATE POLICY cc_read        ON crop_calendars FOR SELECT USING (tenant_id IS NULL OR tenant_id = current_tenant_id());
CREATE POLICY cc_insert_own  ON crop_calendars FOR INSERT WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cc_update_own  ON crop_calendars FOR UPDATE USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY cc_admin_realm ON crop_calendars FOR ALL TO kv_admin USING (true) WITH CHECK (true);
REVOKE INSERT, UPDATE, DELETE ON crop_calendars FROM kv_app;   -- no tenant route writes calendars (admin-api does)

-- ------------------------------------------------------------------------------------------------------------------
-- 190.11 F-9 — the yield unit
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE crop_seasons ADD COLUMN IF NOT EXISTS yield_unit_code varchar(20) REFERENCES units(code);
-- THE ASSUMPTION (stated, not hidden): no unit was ever recorded before 0190; existing yields are taken to be quintals.
UPDATE crop_seasons SET yield_unit_code = 'quintal'
 WHERE yield_unit_code IS NULL AND (expected_yield IS NOT NULL OR actual_yield IS NOT NULL);
COMMENT ON COLUMN crop_seasons.yield_unit_code IS
  'PC-56 TENANT-12 (0190, F-9): the mass unit expected_yield / actual_yield are in (units, class mass). Rows written before 0190 that carried a yield were BACKFILLED to ''quintal'' — AN ASSUMPTION (no unit had ever been recorded; quintal is the unit of every mandi and canon screen). New rows carry the farmer''s unit; a yield without a unit is refused. The twin prints "actual yield, last full season, qtl/ha" only where this unit AND the parcel area unit convert.';
ALTER TABLE crop_seasons DROP CONSTRAINT IF EXISTS ck_crop_seasons_yield_unit;
ALTER TABLE crop_seasons ADD CONSTRAINT ck_crop_seasons_yield_unit CHECK ((expected_yield IS NULL AND actual_yield IS NULL) OR yield_unit_code IS NOT NULL);
-- kv_app's crop_seasons grants are table-wide (S,I,U), so the new column is writable through them; nothing to add.

-- F-2 — a parcel boundary is a GeoJSON Polygon / MultiPolygon or nothing (the API validates rings and ranges; this is the
-- floor under it). NOT VALID: a row written before 0190 with a junk boundary is not rewritten here — it is simply not
-- counted as "mapped" by the twin (the same predicate), and the next edit of that parcel must send a real boundary.
ALTER TABLE land_parcels DROP CONSTRAINT IF EXISTS ck_land_parcels_boundary_shape;
-- COALESCE: `'{}'->>'type'` is NULL, and a CHECK that evaluates to NULL PASSES — the exact hole `{}` would walk through.
ALTER TABLE land_parcels ADD CONSTRAINT ck_land_parcels_boundary_shape CHECK (
  boundary_geojson IS NULL OR (COALESCE(boundary_geojson->>'type', '') IN ('Polygon', 'MultiPolygon')
                               AND COALESCE(jsonb_typeof(boundary_geojson->'coordinates'), '') = 'array')) NOT VALID;

-- ------------------------------------------------------------------------------------------------------------------
-- 190.12 F-14 — a governance proposal may one day cite the twin run it came from.
-- ------------------------------------------------------------------------------------------------------------------
ALTER TABLE coop_resolutions ADD COLUMN IF NOT EXISTS source_ref jsonb;
COMMENT ON COLUMN coop_resolutions.source_ref IS
  'PC-56 TENANT-12 (0190, F-14): the receipt a proposal came from — {"kind":"twin_run","id":"<uuid>"} naming a DONE twin run of the same tenant (trigger). NULL on every row today: no twin run exists to cite ("no run to cite"). Shown read-only on the resolution form when present.';
ALTER TABLE coop_resolutions DROP CONSTRAINT IF EXISTS ck_coop_resolutions_source_ref;
ALTER TABLE coop_resolutions ADD CONSTRAINT ck_coop_resolutions_source_ref CHECK (
  source_ref IS NULL OR (jsonb_typeof(source_ref) = 'object' AND COALESCE(source_ref->>'kind', '') = 'twin_run'
                         AND COALESCE(source_ref->>'id', '') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                         AND (source_ref - 'kind' - 'id') = '{}'::jsonb));
CREATE OR REPLACE FUNCTION coop_resolutions_source_ref_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_ref IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.source_ref IS DISTINCT FROM OLD.source_ref) THEN
    -- the shape first (a BEFORE trigger runs before the CHECK): a malformed id is refused, never a cast error
    IF jsonb_typeof(NEW.source_ref) <> 'object' OR COALESCE(NEW.source_ref->>'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'coop_resolutions.source_ref must be {"kind":"twin_run","id":"<uuid>"}' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM twin_runs r WHERE r.id = (NEW.source_ref->>'id')::uuid AND r.tenant_id = NEW.tenant_id AND r.status = 'done') THEN
      RAISE EXCEPTION 'coop_resolutions.source_ref must name a DONE twin run of this tenant — a refused attempt is not a receipt (PC-56 TENANT-12, 0190)'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_coop_resolutions_source_ref ON coop_resolutions;
CREATE TRIGGER trg_coop_resolutions_source_ref BEFORE INSERT OR UPDATE OF source_ref ON coop_resolutions FOR EACH ROW EXECUTE FUNCTION coop_resolutions_source_ref_guard();

-- ------------------------------------------------------------------------------------------------------------------
-- 190.14 INDEXES
-- ------------------------------------------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_twin_scenarios_recent ON twin_scenarios (tenant_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_twin_ah_scenario      ON twin_assumption_history (tenant_id, scenario_id, set_at DESC);
CREATE INDEX IF NOT EXISTS idx_twin_runs_scenario    ON twin_runs (tenant_id, scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_twin_devices_kind     ON twin_devices (tenant_id, kind_code, status);
CREATE INDEX IF NOT EXISTS idx_land_parcels_recent   ON land_parcels (tenant_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mandi_prices_tenant   ON mandi_prices (tenant_id, product_id, price_date DESC) WHERE tenant_id IS NOT NULL;
